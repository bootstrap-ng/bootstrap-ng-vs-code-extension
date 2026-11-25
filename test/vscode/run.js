"use strict";

/*
 * Launches VS Code with the compiled extension and runs suite.js inside the
 * extension host. A throwaway workspace is written to a temp folder so the
 * suite can create and delete files without touching the repository.
 */

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { runTests } = require("@vscode/test-electron");

const COMPONENT_HTML = '<div bsAlert theme="success"></div>\n';

const COMPONENT_TS = `import { Component } from '@angular/core';

@Component({
  selector: 'app-alert',
  templateUrl: './alert.component.html',
})
export class AlertComponent {}
`;

const PACKAGE_JSON = `{
  "dependencies": {
    "bootstrap-ng": "6.0.0-alpha.1"
  }
}
`;

function createWorkspace() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "bootstrap-ng-"));

  fs.writeFileSync(path.join(root, "package.json"), PACKAGE_JSON);
  fs.writeFileSync(path.join(root, "alert.component.html"), COMPONENT_HTML);
  fs.writeFileSync(path.join(root, "alert.component.ts"), COMPONENT_TS);

  return root;
}

async function main() {
  const workspace = createWorkspace();

  try {
    await runTests({
      extensionDevelopmentPath: path.resolve(__dirname, "../.."),
      extensionTestsPath: path.resolve(__dirname, "suite.js"),
      launchArgs: [workspace, "--disable-extensions", "--skip-welcome"],
    });
  } finally {
    fs.rmSync(workspace, { force: true, recursive: true });
  }
}

main().catch((error) => {
  process.stderr.write(`${error.stack ?? error.message}\n`);
  process.exit(1);
});
