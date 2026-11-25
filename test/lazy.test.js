"use strict";

const assert = require("node:assert/strict");
const path = require("node:path");
const { describe, it } = require("node:test");

function isLoaded(file) {
  return Object.hasOwn(
    require.cache,
    path.join(__dirname, "..", "src", "data", file),
  );
}

describe("lazy data", () => {
  it("does not load the catalog or class data until first use", () => {
    const { complete } = require("../src/completions");
    const { diagnoseDependencies } = require("../src/dependencies");
    require("../src/diagnostics");
    require("../src/hover");
    require("../src/imports");

    diagnoseDependencies('{ "dependencies": { "react": "19.0.0" } }');

    assert.equal(isLoaded("catalog.json"), false);
    assert.equal(isLoaded("classes.json"), false);

    complete("<button >", 8, "html");
    complete('<div class="d-">', 14, "html");

    assert.equal(isLoaded("catalog.json"), true);
    assert.equal(isLoaded("classes.json"), true);
  });
});
