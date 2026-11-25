"use strict";

const { translate } = require("./l10n");

const ALPHA1_CODE = "alpha1";
const PACKAGES = new Set(["bootstrap", "bootstrap-ng"]);
const SECTIONS = new Set([
  "dependencies",
  "devDependencies",
  "optionalDependencies",
  "overrides",
  "peerDependencies",
  "resolutions",
]);
const WHITESPACE = new Set(["\t", "\n", "\r", " "]);

function alpha1Pattern() {
  return /(?<![\d.])6\.0\.0-alpha\.1(?![\d.-])/gu;
}

function isAlpha1(spec) {
  return alpha1Pattern().test(spec);
}

function updatedSpecifier(spec) {
  return spec.replace(alpha1Pattern(), "6.0.0-alpha.2");
}

function skipSpace(text, index) {
  let cursor = index;

  while (cursor < text.length && WHITESPACE.has(text[cursor])) {
    cursor += 1;
  }

  return cursor;
}

function isDelimiter(char) {
  return WHITESPACE.has(char) || char === "," || char === "}" || char === "]";
}

function readString(text, index) {
  if (text[index] !== '"') {
    return null;
  }

  let cursor = index + 1;
  let raw = "";

  while (cursor < text.length) {
    const char = text[cursor];

    if (char === '"') {
      return {
        contentEnd: cursor,
        contentStart: index + 1,
        end: cursor + 1,
        kind: "string",
        raw,
      };
    }

    if (char === "\\") {
      if (cursor + 1 >= text.length) {
        return null;
      }

      raw += text.slice(cursor, cursor + 2);
      cursor += 2;
      continue;
    }

    if (char.charCodeAt(0) < 32) {
      return null;
    }

    raw += char;
    cursor += 1;
  }

  return null;
}

function readLiteral(text, index) {
  let cursor = index;

  while (cursor < text.length && !isDelimiter(text[cursor])) {
    cursor += 1;
  }

  if (cursor === index) {
    return null;
  }

  return { end: cursor, kind: "literal" };
}

function readArray(text, index) {
  if (text[index] !== "[") {
    return null;
  }

  let depth = 0;

  for (let cursor = index; cursor < text.length; cursor += 1) {
    const char = text[cursor];

    if (char === '"') {
      const value = readString(text, cursor);

      if (!value) {
        return null;
      }

      cursor = value.end - 1;
      continue;
    }

    if (char === "[" || char === "{") {
      depth += 1;
      continue;
    }

    if (char !== "]" && char !== "}") {
      continue;
    }

    depth -= 1;

    if (depth === 0) {
      return { end: cursor + 1, kind: "array" };
    }
  }

  return null;
}

function readValue(text, index) {
  const char = text[index];

  if (char === '"') {
    return readString(text, index);
  }

  if (char === "{") {
    return readObject(text, index);
  }

  if (char === "[") {
    return readArray(text, index);
  }

  return readLiteral(text, index);
}

function readObject(text, index) {
  if (text[index] !== "{") {
    return null;
  }

  const properties = [];
  let cursor = skipSpace(text, index + 1);

  if (text[cursor] === "}") {
    return { end: cursor + 1, kind: "object", properties };
  }

  while (cursor < text.length) {
    const key = readString(text, cursor);

    if (!key) {
      return null;
    }

    cursor = skipSpace(text, key.end);

    if (text[cursor] !== ":") {
      return null;
    }

    const value = readValue(text, skipSpace(text, cursor + 1));

    if (!value) {
      return null;
    }

    properties.push({ key: key.raw, value });
    cursor = skipSpace(text, value.end);

    if (text[cursor] === ",") {
      cursor = skipSpace(text, cursor + 1);
      continue;
    }

    if (text[cursor] === "}") {
      return { end: cursor + 1, kind: "object", properties };
    }

    return null;
  }

  return null;
}

function versionDiagnostic(property) {
  if (property.value.kind !== "string" || !PACKAGES.has(property.key)) {
    return null;
  }

  if (!isAlpha1(property.value.raw)) {
    return null;
  }

  return {
    code: ALPHA1_CODE,
    end: property.value.contentEnd,
    message: translate(
      "{0} 6.0.0-alpha.1 is out of date. Update to 6.0.0-alpha.2.",
      property.key,
    ),
    severity: "warning",
    start: property.value.contentStart,
  };
}

function versionsIn(section) {
  const found = [];

  for (const property of section.properties) {
    if (property.value.kind === "object") {
      found.push(...versionsIn(property.value));
      continue;
    }

    const item = versionDiagnostic(property);

    if (item) {
      found.push(item);
    }
  }

  return found;
}

function diagnosticsIn(root) {
  const found = [];

  for (const property of root.properties) {
    if (!SECTIONS.has(property.key) || property.value.kind !== "object") {
      continue;
    }

    found.push(...versionsIn(property.value));
  }

  return found;
}

function diagnoseDependencies(text) {
  try {
    JSON.parse(text);
  } catch {
    return [];
  }

  const root = readObject(text, skipSpace(text, 0));

  if (!root) {
    return [];
  }

  return diagnosticsIn(root);
}

module.exports = {
  ALPHA1_CODE,
  diagnoseDependencies,
  updatedSpecifier,
};
