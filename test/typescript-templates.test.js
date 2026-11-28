"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { describe, it } = require("node:test");

const { componentTemplateRanges } = require("../src/angular-component");
const { analyze } = require("../src/context");
const { complete } = require("../src/completions");
const { diagnose } = require("../src/diagnostics");
const { missingInlineImports } = require("../src/imports");

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
    assert.deepEqual(
      diagnose(source, "typescript", { validateImports: false }),
      [],
    );
  });

  it("ignores @Component text inside an inline template", () => {
    const source = `@Component({
  template: \`<p>@Component({ template: '<x/>' })</p><div bsAlert></div>\`,
})
export class App {}`;

    assert.equal(componentTemplateRanges(source).length, 1);
    assert.equal(missingInlineImports(source).length, 1);
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

  it("checks templates written as single- or double-quoted strings", () => {
    for (const quote of ["'", '"']) {
      const attr = quote === "'" ? '"' : "'";
      const source = `@Component({ selector: 'app-root', template: ${quote}<div bsAlert theme=${attr}primray${attr}></div>${quote} })
export class App {}`;
      const found = diagnose(source, "typescript");

      assert.deepEqual(found.map((item) => item.code).sort(), [
        "invalid-value",
        "missing-import",
      ]);
      assert.equal(
        source.slice(found[0].start, found[0].end),
        "primray",
        quote,
      );
    }
  });

  it("keeps completions inside a quoted template string", () => {
    const source = `@Component({ selector: 'app-root', template: "<div [ngClass]='{}'></div> bs-alert" })
export class App {}`;
    const snippet = complete(
      source,
      source.indexOf("bs-alert") + 8,
      "typescript",
    ).find((item) => item.label === "bs-alert");
    const key = complete(source, source.indexOf("{}") + 1, "typescript")[0];

    assert.doesNotMatch(snippet.insertText, /\n/u);
    assert.doesNotMatch(snippet.insertText, /[^\\]"/u);
    assert.match(key.insertText, /^\\".+\\"$/u);
  });

  it("re-reads package.json from disk when it closes instead of clearing it", () => {
    const extension = fs.readFileSync(
      path.join(__dirname, "../src/extension.js"),
      "utf8",
    );
    const onClose = extension.slice(
      extension.indexOf("onDidCloseTextDocument"),
      extension.indexOf("onDidChangeConfiguration"),
    );

    assert.match(onClose, /isPackageJson\(document\)[\s\S]*readPackageFile\(/u);
    assert.match(onClose, /collection\.delete\(document\.uri\);/u);
    assert.doesNotMatch(
      extension.slice(
        extension.indexOf("async function refreshPackageFile"),
        extension.indexOf("function watchPackageFiles"),
      ),
      /openTextDocument/u,
    );
  });

  it("reads escaped attribute quotes in a double-quoted template", () => {
    const source = `import { BsButton, BsCheck } from "bootstrap-ng";

@Component({
  imports: [BsButton, BsCheck],
  template: "<div class=\\"ro\\"><input type=\\"checkbox\\" bsCheck /><button bsButton theme=\\"primray\\"></button></div>",
})
export class Demo {}
`;
    const found = diagnose(source, "typescript");
    const rows = complete(source, source.indexOf('ro\\"') + 2, "typescript");

    assert.deepEqual(
      found.map((item) => source.slice(item.start, item.end)),
      ["primray"],
    );
    assert.ok(rows.some((item) => item.label === "row"));
    assert.equal(source.slice(rows[0].start, rows[0].end), "ro");
  });

  it("keeps escaped quotes when a data API quick fix moves an attribute", () => {
    const source = `@Component({
  template: "<button data-bs-toggle=\\"tooltip\\" title=\\"Hi\\">x</button>",
})
export class Demo {}
`;
    const [hint] = diagnose(source, "typescript");
    let fixed = source;

    for (const edit of [...hint.fixes[0].edits].reverse()) {
      fixed = fixed.slice(0, edit.start) + edit.text + fixed.slice(edit.end);
    }

    assert.match(fixed, /template: "<button bsTooltip=\\"Hi\\">x<\/button>"/u);
  });
});
