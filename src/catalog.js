"use strict";

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
  const suffix = host.includes(".")
    ? host.slice(host.lastIndexOf(".") + 1)
    : host;

  return symbol.tags.some((tag) => {
    const lower = tag.toLowerCase();

    return lower === host || lower === suffix;
  });
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

let loaded = null;

/* Build the index on first use, so activation from a package.json does not
   parse the bundled catalog until it is needed. */
function load() {
  loaded ??= createIndex(require("./data/catalog.json"));
  return loaded;
}

const index = {
  attribute(name) {
    return load().attribute(name);
  },
  directivesFor(tagName, attributeNames) {
    return load().directivesFor(tagName, attributeNames);
  },
  element(name) {
    return load().element(name);
  },
  symbol(name) {
    return load().symbol(name);
  },
  get symbols() {
    return load().symbols;
  },
};

module.exports = {
  createIndex,
  hostAllows,
  index,
};
