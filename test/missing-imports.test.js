"use strict";

const assert = require("node:assert/strict");
const { describe, it } = require("node:test");

const { diagnose, MISSING_IMPORT_CODE } = require("../src/diagnostics");
const {
  applyEdits,
  buildImportEdits,
  missingInlineImports,
  missingTemplateImports,
} = require("../src/imports");

const INLINE = `import { Component } from '@angular/core';
import { BsButton } from 'bootstrap-ng';

@Component({
  selector: 'app-root',
  imports: [BsButton],
  template: \`<button type="button" bsButton>Go</button>
<div class="mb-3" bsAlert></div>\`,
})
export class App {}
`;

const EXTERNAL = `import { Component } from '@angular/core';
import { BsButton } from 'bootstrap-ng';

@Component({
  selector: 'app-root',
  imports: [BsButton],
  templateUrl: './app.html',
})
export class App {}
`;

const TEMPLATE = `<button type="button" bsButton>Go</button>
<bs-icon name="star"></bs-icon>
`;

function missing(source) {
  return diagnose(source, "typescript").filter(
    (item) => item.code === MISSING_IMPORT_CODE,
  );
}

describe("missing import diagnostics", () => {
  it("flags an inline template directive that is not imported", () => {
    const found = missing(INLINE);

    assert.equal(found.length, 1);
    assert.equal(found[0].severity, "warning");
    assert.match(found[0].message, /BsAlert/u);
    assert.equal(INLINE.slice(found[0].start, found[0].end), "bsAlert");
  });

  it("flags a directive imported from bootstrap-ng but missing from the imports array", () => {
    const source = INLINE.replace(
      "import { BsButton }",
      "import { BsAlert, BsButton }",
    );

    assert.equal(missing(source).length, 1);
  });

  it("stays quiet once the directive is imported and listed", () => {
    const source = INLINE.replace(
      "import { BsButton }",
      "import { BsAlert, BsButton }",
    ).replace("imports: [BsButton]", "imports: [BsAlert, BsButton]");

    assert.deepEqual(missing(source), []);
  });

  it("treats BOOTSTRAP_NG in the imports array as importing every directive", () => {
    const source = INLINE.replace(
      "import { BsButton }",
      "import { BOOTSTRAP_NG }",
    ).replace("imports: [BsButton]", "imports: [BOOTSTRAP_NG]");

    assert.deepEqual(missing(source), []);
  });

  it("stays quiet when the imports come from a constant or a spread", () => {
    const constant = INLINE.replace("imports: [BsButton]", "imports: SHARED");
    const spread = INLINE.replace(
      "imports: [BsButton]",
      "imports: [...SHARED, BsButton]",
    );

    assert.deepEqual(missing(constant), []);
    assert.deepEqual(missing(spread), []);
    assert.equal(
      applyEdits(constant, buildImportEdits(constant, ["BsAlert", "BsButton"])),
      constant,
    );
  });

  it("matches renamed imports by their local name", () => {
    const listed = INLINE.replace(
      "import { BsButton }",
      "import { BsAlert as Alert, BsButton }",
    ).replace("imports: [BsButton]", "imports: [Alert, BsButton]");
    const unlisted = INLINE.replace(
      "import { BsButton }",
      "import { BsAlert as Alert, BsButton }",
    );

    assert.deepEqual(missing(listed), []);
    assert.equal(missing(unlisted).length, 1);
    assert.match(
      applyEdits(unlisted, buildImportEdits(unlisted, ["BsAlert", "BsButton"])),
      /imports: \[ BsButton, Alert \]/u,
    );
  });

  it("ignores components declared in an NgModule", () => {
    const source = INLINE.replace(
      "selector: 'app-root',",
      "selector: 'app-root',\n  standalone: false,",
    );

    assert.deepEqual(missingInlineImports(source), []);
  });

  it("ignores templateUrl components without a standalone imports array", () => {
    const moduleStyle = EXTERNAL.replace("imports: [BsButton],\n  ", "");

    assert.deepEqual(
      diagnose(TEMPLATE, "html", {
        componentSource: moduleStyle,
        templateFile: "app.html",
      }).filter((item) => item.code === MISSING_IMPORT_CODE),
      [],
    );
  });

  it("checks each component in a file against its own imports", () => {
    const source = `${INLINE}
@Component({
  selector: 'app-other',
  imports: [BsAlert],
  template: \`<div bsAlert></div>\`,
})
export class Other {}
`.replace("import { BsButton }", "import { BsAlert, BsButton }");
    const found = missingInlineImports(source);

    assert.equal(found.length, 1);
    assert.ok(found[0].start < source.indexOf("app-other"));
  });

  it("flags element directives in a templateUrl template", () => {
    const found = diagnose(TEMPLATE, "html", {
      componentSource: EXTERNAL,
      templateFile: "app.html",
    }).filter((item) => item.code === MISSING_IMPORT_CODE);

    assert.equal(found.length, 1);
    assert.match(found[0].message, /BsIcon/u);
    assert.equal(TEMPLATE.slice(found[0].start, found[0].end), "bs-icon");
  });

  it("needs the component to reference the template", () => {
    assert.deepEqual(
      missingTemplateImports(TEMPLATE, EXTERNAL, "other.html"),
      [],
    );
    assert.deepEqual(diagnose(TEMPLATE, "html"), []);
  });

  it("can be turned off", () => {
    assert.deepEqual(
      diagnose(INLINE, "typescript", { validateImports: false }),
      [],
    );
    assert.deepEqual(
      diagnose(TEMPLATE, "html", {
        componentSource: EXTERNAL,
        templateFile: "app.html",
        validateImports: false,
      }),
      [],
    );
  });

  it("clears once the fix-all edits are applied", () => {
    const names = [
      ...new Set(missingInlineImports(INLINE).map((item) => item.name)),
    ];
    const fixed = applyEdits(INLINE, buildImportEdits(INLINE, names));

    assert.match(fixed, /import \{ BsButton, BsAlert \} from 'bootstrap-ng';/u);
    assert.deepEqual(missing(fixed), []);
  });
});
