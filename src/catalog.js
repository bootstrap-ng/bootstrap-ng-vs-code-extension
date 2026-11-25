"use strict";

const catalog = require("./data/catalog.json");

function pushMap(map, key, symbol) {
  const list = map.get(key) ?? [];
  list.push(symbol);
  map.set(key, list);
}

function hostAllows(symbol, tagName) {
  if (!tagName || symbol.tags.length === 0) {
    return true;
  }

  const host = tagName.toLowerCase();

  return symbol.tags.some((tag) => tag.toLowerCase() === host);
}

function createIndex(data) {
  const byAttribute = new Map();
  const byElement = new Map();
  const byName = new Map();

  for (const symbol of data.symbols) {
    byName.set(symbol.name, symbol);

    for (const attribute of symbol.attributes) {
      pushMap(byAttribute, attribute, symbol);
    }

    for (const tag of symbol.tags) {
      if (tag.includes("-")) {
        pushMap(byElement, tag.toLowerCase(), symbol);
      }
    }
  }

  return {
    attribute(name) {
      return byAttribute.get(name) ?? [];
    },
    directivesFor(tagName, attributeNames) {
      const found = new Map();
      const hosts = byElement.get(tagName?.toLowerCase()) ?? [];

      for (const symbol of hosts) {
        if (hostAllows(symbol, tagName)) {
          found.set(symbol.name, symbol);
        }
      }

      for (const attributeName of attributeNames) {
        for (const symbol of byAttribute.get(attributeName) ?? []) {
          if (hostAllows(symbol, tagName)) {
            found.set(symbol.name, symbol);
          }
        }
      }

      return [...found.values()];
    },
    element(name) {
      return byElement.get(name?.toLowerCase()) ?? [];
    },
    symbol(name) {
      return byName.get(name) ?? null;
    },
    symbols: data.symbols,
  };
}

const index = createIndex(catalog);

module.exports = {
  createIndex,
  hostAllows,
  index,
};
