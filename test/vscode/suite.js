"use strict";

/*
 * Smoke tests for the VS Code wiring in src/extension.js. Runs inside the
 * extension host, so it uses node:assert and a tiny runner instead of
 * node:test.
 */

/* eslint-disable no-console -- the extension host only forwards console output. */

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vscode = require("vscode");

const tests = [];

function test(name, body) {
  tests.push({ body, name });
}

function workspaceUri(...segments) {
  const [folder] = vscode.workspace.workspaceFolders;

  return vscode.Uri.joinPath(folder.uri, ...segments);
}

async function waitFor(check, message) {
  const deadline = Date.now() + 10_000;

  while (Date.now() < deadline) {
    // eslint-disable-next-line no-await-in-loop
    const value = await Promise.resolve()
      .then(check)
      .catch((error) => {
        // VS Code cancels provider requests while it is still settling.
        if (error.name === "Canceled") {
          return null;
        }

        throw error;
      });

    if (value) {
      return value;
    }

    // eslint-disable-next-line no-await-in-loop
    await new Promise((resolve) => {
      setTimeout(resolve, 100);
    });
  }

  throw new Error(`Timed out: ${message}`);
}

function bootstrapDiagnostics(uri) {
  return vscode.languages
    .getDiagnostics(uri)
    .filter((item) => item.source === "bootstrap-ng");
}

/*
 * The first code action request right after a document opens can be
 * cancelled or miss a provider, so retry until the action shows up.
 */
function findCodeAction(uri, range, title) {
  return waitFor(async () => {
    const actions = await vscode.commands.executeCommand(
      "vscode.executeCodeActionProvider",
      uri,
      range,
      vscode.CodeActionKind.QuickFix.value,
    );

    return actions.find((item) => item.title.includes(title));
  }, `${title} code action`);
}

test("activates and registers the docs command", async () => {
  const extension = vscode.extensions.getExtension("coliff.bootstrap-ng");

  assert.ok(extension, "extension not found");
  await extension.activate();
  assert.ok(extension.isActive);

  const commands = await vscode.commands.getCommands(true);

  assert.ok(commands.includes("bootstrap-ng.openDocs"));
});

test("shows a hover for a directive", async () => {
  const document = await vscode.workspace.openTextDocument(
    workspaceUri("alert.component.html"),
  );
  const offset = document.getText().indexOf("bsAlert") + 2;

  await waitFor(async () => {
    const hovers = await vscode.commands.executeCommand(
      "vscode.executeHoverProvider",
      document.uri,
      document.positionAt(offset),
    );

    return hovers
      .flatMap((hover) => hover.contents)
      .some((content) => /BsAlert/u.test(content.value ?? String(content)));
  }, "BsAlert hover");
});

test("offers to import a directive into the sibling .ts file", async () => {
  const document = await vscode.workspace.openTextDocument(
    workspaceUri("alert.component.html"),
  );
  const start = document.positionAt(document.getText().indexOf("bsAlert") + 2);
  const action = await findCodeAction(
    document.uri,
    new vscode.Range(start, start),
    "BsAlert",
  );
  const [[uri, edits]] = action.edit.entries();

  assert.equal(path.basename(uri.fsPath), "alert.component.ts");
  assert.ok(edits.some((edit) => edit.newText.includes("BsAlert")));
});

test("flags 6.0.0-alpha.1 in package.json and offers a fix", async () => {
  const { uri } = await vscode.workspace.openTextDocument(
    workspaceUri("package.json"),
  );
  const [diagnostic] = await waitFor(
    () => bootstrapDiagnostics(uri).length > 0 && bootstrapDiagnostics(uri),
    "package.json diagnostic",
  );

  await findCodeAction(uri, diagnostic.range, "Update to 6.0.0-alpha.2");
});

test("watches package.json files created and deleted on disk", async () => {
  const uri = workspaceUri("nested", "package.json");

  fs.mkdirSync(path.dirname(uri.fsPath), { recursive: true });
  fs.writeFileSync(
    uri.fsPath,
    '{ "dependencies": { "bootstrap": "^6.0.0-alpha.1" } }\n',
  );
  await waitFor(
    () => bootstrapDiagnostics(uri).length > 0,
    "diagnostic for a created package.json",
  );

  fs.rmSync(uri.fsPath);
  await waitFor(
    () => bootstrapDiagnostics(uri).length === 0,
    "diagnostics cleared for a deleted package.json",
  );
});

async function run() {
  const failures = [];

  for (const { body, name } of tests) {
    try {
      // eslint-disable-next-line no-await-in-loop
      await body();
      console.log(`ok - ${name}`);
    } catch (error) {
      failures.push(name);
      console.error(`not ok - ${name}\n${error.stack}`);
    }
  }

  if (failures.length > 0) {
    throw new Error(`${failures.length} of ${tests.length} tests failed`);
  }
}

module.exports = { run };
