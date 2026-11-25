"use strict";

const { parse, parseTree } = require("jsonc-parser");

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

function alpha1Pattern() {
  return /(?<![\d.])6\.0\.0-alpha\.1(?![\d.-])/gu;
}

function isAlpha1(spec) {
  return alpha1Pattern().test(spec);
}

function updatedSpecifier(spec) {
  return spec.replace(alpha1Pattern(), "6.0.0-alpha.2");
}

function nodeText(text, node) {
  return text.slice(node.offset, node.offset + node.length);
}

function nodeString(text, node) {
  if (!node || node.type !== "string") {
    return null;
  }

  try {
    return JSON.parse(nodeText(text, node));
  } catch {
    return null;
  }
}

function versionDiagnostic(text, key, valueNode) {
  if (!PACKAGES.has(key) || valueNode?.type !== "string") {
    return null;
  }

  const spec = nodeString(text, valueNode);

  if (!spec || !isAlpha1(spec)) {
    return null;
  }

  return {
    code: ALPHA1_CODE,
    end: valueNode.offset + valueNode.length - 1,
    message: translate(
      "{0} 6.0.0-alpha.1 is out of date. Update to 6.0.0-alpha.2.",
      key,
    ),
    severity: "warning",
    start: valueNode.offset + 1,
  };
}

function versionsInObject(text, objectNode) {
  const found = [];

  if (!objectNode || objectNode.type !== "object") {
    return found;
  }

  for (const child of objectNode.children ?? []) {
    if (child.type !== "property") {
      continue;
    }

    const key = nodeString(text, child.children?.[0]);

    if (!key) {
      continue;
    }

    const value = child.children?.[1];

    if (!value) {
      continue;
    }

    if (value.type === "object") {
      found.push(...versionsInObject(text, value));
      continue;
    }

    const item = versionDiagnostic(text, key, value);

    if (item) {
      found.push(item);
    }
  }

  return found;
}

function diagnosticsIn(text, root) {
  const found = [];

  for (const child of root.children ?? []) {
    if (child.type !== "property") {
      continue;
    }

    const key = nodeString(text, child.children?.[0]);
    const value = child.children?.[1];

    if (!key || !value || !SECTIONS.has(key) || value.type !== "object") {
      continue;
    }

    found.push(...versionsInObject(text, value));
  }

  return found;
}

function diagnoseDependencies(text) {
  const errors = [];

  parse(text, errors, {
    allowTrailingComma: true,
    disallowComments: false,
  });

  if (errors.length > 0) {
    return [];
  }

  const root = parseTree(text);

  if (!root || root.type !== "object") {
    return [];
  }

  return diagnosticsIn(text, root);
}

module.exports = {
  ALPHA1_CODE,
  diagnoseDependencies,
  updatedSpecifier,
};
