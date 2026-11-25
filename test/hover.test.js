"use strict";

const assert = require("node:assert/strict");
const { describe, it } = require("node:test");

const { hoverAt, symbolAt } = require("../src/hover");

function at(text, marker) {
  const offset = text.indexOf(marker);

  assert.notEqual(offset, -1, marker);

  return offset + marker.length;
}

describe("hover", () => {
  it("describes a directive and links to its docs", () => {
    const html = "<div bsAlert>";
    const hit = hoverAt(html, at(html, "<div bs"), "html");

    assert.match(hit.markdown, /BsAlert/u);
    assert.match(
      hit.markdown,
      /https:\/\/bootstrap-ng\.com\/components\/alert\/#api/u,
    );
  });

  it("describes an input type", () => {
    const html = '<div bsAlert theme="primary">';
    const hit = hoverAt(html, at(html, "theme"), "html");

    assert.match(hit.markdown, /BsTheme/u);
    assert.match(hit.markdown, /theme/u);
  });

  it("describes a Bootstrap 6 class and links to its docs", () => {
    const html = '<div class="d-flex gap-2">';
    const hit = hoverAt(html, at(html, "d-fl"), "html");

    assert.match(hit.markdown, /\*\*d-flex\*\*/u);
    assert.match(hit.markdown, /display: flex/u);
    assert.match(
      hit.markdown,
      /https:\/\/getbootstrap.com\/docs\/6.0\/utilities\/display\//u,
    );
    assert.equal(html.slice(hit.start, hit.end), "d-flex");
  });

  it("describes Bootstrap 6 classes in Angular class bindings", () => {
    const html = `<div [ngClass]="{ 'd-flex': on }" [class.gap-2]="on">`;
    const keyed = hoverAt(html, at(html, "d-fl"), "html");
    const toggled = hoverAt(html, at(html, "gap"), "html");

    assert.match(keyed.markdown, /\*\*d-flex\*\*/u);
    assert.equal(html.slice(keyed.start, keyed.end), "d-flex");
    assert.match(toggled.markdown, /\*\*gap-2\*\*/u);
    assert.equal(html.slice(toggled.start, toggled.end), "gap-2");
  });

  it("picks the directive that matches the host element", () => {
    const input = "<input bsRange>";
    const div = "<div bsRange>";
    const inputHit = hoverAt(input, at(input, "bsRange"), "html");
    const divHit = hoverAt(div, at(div, "bsRange"), "html");

    assert.match(inputHit.markdown, /\*\*BsRangeInput\*\*/u);
    assert.equal(
      symbolAt(input, at(input, "bsRange"), "html").name,
      "BsRangeInput",
    );
    assert.match(divHit.markdown, /\*\*BsRange\*\*/u);
    assert.doesNotMatch(divHit.markdown, /BsRangeInput/u);
    assert.equal(symbolAt(div, at(div, "bsRange"), "html").name, "BsRange");
  });

  it("ignores bootstrap-ng markup in unrelated TypeScript template literals", () => {
    const source = `const tpl = \`<div bsAlert theme="bad">\`;
@Component({ template: \`<button bsButton></button>\` })
export class App {}`;
    const offset = source.indexOf("bad") - 1;

    assert.equal(hoverAt(source, offset, "typescript"), null);
    assert.equal(symbolAt(source, offset, "typescript"), null);
  });
});
