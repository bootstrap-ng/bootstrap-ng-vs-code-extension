"use strict";

const assert = require("node:assert/strict");
const { describe, it } = require("node:test");

const {
  applyEdits,
  buildImportEdits,
  classNamesIn,
  templateClassNames,
} = require("../src/imports");

function edited(source) {
  return applyEdits(
    source,
    buildImportEdits(source, templateClassNames(source)),
  );
}

const INLINE = `import { Component } from '@angular/core';
import { BsButton } from 'bootstrap-ng';

@Component({
  selector: 'app-root',
  imports: [BsButton],
  template: \`<div bsAlert theme="success"></div>\`,
})
export class App {}
`;

describe("import edits", () => {
  it("adds a directive to the import and the component imports array", () => {
    const next = edited(INLINE);

    assert.match(next, /import \{ BsButton, BsAlert \} from 'bootstrap-ng';/u);
    assert.match(next, /imports: \[\s*BsButton, BsAlert\s*\]/u);
  });

  it("leaves a component that already imports the directive unchanged", () => {
    const source = INLINE.replaceAll("BsButton", "BsAlert");

    assert.equal(edited(source), source);
  });

  it("inserts into multiline import lists", () => {
    const source = `import { Component } from '@angular/core';
import {
  BsButton,
} from 'bootstrap-ng';

@Component({
  selector: 'app-root',
  imports: [
    BsButton,
  ],
  template: \`<div bsAlert></div>\`,
})
export class App {}
`;
    const next = edited(source);

    assert.match(next, /BsAlert,/u);
    assert.match(next, /imports: \[[\s\S]*BsAlert,/u);
  });

  it("adds the import after the imports in a file without semicolons", () => {
    const source = `import { Component } from '@angular/core'

@Component({
  selector: 'app-root',
  imports: [],
  template: \`<div bsAlert></div>\`,
})
export class App {
  count = 1;
}
`;
    const next = edited(source);

    assert.match(
      next,
      /^import \{ Component \} from '@angular\/core'\nimport \{ BsAlert \} from 'bootstrap-ng'\n\n@Component/u,
    );
    assert.match(next, /export class App \{\n {2}count = 1;\n\}/u);
  });

  it("adds commas to multiline lists without a trailing comma", () => {
    const source = `import { Component } from '@angular/core';
import {
  BsButton
} from 'bootstrap-ng';

@Component({
  selector: 'app-root',
  imports: [
    BsButton // buttons
  ],
  template: \`<div bsAlert></div>\`,
})
export class App {}
`;
    const next = edited(source);

    assert.match(next, /import \{\n {2}BsButton,\n {2}BsAlert,\n\} from/u);
    assert.match(
      next,
      /imports: \[\n {4}BsButton, \/\/ buttons\n {4}BsAlert,\n {2}\]/u,
    );
  });

  it("does not double a trailing comma in a single-line list", () => {
    const source = INLINE.replace("{ BsButton }", "{ BsButton, }").replace(
      "[BsButton]",
      "[BsButton,]",
    );
    const next = edited(source);

    assert.match(next, /import \{ BsButton, BsAlert \} from 'bootstrap-ng';/u);
    assert.match(next, /imports: \[ BsButton, BsAlert \]/u);
  });

  it("does not add a runtime import to an import type", () => {
    const source = `import type { BsTheme } from 'bootstrap-ng';
import { Component } from '@angular/core';

@Component({
  selector: 'app-root',
  template: \`<div bsAlert></div>\`,
})
export class App {}
`;
    const next = edited(source);

    assert.match(next, /import type \{ BsTheme \} from 'bootstrap-ng';/u);
    assert.doesNotMatch(next, /import type \{[^}]*BsAlert/u);
    assert.match(
      next,
      /from '@angular\/core';\nimport \{ BsAlert \} from 'bootstrap-ng';/u,
    );
    assert.match(next, /imports: \[BsAlert\],/u);
  });

  it("updates each component with the directives from its own template", () => {
    const source = `import { Component } from '@angular/core';

@Component({
  selector: 'app-a',
  imports: [],
  template: \`<div bsAlert></div>\`,
})
export class A {}

@Component({
  selector: 'app-b',
  imports: [],
  template: \`<button bsButton></button>\`,
})
export class B {}
`;
    const next = edited(source);
    const parts = next.split("@Component");

    assert.match(
      next,
      /from '@angular\/core';\nimport \{ BsAlert, BsButton \} from 'bootstrap-ng';/u,
    );
    assert.match(parts[1], /BsAlert/u);
    assert.doesNotMatch(parts[1], /BsButton/u);
    assert.match(parts[2], /BsButton/u);
    assert.doesNotMatch(parts[2], /BsAlert/u);
  });

  it("updates the component whose templateUrl matches", () => {
    const source = `import { Component } from '@angular/core';

@Component({
  selector: 'app-a',
  imports: [],
  templateUrl: './a.component.html',
})
export class A {}

@Component({
  selector: 'app-b',
  imports: [],
  templateUrl: './b.component.html',
})
export class B {}
`;
    const next = applyEdits(
      source,
      buildImportEdits(source, ["BsAlert"], {
        templateFile: "b.component.html",
      }),
    );
    const parts = next.split("@Component");

    assert.doesNotMatch(parts[1], /BsAlert/u);
    assert.match(parts[2], /imports: \[\s*BsAlert\s*\]/u);
  });

  it("names only the directive whose host matches", () => {
    assert.deepEqual(classNamesIn('<input type="range" bsRange>'), [
      "BsRangeInput",
    ]);
    assert.deepEqual(classNamesIn("<input bsRange>"), []);
    assert.deepEqual(classNamesIn('<input type="radio" bsCheck>'), []);
    assert.deepEqual(classNamesIn("<div bsButton>"), []);
    assert.deepEqual(classNamesIn("<div bsRange>"), ["BsRange"]);
    assert.deepEqual(classNamesIn("<motion.div bsRange>"), ["BsRange"]);
  });

  it("extends an existing bootstrap-ng subpath import", () => {
    const source = `import { Component } from '@angular/core';
import { BsButton } from 'bootstrap-ng/button';

@Component({
  selector: 'app-root',
  imports: [BsButton],
  template: \`<div bsAlert></div>\`,
})
export class App {}
`;
    const next = applyEdits(source, buildImportEdits(source, ["BsAlert"]));

    assert.doesNotMatch(next, /from 'bootstrap-ng';/u);
    assert.match(
      next,
      /import \{ BsButton, BsAlert \} from 'bootstrap-ng\/button';/u,
    );
  });

  it("ignores directives in template literals outside @Component", () => {
    const source = `import { Component } from '@angular/core';
const tpl = \`<motion.div bsAlert theme="bad"></motion.div>\`;

@Component({
  selector: 'b',
  imports: [],
  template: \`<button bsButton></button>\`,
})
export class B {}
`;
    const next = applyEdits(
      source,
      buildImportEdits(source, templateClassNames(source)),
    );

    assert.match(next, /import \{ BsButton \} from 'bootstrap-ng';/u);
    assert.doesNotMatch(next, /BsAlert/u);
    assert.match(next, /imports: \[ BsButton \]/u);
  });
});
