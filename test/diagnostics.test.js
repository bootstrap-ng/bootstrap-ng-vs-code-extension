"use strict";

const assert = require("node:assert/strict");
const { describe, it } = require("node:test");

const { closestValues, diagnose } = require("../src/diagnostics");

function applyFix(text, fix) {
  return [...fix.edits]
    .sort((left, right) => right.start - left.start)
    .reduce(
      (result, edit) =>
        result.slice(0, edit.start) + edit.text + result.slice(edit.end),
      text,
    );
}

describe("diagnostics", () => {
  it("warns about unknown static theme values", () => {
    const found = diagnose(
      '<button type="button" bsButton theme="blue"></button>',
      "html",
    );

    assert.equal(found.length, 1);
    assert.equal(found[0].severity, "warning");
    assert.match(found[0].message, /blue/u);
  });

  it("accepts documented values, bindings, and ordinary classes", () => {
    assert.deepEqual(
      diagnose(
        '<button type="button" bsButton theme="primary"></button>',
        "html",
      ),
      [],
    );
    assert.deepEqual(
      diagnose(
        '<button type="button" bsButton [theme]="blue"></button>',
        "html",
      ),
      [],
    );
    assert.deepEqual(
      diagnose('<div class="card container"></div>', "html"),
      [],
    );
  });

  it("hints at Bootstrap 5 data attributes", () => {
    const toggle = diagnose(
      '<button data-bs-toggle="tooltip"></button>',
      "html",
    );
    const dismiss = diagnose(
      '<button data-bs-dismiss="modal"></button>',
      "html",
    );

    assert.equal(toggle[0].severity, "information");
    assert.match(toggle[0].message, /bsTooltip/u);
    assert.match(dismiss[0].message, /bsDialogClose/u);
  });

  it("names the toggle directives for collapse, dropdown and offcanvas", () => {
    const hint = (value) =>
      diagnose(`<button data-bs-toggle="${value}"></button>`, "html")[0]
        .message;

    assert.match(hint("collapse"), /bsCollapseToggle/u);
    assert.match(hint("dropdown"), /bsMenuToggle/u);
    assert.match(hint("offcanvas"), /bsDrawerToggle/u);
  });

  it("ignores examples inside comments and raw text", () => {
    assert.deepEqual(
      diagnose('<!-- <button data-bs-dismiss="modal"></button> -->', "html"),
      [],
    );
    assert.deepEqual(
      diagnose(
        "<script>const html = '<button data-bs-toggle=\"tooltip\"></button>';</script>",
        "html",
      ),
      [],
    );
    assert.equal(
      diagnose('<button data-bs-toggle="tooltip"></button>', "html").length,
      1,
    );
    assert.deepEqual(
      diagnose('<div class="foo\\"extra" bsButton></div>', "html"),
      [],
    );
  });

  it("ignores bootstrap-ng markup in unrelated TypeScript template literals", () => {
    const source = `const tpl = \`<div bsAlert theme="bad"></div>\`;

@Component({
  template: \`<motion.div bsAlert theme="success"></motion.div>\`,
})
export class App {}
`;
    assert.deepEqual(
      diagnose(source, "typescript", { validateImports: false }),
      [],
    );
  });

  it("can turn each diagnostic off", () => {
    const theme = '<button type="button" bsButton theme="blue"></button>';
    const toggle = '<button data-bs-toggle="modal"></button>';

    assert.deepEqual(
      diagnose(theme, "html", { validateAttributeValues: false }),
      [],
    );
    assert.deepEqual(
      diagnose(toggle, "html", { hintBootstrap5DataApi: false }),
      [],
    );
  });

  it("suggests the closest documented value for a typo", () => {
    const html = '<button type="button" bsButton theme="primray"></button>';
    const [item] = diagnose(html, "html");

    assert.equal(item.code, "invalid-value");
    assert.equal(item.fixes.length, 1);
    assert.equal(item.fixes[0].title, 'Change to "primary"');
    assert.equal(item.fixes[0].preferred, true);
    assert.equal(
      applyFix(html, item.fixes[0]),
      '<button type="button" bsButton theme="primary"></button>',
    );
  });

  it("matches values regardless of case", () => {
    assert.deepEqual(closestValues("Danger", ["danger", "dark"]), ["danger"]);
    assert.deepEqual(
      diagnose(
        '<button type="button" bsButton theme="Primary"></button>',
        "html",
      ),
      [],
    );
  });

  it("offers no value fix when nothing is close", () => {
    const [item] = diagnose(
      '<button type="button" bsButton theme="blue"></button>',
      "html",
    );

    assert.deepEqual(item.fixes, []);
    assert.deepEqual(closestValues("zzzzzz", ["primary", "secondary"]), []);
  });

  it("shifts quick fix edits inside inline templates", () => {
    const source =
      '@Component({ template: `<button data-bs-dismiss="toast"></button>` })';
    const [item] = diagnose(source, "typescript");

    assert.equal(
      applyFix(source, item.fixes[0]),
      "@Component({ template: `<button bsToastClose></button>` })",
    );
  });

  it("replaces Bootstrap 5 dismiss attributes with close directives", () => {
    const cases = {
      modal: "bsDialogClose",
      offcanvas: "bsDrawerClose",
      toast: "bsToastClose",
    };

    for (const [value, directive] of Object.entries(cases)) {
      const html = `<button type="button" data-bs-dismiss="${value}"></button>`;
      const [item] = diagnose(html, "html");

      assert.equal(item.code, "bootstrap5-data-api");
      assert.equal(item.fixes[0].title, `Replace with ${directive}`);
      assert.equal(
        applyFix(html, item.fixes[0]),
        `<button type="button" ${directive}></button>`,
      );
    }
  });

  it("moves tooltip and popover data attributes onto the directive", () => {
    const tooltip =
      '<button data-bs-toggle="tooltip" data-bs-placement="top" title="Hi">Go</button>';
    const popover =
      "<button data-bs-toggle='popover' data-bs-title='Title' data-bs-content='Body'>Go</button>";

    assert.equal(
      applyFix(tooltip, diagnose(tooltip, "html")[0].fixes[0]),
      '<button bsTooltip="Hi" placement="top">Go</button>',
    );
    assert.equal(
      applyFix(popover, diagnose(popover, "html")[0].fixes[0]),
      "<button bsPopover='Body' popoverTitle='Title'>Go</button>",
    );
  });

  it("keeps the hint without a fix when the target needs a reference", () => {
    for (const value of ["collapse", "dropdown", "modal", "offcanvas"]) {
      const [item] = diagnose(
        `<button data-bs-toggle="${value}"></button>`,
        "html",
      );

      assert.equal(item.severity, "information");
      assert.deepEqual(item.fixes, []);
    }

    const [alert] = diagnose(
      '<button data-bs-dismiss="alert"></button>',
      "html",
    );

    assert.deepEqual(alert.fixes, []);
  });

  it("does not hang on templates that start with a script-like tag name", () => {
    assert.deepEqual(diagnose("<styled-box></styled-box>", "html"), []);
    assert.deepEqual(diagnose("<scripts></scripts>", "html"), []);
  });

  it("scales linearly with template size", () => {
    const block = `<div class="card" bsAlert theme="success">
  <!-- a comment <b> -->
  <button bsButton="outline" data-bs-toggle="tooltip">{{ name }}</button>
</div>
`;
    const html = block.repeat(5000);
    const started = performance.now();

    assert.equal(diagnose(html, "html").length, 5000);
    assert.ok(performance.now() - started < 2000);
  });

  it("checks a textarea's own attributes but not its content", () => {
    const found = diagnose(
      '<textarea bsFormControl size="huge"><div bsAlert theme="nope"></div></textarea>',
      "html",
    );

    assert.equal(found.length, 1);
    assert.match(found[0].message, /size="huge"/u);
  });

  it("keeps checking after a textarea whose text contains <script", () => {
    const found = diagnose(
      '<textarea><script></textarea><div bsAlert theme="nope"></div>',
      "html",
    );

    assert.equal(found.length, 1);
    assert.match(found[0].message, /theme="nope"/u);
  });
});
