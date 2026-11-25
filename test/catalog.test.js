"use strict";

const assert = require("node:assert/strict");
const { describe, it } = require("node:test");

const { index } = require("../src/catalog");

describe("catalog", () => {
  it("describes buttons, alerts, and models", () => {
    const button = index.symbol("BsButton");
    const alert = index.symbol("BsAlert");
    const item = index.symbol("BsAccordionItem");

    assert.ok(button.tags.includes("button"));
    assert.ok(
      button.inputs
        .find((input) => input.name === "theme")
        .values.includes("primary"),
    );
    assert.ok(
      button.inputs
        .find((input) => input.name === "bsButton")
        .values.includes("outline"),
    );
    assert.equal(
      alert.inputs.find((input) => input.name === "dismissible").boolean,
      true,
    );
    assert.ok(alert.outputs.some((output) => output.name === "closed"));
    assert.equal(
      item.inputs.find((input) => input.name === "open").model,
      true,
    );
    assert.match(alert.summary, /feedback/u);
  });

  it("includes elements, services, config, and unique names", () => {
    const names = index.symbols.map((symbol) => symbol.name);
    const drawer = index.symbol("BsDrawer");

    assert.ok(index.symbol("BsIcon").tags.includes("bs-icon"));
    assert.equal(index.symbol("BsLiveAnnouncer").kind, "service");
    assert.equal(index.symbol("BOOTSTRAP_NG").kind, "constant");
    assert.match(index.symbol("provideBsTooltipConfig").summary, /placement/u);
    assert.ok(drawer.inputs.length > 1);
    assert.ok(
      index
        .attribute("bsDrawerClose")
        .some((symbol) => symbol.name === "BsDialogClose"),
    );
    assert.equal(new Set(names).size, names.length);
  });

  it("keeps shared attributes on the host they belong to", () => {
    assert.deepEqual(
      index.directivesFor("input", ["bsRange"]).map((symbol) => symbol.name),
      ["BsRangeInput"],
    );
    assert.deepEqual(
      index.directivesFor("div", ["bsRange"]).map((symbol) => symbol.name),
      ["BsRange"],
    );
  });
});
