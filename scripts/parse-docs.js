"use strict";

const THEMES = [
  "primary",
  "accent",
  "success",
  "danger",
  "warning",
  "info",
  "inverse",
  "secondary",
];

const PLACEMENT_SIDES = ["top", "bottom", "left", "right", "start", "end"];

const ICON_FACTORIES = [
  "bootstrapIcons",
  "fontAwesomeIcons",
  "materialSymbols",
  "modusIcons",
  "phosphorIcons",
];

const TITLE_PATTERN = /^[A-Za-z][A-Za-z0-9_]*$/u;

function placementValues() {
  const values = [];

  for (const side of PLACEMENT_SIDES) {
    values.push(side, `${side}-start`, `${side}-end`);
  }

  return values;
}

function normalizeTitle(title) {
  return title.normalize("NFKC").replace(/\s+/gu, " ").trim().toLowerCase();
}

function cleanText(value) {
  return value
    .replace(/\[(?<label>[^\]]+)\]\([^)]+\)/gu, "$<label>")
    .replace(/`/gu, "")
    .replace(/\s+/gu, " ")
    .trim();
}

function unwrap(cell) {
  const trimmed = cell.trim();

  if (trimmed.startsWith("`") && trimmed.endsWith("`") && trimmed.length >= 2) {
    return trimmed.slice(1, -1).trim();
  }

  return trimmed;
}

function splitRow(line) {
  const normalized = line.replace(/\\\|/gu, "\u0000");

  return normalized
    .split("|")
    .slice(1, -1)
    .map((cell) => unwrap(cell.replaceAll("\u0000", "|")));
}

function pageLinks(markdown) {
  const links = new Map();
  const pattern =
    /^- \[(?<title>[^\]]+)\]\((?<url>https:\/\/bootstrap-ng\.com\/[^)]+)\)/gmu;

  for (const match of markdown.matchAll(pattern)) {
    links.set(normalizeTitle(match.groups.title), match.groups.url);
  }

  return links;
}

function splitPages(markdown) {
  const pages = [];
  let current = null;
  let fence = false;

  for (const line of markdown.split("\n")) {
    if (line.startsWith("```")) {
      fence = !fence;
    }

    if (!fence && line.startsWith("# ")) {
      if (current) {
        pages.push(current);
      }

      current = { lines: [], title: line.slice(2).trim() };
    } else if (current) {
      current.lines.push(line);
    }
  }

  if (current) {
    pages.push(current);
  }

  return pages;
}

function firstParagraph(lines) {
  const buffer = [];
  let fence = false;

  for (const line of lines) {
    if (line.startsWith("```")) {
      fence = !fence;
      continue;
    }

    if (fence || line.startsWith("Source:")) {
      continue;
    }

    if (line.startsWith("#")) {
      break;
    }

    if (line.trim() === "") {
      if (buffer.length > 0) {
        break;
      }

      continue;
    }

    buffer.push(line.trim());
  }

  return cleanText(buffer.join(" "));
}

function entryFromUrl(url) {
  const match = url.match(
    /bootstrap-ng\.com\/(?<area>components|forms)\/(?<entry>[^/#]+)/u,
  );

  return match ? match.groups.entry : null;
}

function classifySelector(selector) {
  if (!selector) {
    return { attributes: [], kind: "other", tags: [] };
  }

  if (selector.startsWith("inject(")) {
    return { attributes: [], kind: "service", tags: [] };
  }

  if (selector.startsWith("interface")) {
    return { attributes: [], kind: "type", tags: [] };
  }

  return selectorParts(selector);
}

function selectorParts(selector) {
  const attributes = [];
  const tags = [];

  for (const part of selector.split(",")) {
    collectSelectorPart(part.trim(), tags, attributes);
  }

  const kind = tags.length > 0 || attributes.length > 0 ? "directive" : "other";

  return { attributes, kind, tags };
}

function collectSelectorPart(piece, tags, attributes) {
  const tag = piece.split("[")[0].trim();

  if (tag && !tags.includes(tag)) {
    tags.push(tag);
  }

  for (const match of piece.matchAll(/\[(?<name>[^\]]+)\]/gu)) {
    const name = match.groups.name.split("=")[0].trim();

    if (name && name !== "type" && !attributes.includes(name)) {
      attributes.push(name);
    }
  }
}

function literalValues(type) {
  const values = [];

  for (const match of type.matchAll(/'(?<value>[^']*)'/gu)) {
    if (match.groups.value) {
      values.push(match.groups.value);
    }
  }

  if (type.includes("BsTheme")) {
    values.push(...THEMES);
  }

  if (type.includes("BsPlacement")) {
    values.push(...placementValues());
  }

  return [...new Set(values)];
}

function isBooleanType(type) {
  return /(?:^|\|)\s*boolean\s*(?:\||$)/u.test(type);
}

function isModel(description) {
  return description.includes("[(");
}

function blankSymbol(name, kind) {
  return {
    attributes: [],
    docUrl: null,
    entry: null,
    exportAs: null,
    inputs: [],
    kind,
    name,
    outputs: [],
    selector: null,
    summary: "",
    tags: [],
  };
}

function tableAfter(lines, heading, width) {
  const start = lines.findIndex((line) => line.trim() === heading);

  if (start === -1) {
    return [];
  }

  const rows = [];

  for (const line of lines.slice(start + 1)) {
    if (line.startsWith("#")) {
      break;
    }

    if (!line.startsWith("|") || /^\|\s*-+/u.test(line)) {
      continue;
    }

    const cells = splitRow(line);

    if (cells[0] === "Name" || cells.length < width) {
      continue;
    }

    rows.push(cells);
  }

  return rows;
}

function parseInputs(lines) {
  return tableAfter(lines, "#### Inputs", 4).map((cells) => ({
    boolean: isBooleanType(cells[1]),
    defaultValue: cells[2],
    description: cleanText(cells[3]),
    model: isModel(cells[3]),
    name: cells[0],
    type: cells[1],
    values: literalValues(cells[1]),
  }));
}

function parseOutputs(lines) {
  return tableAfter(lines, "#### Outputs", 3).map((cells) => ({
    description: cleanText(cells[2]),
    name: cells[0],
    type: cells[1],
  }));
}

function symbolFromBlock(block, page) {
  if (!TITLE_PATTERN.test(block.title)) {
    return null;
  }

  const selectorLine = block.lines.find((line) => line.startsWith("Selector:"));
  const selectorMatch = selectorLine?.match(
    /Selector:\s*`(?<selector>[^`]+)`/u,
  );
  const exportMatch = selectorLine?.match(
    /Exported as:\s*`(?<exportAs>[^`]+)`/u,
  );
  const selector = selectorMatch?.groups.selector ?? null;
  const classified = classifySelector(selector);
  const paragraph = firstParagraph(block.lines);
  const summary =
    !paragraph || paragraph.startsWith("Selector:") ? page.summary : paragraph;

  return {
    ...classified,
    docUrl: page.docUrl,
    entry: page.entry,
    exportAs: exportMatch?.groups.exportAs ?? null,
    inputs: parseInputs(block.lines),
    name: block.title,
    outputs: parseOutputs(block.lines),
    selector,
    summary,
  };
}

function symbolBlocks(lines) {
  const blocks = [];
  let current = null;
  let fence = false;

  for (const line of lines) {
    if (line.startsWith("```")) {
      fence = !fence;
    }

    if (!fence && line.startsWith("### ")) {
      if (current) {
        blocks.push(current);
      }

      current = { lines: [], title: line.slice(4).trim() };
    } else if (current) {
      current.lines.push(line);
    }
  }

  if (current) {
    blocks.push(current);
  }

  return blocks;
}

function headingSections(lines, marker) {
  const sections = [];
  let current = null;
  let fence = false;

  for (const line of lines) {
    if (line.startsWith("```")) {
      fence = !fence;
    }

    if (!fence && line.startsWith(marker)) {
      if (current) {
        sections.push(current);
      }

      current = { lines: [], title: line.slice(marker.length).trim() };
    } else if (current) {
      current.lines.push(line);
    }
  }

  if (current) {
    sections.push(current);
  }

  return sections;
}

function exportIdentifier(raw) {
  const match = raw.match(/^(?<name>[A-Za-z_][A-Za-z0-9_]*)/u);

  return match ? match.groups.name : null;
}

function namedExportSymbols(lines, kind, docUrl) {
  const symbols = [];

  for (const line of lines) {
    if (!line.startsWith("|")) {
      continue;
    }

    const cells = splitRow(line);
    const name = exportIdentifier(cells[0] ?? "");

    if (!name || name === "Name") {
      continue;
    }

    const symbol = blankSymbol(name, kind);
    symbol.docUrl = docUrl;
    symbol.summary = cleanText(cells[2] ?? cells[1] ?? "");
    symbols.push(symbol);
  }

  return symbols;
}

function serviceSupplements(lines, docUrl) {
  const summaries = new Map();
  const symbols = [];

  for (const section of headingSections(lines, "## ")) {
    collectServiceSection(section, docUrl, summaries, symbols);
  }

  return { summaries, symbols };
}

function collectServiceSection(section, docUrl, summaries, symbols) {
  if (section.title === "Helper functions" || section.title === "Types") {
    const kind = section.title === "Types" ? "type" : "function";
    symbols.push(...namedExportSymbols(section.lines, kind, docUrl));
    return;
  }

  if (section.title === "BOOTSTRAP_NG") {
    const symbol = blankSymbol("BOOTSTRAP_NG", "constant");
    symbol.docUrl = docUrl;
    symbol.summary = firstParagraph(section.lines);
    symbols.push(symbol);
    return;
  }

  if (!/^Bs[A-Za-z0-9]+$/u.test(section.title)) {
    return;
  }

  const summary = firstParagraph(section.lines);
  summaries.set(section.title, summary);
  const symbol = blankSymbol(section.title, "service");
  symbol.docUrl = docUrl;
  symbol.summary = summary;
  symbols.push(symbol);
}

function iconFactorySymbols(markdown, docUrl) {
  return ICON_FACTORIES.filter((name) => markdown.includes(name)).map(
    (name) => {
      const symbol = blankSymbol(name, "function");
      symbol.docUrl = docUrl;
      symbol.summary = `Built-in icon library factory for ${name}.`;
      return symbol;
    },
  );
}

function configSymbols(markdown) {
  const symbols = new Map();
  const pattern =
    /\[`(?<name>provideBs[A-Za-z]+)\(\)`\]\((?<url>https:\/\/bootstrap-ng\.com\/[^)]+)\)/gu;

  for (const match of markdown.matchAll(pattern)) {
    addConfigSymbol(symbols, match);
  }

  return [...symbols.values()];
}

function lineAt(source, index) {
  const start = source.lastIndexOf("\n", index) + 1;
  const end = source.indexOf("\n", index);

  return source.slice(start, end === -1 ? source.length : end);
}

function addConfigSymbol(symbols, match) {
  const { name, url } = match.groups;

  if (symbols.has(name)) {
    return;
  }

  const line = lineAt(match.input, match.index);
  const cells = line.startsWith("|") ? splitRow(line) : [];
  const configured = cells[1] ? cleanText(cells[1]) : "";
  const symbol = blankSymbol(name, "config");
  symbol.docUrl = url;
  symbol.entry = entryFromUrl(url);
  symbol.summary = configured
    ? `Sets defaults for ${configured}.`
    : `${name} configuration.`;
  symbols.set(name, symbol);
}

function mergeSymbols(current, incoming) {
  const base =
    incoming.inputs.length > current.inputs.length ? incoming : current;
  const extra = base === current ? incoming : current;
  const selector =
    (base.selector ?? "").length >= (extra.selector ?? "").length
      ? base.selector
      : extra.selector;

  return {
    ...base,
    attributes: [...new Set([...base.attributes, ...extra.attributes])],
    outputs:
      base.outputs.length >= extra.outputs.length
        ? base.outputs
        : extra.outputs,
    selector,
    tags: [...new Set([...base.tags, ...extra.tags])],
  };
}

function rememberSymbol(symbols, symbol) {
  const current = symbols.get(symbol.name);

  if (!current) {
    symbols.set(symbol.name, symbol);
    return;
  }

  symbols.set(symbol.name, mergeSymbols(current, symbol));
}

function applySummaries(symbol, summaries) {
  const summary = summaries.get(symbol.name);

  if (!summary || (symbol.kind !== "service" && symbol.kind !== "constant")) {
    return symbol;
  }

  return { ...symbol, summary };
}

function pageMeta(page, links) {
  const url = links.get(normalizeTitle(page.title)) ?? null;

  return {
    docUrl: url ? `${url.split("#")[0]}#api` : null,
    entry: url ? entryFromUrl(url) : null,
    summary: firstParagraph(page.lines),
  };
}

function buildCatalog(linkMarkdown, fullMarkdown) {
  const links = pageLinks(linkMarkdown);
  const symbols = new Map();
  let serviceSummaries = new Map();
  const servicesUrl = links.get(normalizeTitle("Services and helpers"));

  for (const page of splitPages(fullMarkdown)) {
    const meta = pageMeta(page, links);

    for (const block of symbolBlocks(page.lines)) {
      const symbol = symbolFromBlock(block, meta);

      if (symbol) {
        rememberSymbol(symbols, symbol);
      }
    }

    if (page.title === "Services and helpers") {
      const supplements = serviceSupplements(page.lines, servicesUrl);
      serviceSummaries = supplements.summaries;

      for (const symbol of supplements.symbols) {
        rememberSymbol(symbols, symbol);
      }

      for (const symbol of iconFactorySymbols(
        page.lines.join("\n"),
        servicesUrl,
      )) {
        rememberSymbol(symbols, symbol);
      }
    }
  }

  for (const symbol of configSymbols(fullMarkdown)) {
    rememberSymbol(symbols, symbol);
  }

  const sorted = [...symbols.values()]
    .map((symbol) => orderSymbol(applySummaries(symbol, serviceSummaries)))
    .sort((left, right) => left.name.localeCompare(right.name));

  return { symbols: sorted, version: 1 };
}

function orderSymbol(symbol) {
  return {
    attributes: symbol.attributes,
    docUrl: symbol.docUrl,
    entry: symbol.entry,
    exportAs: symbol.exportAs,
    inputs: symbol.inputs,
    kind: symbol.kind,
    name: symbol.name,
    outputs: symbol.outputs,
    selector: symbol.selector,
    summary: symbol.summary,
    tags: symbol.tags,
  };
}

module.exports = {
  buildCatalog,
  THEMES,
};
