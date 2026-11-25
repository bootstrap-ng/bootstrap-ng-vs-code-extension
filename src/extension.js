"use strict";

const vscode = require("vscode");

const { complete } = require("./completions");
const {
  ALPHA1_CODE,
  diagnoseDependencies,
  updatedSpecifier,
} = require("./dependencies");
const { diagnose } = require("./diagnostics");
const { documentationItems } = require("./docs");
const { hoverAt, symbolAt } = require("./hover");
const { translate } = require("./l10n");
const {
  buildImportEdits,
  classNamesIn,
  pendingImports,
  templateClassNames,
} = require("./imports");

const PACKAGE_SELECTOR = [
  { language: "json", pattern: "**/package.json", scheme: "file" },
  { language: "jsonc", pattern: "**/package.json", scheme: "file" },
];

const SELECTOR = [
  { language: "html", scheme: "file" },
  { language: "html", scheme: "untitled" },
  { language: "typescript", scheme: "file" },
  { language: "typescript", scheme: "untitled" },
];

function isSupported(document) {
  if (document.languageId !== "html" && document.languageId !== "typescript") {
    return false;
  }

  if (document.uri.scheme !== "file" && document.uri.scheme !== "untitled") {
    return false;
  }

  return !document.uri.fsPath.includes("node_modules");
}

function readOptions() {
  const config = vscode.workspace.getConfiguration("bootstrap-ng");

  return {
    hintBootstrap5DataApi: config.get("hintBootstrap5DataApi") !== false,
    validateAttributeValues: config.get("validateAttributeValues") !== false,
  };
}

function toCompletion(document, entry) {
  const kind =
    vscode.CompletionItemKind[entry.kind] ?? vscode.CompletionItemKind.Text;
  const item = new vscode.CompletionItem(entry.label, kind);
  item.detail = entry.detail;
  item.documentation = new vscode.MarkdownString(entry.documentation);
  item.filterText = entry.filterText;
  item.insertText = entry.snippet
    ? new vscode.SnippetString(entry.insertText)
    : entry.insertText;
  item.range = new vscode.Range(
    document.positionAt(entry.start),
    document.positionAt(entry.end),
  );
  item.sortText = entry.sortText;
  return item;
}

function provideCompletions(document, position) {
  if (!isSupported(document)) {
    return [];
  }

  const items = complete(
    document.getText(),
    document.offsetAt(position),
    document.languageId,
  );

  return new vscode.CompletionList(
    items.map((entry) => toCompletion(document, entry)),
    items.some((entry) => entry.incomplete),
  );
}

function provideHover(document, position) {
  if (!isSupported(document)) {
    return null;
  }

  const hit = hoverAt(
    document.getText(),
    document.offsetAt(position),
    document.languageId,
  );

  if (!hit) {
    return null;
  }

  const range = new vscode.Range(
    document.positionAt(hit.start),
    document.positionAt(hit.end),
  );

  return new vscode.Hover(new vscode.MarkdownString(hit.markdown), range);
}

function toDiagnostic(document, item) {
  const severity =
    item.severity === "information"
      ? vscode.DiagnosticSeverity.Information
      : vscode.DiagnosticSeverity.Warning;
  const diagnostic = new vscode.Diagnostic(
    new vscode.Range(
      document.positionAt(item.start),
      document.positionAt(item.end),
    ),
    item.message,
    severity,
  );
  diagnostic.source = "bootstrap-ng";

  if (item.code) {
    diagnostic.code = item.code;
  }

  return diagnostic;
}

function isPackageUri(uri) {
  if (uri.scheme !== "file") {
    return false;
  }

  return (
    uri.path.split("/").at(-1) === "package.json" &&
    !uri.fsPath.includes("node_modules")
  );
}

function isPackageJson(document) {
  return isPackageUri(document.uri);
}

function setPackageDiagnostics(collection, document) {
  const found = diagnoseDependencies(document.getText());

  collection.set(
    document.uri,
    found.map((item) => toDiagnostic(document, item)),
  );
}

function refreshDiagnostics(collection, document) {
  if (isPackageJson(document)) {
    setPackageDiagnostics(collection, document);
    return;
  }

  if (!isSupported(document)) {
    collection.delete(document.uri);
    return;
  }

  const found = diagnose(
    document.getText(),
    document.languageId,
    readOptions(),
  );
  collection.set(
    document.uri,
    found.map((item) => toDiagnostic(document, item)),
  );
}

function watchDiagnostics(context, collection) {
  const refresh = (document) => refreshDiagnostics(collection, document);

  context.subscriptions.push(
    collection,
    vscode.workspace.onDidOpenTextDocument(refresh),
    vscode.workspace.onDidChangeTextDocument((event) =>
      refresh(event.document),
    ),
    vscode.workspace.onDidCloseTextDocument((document) => {
      if (isPackageJson(document)) {
        return;
      }

      collection.delete(document.uri);
    }),
    vscode.workspace.onDidChangeConfiguration((event) => {
      if (!event.affectsConfiguration("bootstrap-ng")) {
        return;
      }

      for (const document of vscode.workspace.textDocuments) {
        refresh(document);
      }
    }),
  );

  for (const document of vscode.workspace.textDocuments) {
    refresh(document);
  }
}

async function refreshPackageFile(collection, uri) {
  if (!isPackageUri(uri)) {
    return;
  }

  try {
    const document = await vscode.workspace.openTextDocument(uri);

    setPackageDiagnostics(collection, document);
  } catch {
    collection.delete(uri);
  }
}

function watchPackageFiles(context, collection) {
  const watcher = vscode.workspace.createFileSystemWatcher("**/package.json");
  const refresh = (uri) =>
    refreshPackageFile(collection, uri).catch(() => {
      collection.delete(uri);
    });

  context.subscriptions.push(
    watcher,
    watcher.onDidChange(refresh),
    watcher.onDidCreate(refresh),
    watcher.onDidDelete((uri) => {
      if (isPackageUri(uri)) {
        collection.delete(uri);
      }
    }),
  );

  vscode.workspace
    .findFiles("**/package.json", "**/node_modules/**")
    .then((uris) =>
      Promise.all(uris.map((uri) => refreshPackageFile(collection, uri))),
    )
    .catch(() => {
      // Leave package diagnostics unchanged when the workspace search fails.
    });
}

function wantsQuickFix(context) {
  return (
    !context.only || context.only.intersects(vscode.CodeActionKind.QuickFix)
  );
}

function alpha1Fix(document, diagnostic) {
  if (diagnostic.code !== ALPHA1_CODE || diagnostic.source !== "bootstrap-ng") {
    return null;
  }

  const current = document.getText(diagnostic.range);
  const next = updatedSpecifier(current);

  if (next === current) {
    return null;
  }

  const action = new vscode.CodeAction(
    translate("Update to 6.0.0-alpha.2"),
    vscode.CodeActionKind.QuickFix,
  );
  const edit = new vscode.WorkspaceEdit();

  action.diagnostics = [diagnostic];
  action.isPreferred = true;
  edit.replace(document.uri, diagnostic.range, next);
  action.edit = edit;
  return action;
}

function providePackageCodeActions(document, range, context) {
  if (!isPackageJson(document) || !wantsQuickFix(context)) {
    return [];
  }

  const actions = [];

  for (const diagnostic of context.diagnostics) {
    if (!diagnostic.range.intersection(range)) {
      continue;
    }

    const action = alpha1Fix(document, diagnostic);

    if (action) {
      actions.push(action);
    }
  }

  return actions;
}

async function componentDocument(document) {
  if (document.languageId === "typescript") {
    return document;
  }

  const sibling = document.uri.fsPath.replace(/\.html$/u, ".ts");

  if (sibling === document.uri.fsPath) {
    return null;
  }

  try {
    return await vscode.workspace.openTextDocument(vscode.Uri.file(sibling));
  } catch {
    return null;
  }
}

function importOptions(document) {
  if (document.languageId !== "html") {
    return {};
  }

  const templateFile = document.uri.fsPath.split(/[\\/]/u).at(-1);

  return templateFile ? { templateFile } : {};
}

function usedNames(document, target) {
  if (document.languageId === "html") {
    return classNamesIn(document.getText());
  }

  return templateClassNames(target.getText());
}

function actionTitle(names) {
  if (names.length > 4) {
    return translate("Import bootstrap-ng directives");
  }

  return translate("Import {0} from bootstrap-ng", names.join(", "));
}

async function provideCodeActions(document, range) {
  if (!isSupported(document)) {
    return [];
  }

  const symbol = symbolAt(
    document.getText(),
    document.offsetAt(range.start),
    document.languageId,
  );

  if (!symbol || symbol.kind !== "directive") {
    return [];
  }

  const target = await componentDocument(document);

  if (!target) {
    return [];
  }

  const names = usedNames(document, target);
  const options = importOptions(document);
  const pending = pendingImports(target.getText(), names, options);

  if (!pending.includes(symbol.name)) {
    return [];
  }

  const edits = buildImportEdits(target.getText(), names, options);
  const action = new vscode.CodeAction(
    actionTitle(pending),
    vscode.CodeActionKind.QuickFix,
  );
  const workspaceEdit = new vscode.WorkspaceEdit();

  for (const edit of edits) {
    const editRange = new vscode.Range(
      target.positionAt(edit.start),
      target.positionAt(edit.end),
    );
    workspaceEdit.replace(target.uri, editRange, edit.text);
  }

  action.edit = workspaceEdit;
  return [action];
}

async function openDocs() {
  const editor = vscode.window.activeTextEditor;

  if (editor && isSupported(editor.document)) {
    const offset = editor.document.offsetAt(editor.selection.active);
    const symbol = symbolAt(
      editor.document.getText(),
      offset,
      editor.document.languageId,
    );

    if (symbol?.docUrl) {
      await vscode.env.openExternal(vscode.Uri.parse(symbol.docUrl));
      return;
    }
  }

  const picked = await vscode.window.showQuickPick(documentationItems(), {
    matchOnDescription: true,
    placeHolder: translate("Open bootstrap-ng documentation"),
  });

  if (picked) {
    await vscode.env.openExternal(vscode.Uri.parse(picked.url));
  }
}

function activate(context) {
  const collection =
    vscode.languages.createDiagnosticCollection("bootstrap-ng");
  const triggers = ["<", " ", '"', "'", "[", "(", ":"];

  context.subscriptions.push(
    vscode.languages.registerCompletionItemProvider(
      SELECTOR,
      { provideCompletionItems: provideCompletions },
      ...triggers,
    ),
    vscode.languages.registerHoverProvider(SELECTOR, { provideHover }),
    vscode.languages.registerCodeActionsProvider(
      SELECTOR,
      { provideCodeActions },
      {
        providedCodeActionKinds: [vscode.CodeActionKind.QuickFix],
      },
    ),
    vscode.languages.registerCodeActionsProvider(
      PACKAGE_SELECTOR,
      { provideCodeActions: providePackageCodeActions },
      {
        providedCodeActionKinds: [vscode.CodeActionKind.QuickFix],
      },
    ),
    vscode.commands.registerCommand("bootstrap-ng.openDocs", openDocs),
  );
  watchDiagnostics(context, collection);
  watchPackageFiles(context, collection);
}

function deactivate() {
  return null;
}

module.exports = {
  activate,
  deactivate,
};
