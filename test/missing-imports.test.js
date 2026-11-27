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

  it("stays quiet when the directive comes from a relative path or barrel", () => {
    const relative = INLINE.replace(
      "import { BsButton } from 'bootstrap-ng';",
      "import { BsAlert, BsButton } from './alert';",
    ).replace("imports: [BsButton]", "imports: [BsAlert, BsButton]");
    const barrel = INLINE.replace(
      "import { BsButton } from 'bootstrap-ng';",
      "import { BsAlert, BsButton } from '../shared/ui';",
    ).replace("imports: [BsButton]", "imports: [BsAlert, BsButton]");

    assert.deepEqual(missing(relative), []);
    assert.deepEqual(missing(barrel), []);
  });

  it("adds a directive imported from a relative path only to the imports array", () => {
    const source = INLINE.replace(
      "import { BsButton } from 'bootstrap-ng';",
      "import { BsAlert, BsButton } from './alert';",
    );
    const fixed = applyEdits(
      source,
      buildImportEdits(source, ["BsAlert", "BsButton"]),
    );

    assert.equal(missing(source).length, 1);
    assert.match(fixed, /imports: \[ BsButton, BsAlert \]/u);
    assert.doesNotMatch(fixed, /from 'bootstrap-ng'/u);
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

  it("ignores ng-template tags without a directive attribute", () => {
    const source = INLINE.replace(
      '<div class="mb-3" bsAlert></div>',
      '<ng-template #header let-id="id"><span>{{ id }}</span></ng-template>',
    );

    assert.deepEqual(missing(source), []);
  });

  it("flags an ng-template directive that is not imported", () => {
    const source = INLINE.replace(
      '<div class="mb-3" bsAlert></div>',
      '<ng-template bsRatingStar let-fill="fill">{{ fill }}</ng-template>',
    );
    const found = missing(source);

    assert.equal(found.length, 1);
    assert.match(found[0].message, /BsRatingStar/u);
  });

  it("counts a directive declared in the same file as imported", () => {
    const source = `import { Component } from '@angular/core';

@Component({ selector: 'button[bsChipDismiss]', template: '' })
export class BsChipDismiss {}

@Component({
  selector: 'app-chips',
  imports: [BsChipDismiss],
  template: \`<button bsChipDismiss type="button"></button>\`,
})
export class Chips {}
`;

    assert.deepEqual(missing(source), []);
    assert.match(
      missing(source.replace("imports: [BsChipDismiss],", ""))[0].message,
      /BsChipDismiss/u,
    );
  });

  it("ignores class names in comments and keeps renamed imports", () => {
    const source = INLINE.replace(
      "import { BsButton }",
      "import { BsAlert as Alert, BsButton }",
    )
      .replace("imports: [BsButton]", "imports: [Alert, BsButton]")
      .replace(
        "@Component",
        "/** Wraps the class BsAlert as Alert. */\n@Component",
      );

    assert.deepEqual(missing(source), []);
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

  it("flags a directive on a textarea", () => {
    const source = INLINE.replace(
      '<div class="mb-3" bsAlert></div>',
      "<textarea bsFormControl></textarea>",
    );

    assert.deepEqual(
      missingInlineImports(source).map((item) => item.name),
      ["BsFormControl"],
    );
  });

  it("does not add imports to a standalone: false component", () => {
    const source = INLINE.replace("imports: [BsButton],", "standalone: false,");

    assert.deepEqual(buildImportEdits(source, ["BsAlert", "BsButton"]), []);
  });
});
