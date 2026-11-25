"use strict";

const assert = require("node:assert/strict");
const { describe, it } = require("node:test");

const { complete } = require("../src/completions");

function at(text, marker) {
  const offset = text.indexOf(marker);

  assert.notEqual(offset, -1, marker);

  return offset + marker.length;
}

function labels(items) {
  return items.map((item) => item.label);
}

describe("completions", () => {
  it("suggests directives on a button and not unrelated inputs", () => {
    const html = "<button >";
    const items = labels(complete(html, at(html, "<button "), "html"));

    assert.ok(items.includes("bsButton"));
    assert.equal(items.includes("theme"), false);
  });

  it("suggests theme values and button variants", () => {
    const themed = '<button type="button" bsButton theme="">';
    const variant = '<button type="button" bsButton="">';
    const themes = labels(complete(themed, at(themed, 'theme="'), "html"));
    const variants = labels(
      complete(variant, at(variant, 'bsButton="'), "html"),
    );

    assert.ok(themes.includes("primary"));
    assert.equal(themes.includes("outline"), false);
    assert.ok(variants.includes("outline"));
  });

  it("suggests outputs and boolean inputs for an alert", () => {
    const html = "<div bsAlert >";
    const items = labels(complete(html, at(html, "<div bsAlert "), "html"));

    assert.ok(items.includes("(closed)"));
    assert.ok(items.includes("dismissible"));
    assert.equal(items.includes("[(open)]"), false);
  });

  it("inserts an element snippet from text", () => {
    const html = "\nbsAle";
    const alert = complete(html, html.length, "html").find(
      (item) => item.label === "bsAlert",
    );

    assert.equal(alert.snippet, true);
    assert.match(alert.insertText, /^<div bsAlert>/u);
  });

  it("completes root and entry-point imports", () => {
    const root = "import { BsAl } from 'bootstrap-ng';";
    const entry = "import { Bs } from 'bootstrap-ng/button';";
    const rootLabels = labels(
      complete(root, at(root, "import { BsAl"), "typescript"),
    );
    const entryLabels = labels(
      complete(entry, at(entry, "import { Bs"), "typescript"),
    );

    assert.ok(rootLabels.includes("BsAlert"));
    assert.ok(rootLabels.includes("provideBsTooltipConfig"));
    assert.ok(entryLabels.includes("BsButton"));
    assert.equal(entryLabels.includes("BsAlert"), false);
  });

  it("keeps both snippets when directives share an attribute", () => {
    const items = complete("\nbsRange", "\nbsRange".length, "html").filter(
      (item) => item.label === "bsRange",
    );

    assert.equal(items.length, 2);
    assert.ok(items.some((item) => item.insertText.startsWith("<div")));
    assert.ok(items.some((item) => item.insertText.startsWith("<input")));
  });

  it("suggests Bootstrap 6 classes for the current class token", () => {
    const html = '<div class="d-fl">';
    const items = complete(html, at(html, 'class="d-fl'), "html");
    const flex = items.find((item) => item.label === "d-flex");

    assert.ok(flex);
    assert.ok(items.some((item) => item.label === "d-flow-root"));
    assert.equal(
      items.some((item) => item.label === "sm:d-flex"),
      false,
    );
    assert.equal(html.slice(flex.start, flex.end), "d-fl");
    assert.match(flex.documentation, /display: flex/u);
    assert.match(flex.documentation, /utilities\/display\//u);
  });

  it("skips Bootstrap classes already present on the element", () => {
    const html = '<div class="d-flex flex">';
    const items = complete(html, at(html, 'class="d-flex flex'), "html");
    const wrap = items.find((item) => item.label === "flex-wrap");

    assert.equal(
      items.some((item) => item.label === "d-flex"),
      false,
    );
    assert.ok(wrap);
    assert.equal(html.slice(wrap.start, wrap.end), "flex");
    assert.equal(
      items.some((item) => item.label === "sm:flex-row"),
      false,
    );
  });

  it("suggests responsive Bootstrap classes after a variant prefix", () => {
    const html = '<section class="sm:d-f">';
    const items = complete(html, at(html, 'class="sm:d-f'), "html");
    const flex = items.find((item) => item.label === "sm:d-flex");

    assert.ok(flex);
    assert.match(flex.documentation, /utilities\/display\//u);
    assert.equal(
      items.some((item) => item.label === "d-flex"),
      false,
    );
    assert.equal(html.slice(flex.start, flex.end), "sm:d-f");
  });

  it("suggests classes inside an Angular template and not inside interpolation", () => {
    const source = `@Component({ template: \`<div class="cont">\` })
export class App {}`;
    const interpolated = '<div class="d-flex {{ cont }}">';
    const names = labels(
      complete(source, at(source, 'class="cont'), "typescript"),
    );
    const inside = labels(
      complete(interpolated, at(interpolated, "{{ cont"), "html"),
    );

    assert.ok(names.includes("container"));
    assert.equal(inside.includes("container"), false);
  });

  it("completes custom element tags", () => {
    const html = "<bs-";
    const items = labels(complete(html, html.length, "html"));

    assert.ok(items.includes("bs-icon"));
    assert.ok(items.includes("bs-progress"));
    assert.ok(items.includes("bs-spinner"));
  });
});
