"use strict";

const fs = require("node:fs");
const vscode = require("vscode");

const { complete } = require("./completions");
const {
  ALPHA1_CODE,
  diagnoseDependencies,
  updatedSpecifier,
} = require("./dependencies");
const { diagnose, MISSING_IMPORT_CODE } = require("./diagnostics");
const { documentationItems } = require("./docs");
const { hoverAt, symbolAt } = require("./hover");
const { translate } = require("./l10n");
const {
  buildImportEdits,
  classNamesIn,
  missingInlineImports,
  pendingImports,
  templateClassNames,
} = require("./imports");

const PACKAGE_SELECTOR = [
  { language: "json", pattern: "**/package.json", scheme: "file" },
  { language: "jsonc", pattern: "**/package.json", scheme: "file" },
];

const FIX_ALL_KIND = vscode.CodeActionKind.SourceFixAll.append("bootstrap-ng");

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
    validateHostElements: config.get("validateHostElements") !== false,
    validateImports: config.get("validateImports") !== false,
  };
}

function siblingPath(document, from, to) {
  const path = document.uri.fsPath;

  if (document.uri.scheme !== "file" || !path.endsWith(from)) {
    return null;
  }

  return path.slice(0, -from.length) + to;
}

function openDocumentAt(path) {
  return vscode.workspace.textDocuments.find(
    (document) =>
      document.uri.scheme === "file" && document.uri.fsPath === path,
  );
}

function componentSource(document) {
  const path = siblingPath(document, ".html", ".ts");

  if (!path) {
    return null;
  }

  const open = openDocumentAt(path);

  if (open) {
    return open.getText();
  }

  try {
    return fs.readFileSync(path, "utf8");
  } catch {
    return null;
  }
}

function diagnosticOptions(document) {
  const options = readOptions();

  if (document.languageId !== "html" || !options.validateImports) {
    return options;
  }

  const source = componentSource(document);

  return source
    ? { ...options, ...importOptions(document), componentSource: source }
    : options;
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

// Stands in for a TextDocument's positionAt when the text came from disk.
function textPositions(text) {
  const lineStarts = [0];

  for (let index = 0; index < text.length; index += 1) {
    if (text[index] === "\n") {
      lineStarts.push(index + 1);
    }
  }

  return {
    positionAt(offset) {
      let low = 0;
      let high = lineStarts.length - 1;

      while (low < high) {
        const middle = Math.ceil((low + high) / 2);

        if (lineStarts[middle] <= offset) {
          low = middle;
        } else {
          high = middle - 1;
        }
      }

      return new vscode.Position(low, offset - lineStarts[low]);
    },
  };
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
    diagnosticOptions(document),
  );
  collection.set(
    document.uri,
    found.map((item) => toDiagnostic(document, item)),
  );
}

function watchDiagnostics(context, collection) {
  const refreshOne = (document) => refreshDiagnostics(collection, document);
  const refresh = (document) => {
    refreshOne(document);

    const template = siblingPath(document, ".ts", ".html");
    const open = template ? openDocumentAt(template) : null;

    if (open) {
      refreshOne(open);
    }
  };

  context.subscriptions.push(
    collection,
    vscode.workspace.onDidOpenTextDocument(refresh),
    vscode.workspace.onDidChangeTextDocument((event) =>
      refresh(event.document),
    ),
    vscode.workspace.onDidCloseTextDocument((document) => {
      if (isPackageJson(document)) {
        /*
         * VS Code also closes the package.json files the startup scan read,
         * so fall back to the saved file instead of dropping its warnings.
         */
        readPackageFile(collection, document.uri).catch(() => {
          collection.delete(document.uri);
        });
        return;
      }

      collection.delete(document.uri);
    }),
    vscode.workspace.onDidChangeConfiguration((event) => {
      if (!event.affectsConfiguration("bootstrap-ng")) {
        return;
      }

      for (const document of vscode.workspace.textDocuments) {
        refreshOne(document);
      }
    }),
  );

  for (const document of vscode.workspace.textDocuments) {
    refreshOne(document);
  }
}

async function readPackageFile(collection, uri) {
  const bytes = await vscode.workspace.fs.readFile(uri);
  const text = new TextDecoder().decode(bytes);
  const positions = textPositions(text);

  collection.set(
    uri,
    diagnoseDependencies(text).map((item) => toDiagnostic(positions, item)),
  );
}

async function refreshPackageFile(collection, uri) {
  if (!isPackageUri(uri)) {
    return;
  }

  const open = vscode.workspace.textDocuments.find(
    (document) => document.uri.toString() === uri.toString(),
  );

  if (open) {
    setPackageDiagnostics(collection, open);
    return;
  }

  try {
    /*
     * Read from disk rather than opening a document: VS Code closes documents
     * it opened in the background, which would fire onDidCloseTextDocument.
     */
    await readPackageFile(collection, uri);
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

function wantsFixAll(context) {
  return Boolean(context.only?.contains(FIX_ALL_KIND));
}

function isMissingImport(diagnostic) {
  return (
    diagnostic.source === "bootstrap-ng" &&
    diagnostic.code === MISSING_IMPORT_CODE
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

function directiveAt(document, range) {
  const symbol = symbolAt(
    document.getText(),
    document.offsetAt(range.start),
    document.languageId,
  );

  return symbol?.kind === "directive" ? symbol : null;
}

function missingNames(tsText) {
  const names = new Set(missingInlineImports(tsText).map((item) => item.name));

  return [...names].sort();
}

function importEdit(target, names, options) {
  const workspaceEdit = new vscode.WorkspaceEdit();

  for (const edit of buildImportEdits(target.getText(), names, options)) {
    const editRange = new vscode.Range(
      target.positionAt(edit.start),
      target.positionAt(edit.end),
    );
    workspaceEdit.replace(target.uri, editRange, edit.text);
  }

  return workspaceEdit;
}

function matchingDiagnostic(context, item, range) {
  return (
    context.diagnostics?.find(
      (diagnostic) =>
        diagnostic.source === "bootstrap-ng" &&
        diagnostic.code === item.code &&
        diagnostic.range.isEqual(range),
    ) ?? null
  );
}

function diagnosticFixes(document, range, context) {
  const actions = [];
  const found = diagnose(
    document.getText(),
    document.languageId,
    readOptions(),
  );

  for (const item of found) {
    if (!item.fixes?.length) {
      continue;
    }

    const itemRange = new vscode.Range(
      document.positionAt(item.start),
      document.positionAt(item.end),
    );

    if (!itemRange.intersection(range)) {
      continue;
    }

    const diagnostic = matchingDiagnostic(context, item, itemRange);

    for (const fix of item.fixes) {
      const action = new vscode.CodeAction(
        fix.title,
        vscode.CodeActionKind.QuickFix,
      );
      const edit = new vscode.WorkspaceEdit();

      for (const change of fix.edits) {
        edit.replace(
          document.uri,
          new vscode.Range(
            document.positionAt(change.start),
            document.positionAt(change.end),
          ),
          change.text,
        );
      }

      if (diagnostic) {
        action.diagnostics = [diagnostic];
      }

      action.edit = edit;
      action.isPreferred = fix.preferred;
      actions.push(action);
    }
  }

  return actions;
}

async function importActions(document, range, context) {
  const quickFix = wantsQuickFix(context);
  const diagnostics = quickFix
    ? context.diagnostics.filter(isMissingImport)
    : [];
  const symbol = quickFix ? directiveAt(document, range) : null;
  // Fix-all runs on save, so it only edits the document being saved.
  const fixAll = wantsFixAll(context) && document.languageId === "typescript";

  if (!fixAll && !symbol && diagnostics.length === 0) {
    return [];
  }

  const target = await componentDocument(document);

  if (!target) {
    return [];
  }

  const names = usedNames(document, target);
  const options = importOptions(document);
  const pending = pendingImports(target.getText(), names, options);
  const offerQuickFix =
    pending.length > 0 &&
    (diagnostics.length > 0 || pending.includes(symbol?.name));
  const actions = [];

  if (quickFix && offerQuickFix) {
    const action = new vscode.CodeAction(
      actionTitle(pending),
      vscode.CodeActionKind.QuickFix,
    );

    action.diagnostics = diagnostics;
    action.edit = importEdit(target, names, options);
    action.isPreferred = diagnostics.length > 0;
    actions.push(action);
  }

  const fixAllNames = fixAll ? missingNames(target.getText()) : [];

  if (fixAllNames.length > 0) {
    const action = new vscode.CodeAction(
      translate("Import missing bootstrap-ng directives"),
      FIX_ALL_KIND,
    );

    action.edit = importEdit(target, fixAllNames, options);
    actions.push(action);
  }

  return actions;
}

async function provideCodeActions(document, range, context) {
  if (!isSupported(document)) {
    return [];
  }

  const fixes = wantsQuickFix(context)
    ? diagnosticFixes(document, range, context)
    : [];
  const imports = await importActions(document, range, context);

  return [...fixes, ...imports];
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
  const triggers = ["<", " ", '"', "'", "[", "(", ":", "."];

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
        providedCodeActionKinds: [vscode.CodeActionKind.QuickFix, FIX_ALL_KIND],
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
