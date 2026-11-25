"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { describe, it } = require("node:test");

const { componentTemplateRanges } = require("../src/angular-component");
const { analyze } = require("../src/context");
const { complete } = require("../src/completions");
const { diagnose } = require("../src/diagnostics");

describe("TypeScript template scoping", () => {
  it("does not treat arbitrary backtick strings as component templates", () => {
    const source = `const tpl = \`<div bsAlert theme="bad">\`;
@Component({ template: \`<button bsButton></button>\` })
export class App {}`;
    const offset = source.indexOf("bad") - 1;

    assert.equal(analyze(source, offset, "typescript"), null);
    assert.deepEqual(complete(source, offset, "typescript"), []);
  });

  it("keeps inline templates when metadata comments include closing braces", () => {
    const source = `@Component({
  // }
  template: \`<motion.div bsAlert theme="success"></motion.div>\`,
})
export class App {}`;
    const ranges = componentTemplateRanges(source);

    assert.equal(ranges.length, 1);
    assert.match(ranges[0].content, /bsAlert/u);
    assert.deepEqual(diagnose(source, "typescript"), []);
  });

  it("ignores @Component in line comments and string literals", () => {
    const source = `const note = "// @Component({ template: \\\`<motion.div bsAlert></motion.div>\\\` })";
// @Component({ template: \`<div bsAlert></div>\` })
@Component({ template: \`<button bsButton></button>\` })
export class App {}`;

    assert.deepEqual(
      componentTemplateRanges(source).map((range) => range.content),
      ["<button bsButton></button>"],
    );
  });

  it("supports quoted template keys and ignores nested template properties", () => {
    const quoted = `@Component({ "template": \`<motion.div bsAlert></motion.div>\` })
export class App {}`;
    const nested = `@Component({
  providers: [{ provide: X, useValue: { template: \`<wrong>\` } }],
  template: \`<right>\`,
})
export class App {}`;

    assert.deepEqual(
      componentTemplateRanges(quoted).map((range) => range.content),
      ["<motion.div bsAlert></motion.div>"],
    );
    assert.deepEqual(
      componentTemplateRanges(nested).map((range) => range.content),
      ["<right>"],
    );
  });

  it("clears diagnostics when any document closes, including package.json", () => {
    const extension = fs.readFileSync(
      path.join(__dirname, "../src/extension.js"),
      "utf8",
    );

    assert.match(
      extension,
      /onDidCloseTextDocument\(\(document\) => \{\s*collection\.delete\(document\.uri\);/u,
    );
    assert.doesNotMatch(
      extension,
      /onDidCloseTextDocument[\s\S]{0,120}isPackageJson\(document\)[\s\S]{0,40}return;/u,
    );
  });
});
