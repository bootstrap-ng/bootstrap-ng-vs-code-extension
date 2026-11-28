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

  it("offers component snippets in inline templates only", () => {
    const source = "@Component({ template: `\n  bs-acc\n` })";
    const accordion = complete(source, at(source, "bs-acc"), "typescript").find(
      (item) => item.label === "bs-accordion",
    );
    const html = "\nbs-acc";

    assert.equal(accordion.snippet, true);
    assert.match(accordion.insertText, /^<div bsAccordion>/u);
    assert.equal(
      complete(html, html.length, "html").some(
        (item) => item.label === "bs-accordion",
      ),
      false,
    );
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

  it("suggests classes in string literals of [class] and [ngClass]", () => {
    const bound = `<div [class]="'d-flex jus'">`;
    const listed = `<div [ngClass]="['d-flex', isOpen ? 'sho' : '']">`;
    const keyed = `<div [ngClass]="{ 'd-fl': wide, active: on }">`;
    const items = complete(bound, at(bound, "'d-flex jus"), "html");
    const justify = items.find(
      (item) => item.label === "justify-content-center",
    );

    assert.ok(justify);
    assert.equal(bound.slice(justify.start, justify.end), "jus");
    assert.equal(justify.insertText, "justify-content-center");
    assert.equal(
      items.some((item) => item.label === "d-flex"),
      false,
    );
    assert.ok(
      labels(complete(listed, at(listed, "'sho"), "html")).includes("show"),
    );
    assert.ok(
      labels(complete(keyed, at(keyed, "'d-fl"), "html")).includes("d-flex"),
    );
  });

  it("quotes class names typed as bare [ngClass] object keys", () => {
    const html = `<div [ngClass]="{ active: on, d-fl }">`;
    const items = complete(html, at(html, "d-fl"), "html");
    const flex = items.find((item) => item.label === "d-flex");

    assert.ok(flex);
    assert.equal(flex.insertText, "'d-flex'");
    assert.equal(html.slice(flex.start, flex.end), "d-fl");
  });

  it("ignores identifiers and values inside class binding expressions", () => {
    const html = `<div [ngClass]="{ 'd-flex': cont, x: fn(cont) }">`;

    assert.deepEqual(complete(html, at(html, "': cont"), "html"), []);
    assert.deepEqual(complete(html, at(html, "fn(cont"), "html"), []);
  });

  it("suggests the class name in a [class.name] binding", () => {
    const html = '<div class="d-flex" [class.fle]="on">';
    const items = complete(html, at(html, "[class.fle"), "html");
    const grow = items.find((item) => item.label === "flex-grow-1");

    assert.ok(grow);
    assert.equal(html.slice(grow.start, grow.end), "fle");
    assert.equal(grow.insertText, "flex-grow-1");
    assert.equal(
      items.some((item) => item.label === "d-flex"),
      false,
    );
  });

  it("suggests class bindings inside an Angular template", () => {
    const source = `@Component({ template: \`<div [ngClass]="'cont'" [class.cont]>\` })
export class App {}`;

    assert.ok(
      labels(complete(source, at(source, "'cont"), "typescript")).includes(
        "container",
      ),
    );
    assert.ok(
      labels(
        complete(source, at(source, "[class.cont"), "typescript"),
      ).includes("container"),
    );
  });

  it("completes custom element tags", () => {
    const html = "<bs-";
    const items = labels(complete(html, html.length, "html"));

    assert.ok(items.includes("bs-icon"));
    assert.ok(items.includes("bs-progress"));
    assert.ok(items.includes("bs-spinner"));
  });

  it("leaves the default out of the detail when an input has none", () => {
    const text = '<button type="button" bsCombobox m';
    const menu = complete(text, text.length, "html").find(
      (item) => item.label === "menu",
    );

    assert.equal(menu.detail, "BsComboboxMenu");
  });

  it("completes attributes on a textarea", () => {
    const text = "<textarea bsFormControl s></textarea>";
    const items = labels(complete(text, at(text, "bsFormControl s"), "html"));

    assert.ok(items.includes("size"));
  });

  it("completes values inside a bound string literal", () => {
    const text = `<button bsButton [theme]="'pri'">`;
    const offset = at(text, "'pri");
    const primary = complete(text, offset, "html").find(
      (item) => item.label === "primary",
    );

    assert.equal(primary.insertText, "primary");
    assert.equal(text.slice(primary.start, primary.end), "pri");
  });

  it("completes values inside one literal of a bound expression", () => {
    const text = `<button bsButton [theme]="dark ? 'inv' : 'primary'">`;
    const inverse = complete(text, at(text, "'inv"), "html").find(
      (item) => item.label === "inverse",
    );

    assert.equal(text.slice(inverse.start, inverse.end), "inv");
  });

  it("quotes values completed into an empty binding", () => {
    const double = `<button bsButton [theme]="">`;
    const single = `<button bsButton [theme]=''>`;
    const fromDouble = complete(double, at(double, '[theme]="'), "html").find(
      (item) => item.label === "primary",
    );
    const fromSingle = complete(single, at(single, "[theme]='"), "html").find(
      (item) => item.label === "primary",
    );

    assert.equal(fromDouble.insertText, "'primary'");
    assert.equal(fromSingle.insertText, '"primary"');
  });

  it("offers no values for a bound expression outside a literal", () => {
    const text = `<button bsButton [theme]="myTheme">`;

    assert.deepEqual(complete(text, at(text, "myThe"), "html"), []);
  });

  it("leaves out directives whose selector the element's type rules out", () => {
    const radio = '<input type="radio" >';
    const checkbox = '<input type="checkbox" >';
    const untyped = "<input >";
    const onRadio = labels(complete(radio, at(radio, '"radio" '), "html"));
    const onCheckbox = labels(
      complete(checkbox, at(checkbox, '"checkbox" '), "html"),
    );
    const onUntyped = labels(complete(untyped, at(untyped, "<input "), "html"));

    assert.ok(onRadio.includes("bsRadio"));
    assert.equal(onRadio.includes("bsCheck"), false);
    assert.equal(onRadio.includes("bsSwitch"), false);
    assert.ok(onCheckbox.includes("bsCheck"));
    assert.ok(onCheckbox.includes("bsSwitch"));
    assert.equal(onCheckbox.includes("bsRadio"), false);
    assert.equal(onCheckbox.includes("bsRange"), false);
    assert.ok(onUntyped.includes("bsCheck"));
    assert.ok(onUntyped.includes("bsRadio"));
  });
});
