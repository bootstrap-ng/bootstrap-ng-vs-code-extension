"use strict";

const { hostAllows, index } = require("./catalog");
const { classes, documentationForClass } = require("./classes");
const { analyze } = require("./context");
const { translate } = require("./l10n");
const { documentationFor } = require("./markdown");

function namesOf(attributes) {
  return (attributes ?? []).map((attribute) => attribute.name).filter(Boolean);
}

function completion(entry) {
  return {
    detail: entry.detail,
    documentation: entry.documentation,
    end: entry.end,
    filterText: entry.filterText,
    incomplete: entry.incomplete === true,
    insertText: entry.insertText,
    kind: entry.kind,
    label: entry.label,
    snippet: entry.snippet === true,
    sortText: entry.sortText,
    start: entry.start,
  };
}

function dedupe(items, key = (item) => item.label) {
  const seen = new Set();
  const unique = [];

  for (const item of items) {
    const id = key(item);

    if (seen.has(id)) {
      continue;
    }

    seen.add(id);
    unique.push(item);
  }

  return unique;
}

function wrapperOf(prefix) {
  if (prefix.startsWith("[(")) {
    return "two-way";
  }

  if (prefix.startsWith("[")) {
    return "binding";
  }

  if (prefix.startsWith("(")) {
    return "output";
  }

  return "plain";
}

function hostExtras(tag, selector) {
  if (tag === "button") {
    return ' type="button"';
  }

  if (tag === "a") {
    return ' href="#"';
  }

  if (tag !== "input") {
    return "";
  }

  if (selector.includes("type=checkbox")) {
    return ' type="checkbox"';
  }

  if (selector.includes("type=radio")) {
    return ' type="radio"';
  }

  if (selector.includes("type=range")) {
    return ' type="range"';
  }

  return "";
}

function elementSnippet(symbol, label) {
  const custom = symbol.tags.find((tag) => tag.includes("-"));

  if (custom === "bs-icon") {
    return '<bs-icon name="$1"$0 />';
  }

  if (custom === "bs-progress") {
    return '<bs-progress value="$1" aria-label="$2"$0 />';
  }

  if (custom === "bs-spinner") {
    return '<bs-spinner label="$1"$0 />';
  }

  if (custom && !symbol.attributes.length) {
    return `<${custom}>$0</${custom}>`;
  }

  const tag = symbol.tags[0] ?? "div";
  const extras = hostExtras(tag, symbol.selector ?? "");

  if (tag === "input") {
    return `<input${extras} ${label}$0 />`;
  }

  return `<${tag}${extras} ${label}>$0</${tag}>`;
}

function located(context, fields) {
  return completion({
    ...fields,
    end: context.end,
    start: context.start,
  });
}

function directiveItems(context, wrapper) {
  if (wrapper !== "plain" && wrapper !== "binding") {
    return [];
  }

  const present = new Set(namesOf(context.attributes));
  const items = [];

  for (const symbol of index.symbols) {
    if (symbol.kind !== "directive" || !hostAllows(symbol, context.tagName)) {
      continue;
    }

    for (const attribute of symbol.attributes) {
      if (present.has(attribute)) {
        continue;
      }

      const label = wrapper === "binding" ? `[${attribute}]` : attribute;
      items.push(
        located(context, {
          detail: symbol.name,
          documentation: documentationFor(symbol),
          filterText: label,
          insertText: label,
          kind: "Property",
          label,
          sortText: `0-${label}`,
        }),
      );
    }
  }

  return items;
}

function inputLabels(input, wrapper) {
  if (wrapper === "two-way") {
    return input.model
      ? [{ filterText: `[(${input.name})]`, label: `[(${input.name})]` }]
      : [];
  }

  if (wrapper === "binding") {
    return [{ filterText: `[${input.name}]`, label: `[${input.name}]` }];
  }

  if (wrapper !== "plain") {
    return [];
  }

  const labels = [{ filterText: input.name, label: input.name }];

  if (input.model) {
    labels.push({ filterText: input.name, label: `[(${input.name})]` });
  }

  if (!input.boolean || input.values.length > 0 || input.model) {
    labels.push({ filterText: input.name, label: `[${input.name}]` });
  }

  return labels;
}

function inputItems(directive, context, wrapper) {
  const present = new Set(namesOf(context.attributes));
  const items = [];

  for (const input of directive.inputs) {
    if (wrapper === "plain" && present.has(input.name)) {
      continue;
    }

    for (const form of inputLabels(input, wrapper)) {
      items.push(
        located(context, {
          detail: `${input.type} = ${input.defaultValue}`,
          documentation: documentationFor(directive),
          filterText: form.filterText,
          insertText: form.label,
          kind: input.model ? "Variable" : "Field",
          label: form.label,
          sortText: `1-${form.label}`,
        }),
      );
    }
  }

  return items;
}

function outputItems(directive, context, wrapper) {
  if (wrapper !== "plain" && wrapper !== "output") {
    return [];
  }

  return directive.outputs.map((output) => {
    const label = `(${output.name})`;

    return located(context, {
      detail: output.type,
      documentation: output.description,
      filterText: wrapper === "output" ? label : output.name,
      insertText: label,
      kind: "Event",
      label,
      sortText: `2-${label}`,
    });
  });
}

function attributeCompletions(context) {
  const wrapper = wrapperOf(context.prefix);
  const directives = index.directivesFor(
    context.tagName,
    namesOf(context.attributes),
  );
  const items = directiveItems(context, wrapper);

  for (const directive of directives) {
    items.push(
      ...inputItems(directive, context, wrapper),
      ...outputItems(directive, context, wrapper),
    );
  }

  return dedupe(items);
}

function matchesClass(name, prefix) {
  const label = name.toLowerCase();
  const typed = prefix.toLowerCase();
  const variantEnd = label.indexOf(":");

  if (variantEnd !== -1) {
    if (typed.includes(":")) {
      return label.startsWith(typed);
    }

    const variant = label.slice(0, variantEnd);

    return typed.length >= 2 && variant.startsWith(typed);
  }

  if (!typed || label.startsWith(typed)) {
    return true;
  }

  return label.split("-").some((segment) => segment.startsWith(typed));
}

function classCompletions(context) {
  const present = new Set(context.present ?? []);
  const items = [];

  for (const entry of classes) {
    if (present.has(entry.name) || !matchesClass(entry.name, context.prefix)) {
      continue;
    }

    items.push(
      located(context, {
        detail: entry.detail || "Bootstrap 6",
        documentation: documentationForClass(entry),
        filterText: entry.name,
        incomplete: true,
        insertText: entry.name,
        kind: "Value",
        label: entry.name,
        sortText: entry.sortText,
      }),
    );
  }

  return items;
}

function valueCompletions(context) {
  const directives = index.directivesFor(
    context.tagName,
    namesOf(context.attributes),
  );
  const values = new Map();

  for (const directive of directives) {
    for (const input of directive.inputs) {
      if (input.name !== context.attribute?.name) {
        continue;
      }

      for (const value of input.values) {
        values.set(value, input);
      }
    }
  }

  return [...values.entries()].map(([value, input]) =>
    located(context, {
      detail: input.type,
      documentation: input.description,
      filterText: value,
      insertText: value,
      kind: "Value",
      label: value,
      sortText: `0-${value}`,
    }),
  );
}

function tagCompletions(context) {
  if (!/^bs/iu.test(context.prefix)) {
    return [];
  }

  const seen = new Set();
  const items = [];

  for (const symbol of index.symbols) {
    for (const tag of symbol.tags) {
      if (!tag.includes("-") || seen.has(tag)) {
        continue;
      }

      seen.add(tag);
      items.push(
        located(context, {
          detail: symbol.name,
          documentation: documentationFor(symbol),
          filterText: tag,
          insertText: tag,
          kind: "Class",
          label: tag,
          sortText: `0-${tag}`,
        }),
      );
    }
  }

  return items;
}

function textLabels(symbol) {
  if (symbol.attributes.length > 0) {
    return symbol.attributes;
  }

  return symbol.tags.filter((tag) => tag.includes("-"));
}

function textCompletions(context) {
  if (!/^bs/iu.test(context.prefix)) {
    return [];
  }

  const items = [];

  for (const symbol of index.symbols) {
    if (symbol.kind !== "directive") {
      continue;
    }

    for (const label of textLabels(symbol)) {
      items.push(
        located(context, {
          detail: symbol.name,
          documentation: documentationFor(symbol),
          filterText: label,
          insertText: elementSnippet(symbol, label),
          kind: "Snippet",
          label,
          snippet: true,
          sortText: `0-${label}`,
        }),
      );
    }
  }

  return dedupe(items, (item) => `${item.label}\n${item.insertText}`);
}

function entryFilter(specifier) {
  if (!specifier || specifier === "bootstrap-ng") {
    return null;
  }

  const match = specifier.match(/^bootstrap-ng\/(?<entry>[^/'"]+)/u);

  return match ? match.groups.entry : false;
}

function importKind(symbol) {
  if (symbol.kind === "config" || symbol.kind === "function") {
    return "Function";
  }

  if (symbol.kind === "type") {
    return "Interface";
  }

  if (symbol.kind === "constant") {
    return "Constant";
  }

  return "Class";
}

function importCompletions(context) {
  const entry = entryFilter(context.specifier);

  if (entry === false) {
    return [];
  }

  return index.symbols
    .filter((symbol) => entry === null || symbol.entry === entry)
    .map((symbol) =>
      located(context, {
        detail: translate(symbol.kind),
        documentation: documentationFor(symbol),
        filterText: symbol.name,
        insertText: symbol.name,
        kind: importKind(symbol),
        label: symbol.name,
        sortText: `0-${symbol.name}`,
      }),
    );
}

function complete(text, offset, languageId) {
  const context = analyze(text, offset, languageId);

  if (!context) {
    return [];
  }

  if (context.kind === "import") {
    return importCompletions(context);
  }

  if (context.kind === "class-name") {
    return classCompletions(context);
  }

  if (context.kind === "attribute-value") {
    return valueCompletions(context);
  }

  if (context.kind === "attribute-name") {
    return attributeCompletions(context);
  }

  if (context.kind === "tag-name") {
    return tagCompletions(context);
  }

  if (context.kind === "text") {
    return textCompletions(context);
  }

  return [];
}

module.exports = {
  complete,
};
