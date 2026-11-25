"use strict";

const { index } = require("./catalog");

const QUICK_PICK_KINDS = new Set([
  "config",
  "constant",
  "directive",
  "service",
  "type",
]);

function documentationItems() {
  return index.symbols
    .filter((symbol) => symbol.docUrl && QUICK_PICK_KINDS.has(symbol.kind))
    .map((symbol) => ({
      description: symbol.summary,
      label: symbol.name,
      url: symbol.docUrl,
    }))
    .sort((left, right) => left.label.localeCompare(right.label));
}

module.exports = {
  documentationItems,
};
