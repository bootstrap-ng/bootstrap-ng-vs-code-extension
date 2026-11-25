"use strict";

const assert = require("node:assert/strict");
const { describe, it } = require("node:test");

const { diagnose } = require("../src/diagnostics");

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
});
