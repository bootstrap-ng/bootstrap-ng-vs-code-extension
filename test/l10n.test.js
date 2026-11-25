"use strict";

const assert = require("node:assert/strict");
const { describe, it } = require("node:test");

const { translate } = require("../src/l10n");

describe("localization", () => {
  it("fills numbered placeholders outside the extension host", () => {
    assert.equal(
      translate("Import {0} from bootstrap-ng", "BsAlert"),
      "Import BsAlert from bootstrap-ng",
    );
  });

  it("leaves text without placeholders unchanged", () => {
    assert.equal(
      translate("Open bootstrap-ng documentation"),
      "Open bootstrap-ng documentation",
    );
  });
});
