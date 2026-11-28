"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { describe, it } = require("node:test");

const { translate } = require("../src/l10n");

const ROOT = path.join(__dirname, "..");
const LANGUAGES = ["de", "es", "fr", "it", "ja"];

function readJson(file) {
  return JSON.parse(fs.readFileSync(path.join(ROOT, file), "utf8"));
}

function placeholders(text) {
  return (text.match(/\{\d+\}/gu) ?? []).sort();
}

describe("translation files", () => {
  const english = readJson("package.nls.json");
  const reference = readJson("l10n/bundle.l10n.ja.json");

  for (const language of LANGUAGES) {
    it(`package.nls.${language}.json has every manifest key`, () => {
      const translated = readJson(`package.nls.${language}.json`);

      assert.deepEqual(Object.keys(translated), Object.keys(english));
    });

    it(`bundle.l10n.${language}.json keeps every message and placeholder`, () => {
      const translated = readJson(`l10n/bundle.l10n.${language}.json`);

      assert.deepEqual(Object.keys(translated), Object.keys(reference));

      for (const [message, text] of Object.entries(translated)) {
        assert.deepEqual(placeholders(text), placeholders(message), message);
      }
    });
  }
});

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
