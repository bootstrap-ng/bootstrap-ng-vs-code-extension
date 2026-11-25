"use strict";

const fs = require("node:fs");
const path = require("node:path");

const CSS_URL =
  "https://cdn.jsdelivr.net/npm/bootstrap@6.0.0-alpha.1/dist/css/bootstrap.css";
const VERSION = "6.0.0-alpha.1";

function classExpression() {
  return /\.(?<raw>(?:\\[0-9a-fA-F]{1,6}[ \t]?|\\.|[A-Za-z0-9_-])+)/gu;
}

async function readSource(source) {
  if (source.startsWith("http://") || source.startsWith("https://")) {
    const response = await fetch(source);

    if (!response.ok) {
      throw new Error(`Failed to fetch ${source}: ${response.status}`);
    }

    return response.text();
  }

  return fs.promises.readFile(source, "utf8");
}

function skipString(css, index) {
  const quote = css[index];
  let cursor = index + 1;

  while (cursor < css.length) {
    if (css[cursor] === "\\") {
      cursor += 2;
      continue;
    }

    if (css[cursor] === quote) {
      return cursor + 1;
    }

    cursor += 1;
  }

  return cursor;
}

function skipComment(css, index) {
  const end = css.indexOf("*/", index + 2);

  return end === -1 ? css.length : end + 2;
}

function nextToken(css, index, end) {
  let cursor = index;

  while (cursor < end) {
    if (css.startsWith("/*", cursor)) {
      cursor = skipComment(css, cursor);
      continue;
    }

    if (!/[\t\n\r ]/u.test(css[cursor])) {
      break;
    }

    cursor += 1;
  }

  return cursor;
}

function readPrelude(css, index, end) {
  let cursor = index;
  let parens = 0;

  while (cursor < end) {
    if (css.startsWith("/*", cursor)) {
      cursor = skipComment(css, cursor);
      continue;
    }

    if (css[cursor] === '"' || css[cursor] === "'") {
      cursor = skipString(css, cursor);
      continue;
    }

    if (css[cursor] === "(") {
      parens += 1;
    } else if (css[cursor] === ")") {
      parens -= 1;
    } else if (
      parens === 0 &&
      (css[cursor] === "{" || css[cursor] === "}" || css[cursor] === ";")
    ) {
      break;
    }

    cursor += 1;
  }

  return cursor;
}

function matchingBrace(css, openIndex) {
  let cursor = openIndex + 1;
  let depth = 1;

  while (cursor < css.length && depth > 0) {
    if (css.startsWith("/*", cursor)) {
      cursor = skipComment(css, cursor);
      continue;
    }

    if (css[cursor] === '"' || css[cursor] === "'") {
      cursor = skipString(css, cursor);
      continue;
    }

    if (css[cursor] === "{") {
      depth += 1;
    } else if (css[cursor] === "}") {
      depth -= 1;
    }

    cursor += 1;
  }

  return cursor;
}

function hasNestedBlock(css, start, end) {
  let cursor = start;

  while (cursor < end) {
    if (css.startsWith("/*", cursor)) {
      cursor = skipComment(css, cursor);
      continue;
    }

    if (css[cursor] === '"' || css[cursor] === "'") {
      cursor = skipString(css, cursor);
      continue;
    }

    if (css[cursor] === "{") {
      return true;
    }

    cursor += 1;
  }

  return false;
}

function decodeIdent(raw) {
  let decoded = "";
  let index = 0;

  while (index < raw.length) {
    if (raw[index] !== "\\") {
      decoded += raw[index];
      index += 1;
      continue;
    }

    const hex = /^[0-9a-fA-F]{1,6}/u.exec(raw.slice(index + 1));

    if (hex) {
      decoded += String.fromCodePoint(Number.parseInt(hex[0], 16));
      index += 1 + hex[0].length;

      if (raw[index] === " " || raw[index] === "\t") {
        index += 1;
      }

      continue;
    }

    decoded += raw[index + 1] ?? "";
    index += 2;
  }

  return decoded;
}

function classNamesIn(selector) {
  const names = [];

  for (const match of selector.matchAll(classExpression())) {
    const name = decodeIdent(match.groups.raw);

    if (/[A-Za-z]/u.test(name)) {
      names.push(name);
    }
  }

  return names;
}

function splitSelectors(prelude) {
  const parts = [];
  let current = "";
  let parens = 0;

  for (const char of prelude) {
    if (char === "(") {
      parens += 1;
    } else if (char === ")") {
      parens -= 1;
    } else if (char === "," && parens === 0) {
      parts.push(current);
      current = "";
      continue;
    }

    current += char;
  }

  if (current.trim()) {
    parts.push(current);
  }

  return parts;
}

function selectorRank(selector, name) {
  const names = classNamesIn(selector);

  if (names.length !== 1 || names[0] !== name) {
    return 3;
  }

  const rest = selector
    .replace(classExpression(), "")
    .replace(/[\t\n\r ]/gu, "");

  if (rest === "") {
    return 0;
  }

  if (/^[[:]/u.test(rest)) {
    return 1;
  }

  return 2;
}

function declarationParts(body) {
  const parts = [];
  let current = "";
  let parens = 0;

  for (const char of body) {
    if (char === "(") {
      parens += 1;
    } else if (char === ")") {
      parens -= 1;
    } else if (char === ";" && parens === 0) {
      parts.push(current);
      current = "";
      continue;
    }

    current += char;
  }

  if (current.trim()) {
    parts.push(current);
  }

  return parts;
}

function parseDeclaration(text) {
  const trimmed = text.trim();
  const split = trimmed.indexOf(":");

  if (split <= 0) {
    return null;
  }

  const prop = trimmed.slice(0, split).trim();
  const value = trimmed
    .slice(split + 1)
    .replace(/\s*!important\s*$/u, "")
    .trim()
    .replace(/\s+/gu, " ");

  if (!/^(?:--[A-Za-z_][\w-]*|[A-Za-z-]+)$/u.test(prop) || !value) {
    return null;
  }

  return { prop, value };
}

function shorten(value) {
  if (value.length <= 56) {
    return value;
  }

  return `${value.slice(0, 53)}...`;
}

function friendlyProp(prop) {
  return prop.startsWith("--bs-") ? prop.slice(5) : prop;
}

function summarize(body) {
  const parsed = declarationParts(body).map(parseDeclaration).filter(Boolean);
  const visible = parsed.filter((item) => !item.prop.startsWith("--"));
  const chosen = (visible.length > 0 ? visible : parsed).slice(0, 2);

  return chosen
    .map((item) => `${friendlyProp(item.prop)}: ${shorten(item.value)}`)
    .join("; ");
}

function remember(found, name, detail, rank) {
  if (!found.has(name)) {
    found.set(name, { detail: "", rank: 99 });
  }

  const current = found.get(name);

  if (!detail || rank > 1 || rank > current.rank) {
    return;
  }

  if (rank < current.rank || !current.detail) {
    found.set(name, { detail, rank });
    return;
  }

  if (current.detail.includes(detail)) {
    return;
  }

  const combined = `${current.detail}; ${detail}`;

  if (combined.length <= 96) {
    found.set(name, { detail: combined, rank });
  }
}

function visitRule(found, prelude, body) {
  const detail = summarize(body);

  for (const selector of splitSelectors(prelude)) {
    for (const name of classNamesIn(selector)) {
      remember(found, name, detail, selectorRank(selector, name));
    }
  }
}

function walk(css, start, end, found) {
  let cursor = start;

  while (cursor < end) {
    cursor = nextToken(css, cursor, end);

    if (cursor >= end || css[cursor] === "}") {
      return;
    }

    const preludeEnd = readPrelude(css, cursor, end);

    if (css[preludeEnd] !== "{") {
      cursor = Math.min(end, preludeEnd + 1);
      continue;
    }

    const close = matchingBrace(css, preludeEnd) - 1;

    if (hasNestedBlock(css, preludeEnd + 1, close)) {
      walk(css, preludeEnd + 1, close, found);
    } else {
      visitRule(
        found,
        css.slice(cursor, preludeEnd),
        css.slice(preludeEnd + 1, close),
      );
    }

    cursor = close + 1;
  }
}

function byName(left, right) {
  const leftVariant = left.includes(":");
  const rightVariant = right.includes(":");

  if (leftVariant !== rightVariant) {
    return leftVariant ? 1 : -1;
  }

  return left.localeCompare(right, "en", { numeric: true });
}

function buildClasses(css) {
  const found = new Map();

  walk(css, 0, css.length, found);

  return [...found.keys()].sort(byName).map((name) => ({
    detail: found.get(name).detail,
    name,
  }));
}

async function main() {
  const source = process.argv[2] ?? CSS_URL;
  const css = await readSource(source);
  const classes = buildClasses(css);
  const destination = path.join(__dirname, "..", "src", "data", "classes.json");
  const catalog = { classes, version: VERSION };

  await fs.promises.mkdir(path.dirname(destination), { recursive: true });
  await fs.promises.writeFile(
    destination,
    `${JSON.stringify(catalog, null, 2)}\n`,
  );
  process.stdout.write(
    `Wrote ${classes.length} Bootstrap ${VERSION} classes to ${destination}\n`,
  );
}

main().catch((error) => {
  process.stderr.write(`${error.stack ?? error.message}\n`);
  process.exitCode = 1;
});
