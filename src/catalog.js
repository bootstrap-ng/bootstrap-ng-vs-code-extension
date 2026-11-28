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

function tagAllows(tag, tagName) {
  if (!tag || !tagName) {
    return true;
  }

  const host = tagName.toLowerCase();
  const suffix = host.includes(".")
    ? host.slice(host.lastIndexOf(".") + 1)
    : host;
  const lower = tag.toLowerCase();

  return lower === host || lower === suffix;
}

const SELECTOR_PART = /^(?<tag>[\w.-]*)(?<conditions>(?:\[[^\]]+\])*)$/u;

/*
 * Splits a selector such as `input[type=checkbox][bsCheck], a[bsButton]` into
 * its alternatives, or returns null when it is not a plain element and
 * attribute selector.
 */
function parseSelector(selector) {
  if (!selector) {
    return null;
  }

  const alternatives = [];

  for (const part of selector.split(",")) {
    const match = SELECTOR_PART.exec(part.trim());

    if (!match) {
      return null;
    }

    const conditions = [];

    for (const [, body] of match.groups.conditions.matchAll(
      /\[(?<body>[^\]]+)\]/gu,
    )) {
      const equals = body.indexOf("=");

      conditions.push(
        equals === -1
          ? { name: body.trim(), value: null }
          : {
              name: body.slice(0, equals).trim(),
              value: body
                .slice(equals + 1)
                .trim()
                .replace(/^(?<quote>["'])(?<inner>.*)\k<quote>$/u, "$<inner>"),
            },
      );
    }

    alternatives.push({ conditions, tag: match.groups.tag || null });
  }

  return alternatives;
}

/*
 * Attributes come as names, or as parsed attributes with a `value` and a
 * `rawName`. Only parsed static attributes can satisfy a value condition such
 * as `[type=checkbox]`; plain names skip value conditions.
 */
function attributeLookup(attributes) {
  const names = new Set();
  const values = new Map();
  let knowsValues = false;

  for (const attribute of attributes ?? []) {
    if (typeof attribute === "string") {
      names.add(attribute);
      continue;
    }

    if (!attribute?.name) {
      continue;
    }

    knowsValues = true;
    names.add(attribute.name);

    const isStatic =
      attribute.rawName === undefined || attribute.rawName === attribute.name;

    if (isStatic && typeof attribute.value === "string") {
      values.set(attribute.name.toLowerCase(), attribute.value.toLowerCase());
    }
  }

  return { knowsValues, names, values };
}

function conditionHolds(condition, lookup) {
  if (condition.value === null) {
    return lookup.names.has(condition.name);
  }

  if (!lookup.knowsValues) {
    return true;
  }

  return (
    lookup.values.get(condition.name.toLowerCase()) ===
    condition.value.toLowerCase()
  );
}

function createIndex(data) {
  const byAttribute = new Map();
  const byElement = new Map();
  const byName = new Map();
  const selectors = new Map();

  for (const symbol of data.symbols) {
    byName.set(symbol.name, symbol);
    selectors.set(symbol, parseSelector(symbol.selector));

    for (const attribute of symbol.attributes) {
      pushMap(byAttribute, attribute, symbol);
    }

    /*
     * Only element selectors such as `bs-icon` match by tag name. A selector
     * like `ng-template[bsRatingStar]` also needs its attribute, so it is
     * found through `byAttribute` instead.
     */
    for (const tag of symbol.tags) {
      if (tag.includes("-") && symbol.attributes.length === 0) {
        pushMap(byElement, tag.toLowerCase(), symbol);
      }
    }
  }

  function applies(symbol, tagName, lookup) {
    const alternatives = selectors.get(symbol);

    if (!alternatives) {
      return hostAllows(symbol, tagName);
    }

    return alternatives.some(
      (alternative) =>
        tagAllows(alternative.tag, tagName) &&
        alternative.conditions.every((condition) =>
          conditionHolds(condition, lookup),
        ),
    );
  }

  function directivesFor(tagName, attributes) {
    const lookup = attributeLookup(attributes);
    const found = new Map();
    const hosts = byElement.get(tagName?.toLowerCase()) ?? [];

    for (const symbol of hosts) {
      if (applies(symbol, tagName, lookup)) {
        found.set(symbol.name, symbol);
      }
    }

    for (const attributeName of lookup.names) {
      for (const symbol of byAttribute.get(attributeName) ?? []) {
        if (applies(symbol, tagName, lookup)) {
          found.set(symbol.name, symbol);
        }
      }
    }

    return [...found.values()];
  }

  return {
    attribute(name) {
      return byAttribute.get(name) ?? [];
    },
    directivesFor,
    /*
     * Directives named by an attribute on this element whose selector does not
     * match it, such as `bsButton` on a `div`, so Angular never applies them.
     */
    misplaced(tagName, attributes) {
      const lookup = attributeLookup(attributes);
      const matched = new Set(
        directivesFor(tagName, attributes).map((symbol) => symbol.name),
      );
      const found = [];

      for (const attributeName of lookup.names) {
        const candidates = (byAttribute.get(attributeName) ?? []).filter(
          (symbol) => symbol.kind === "directive",
        );

        if (
          candidates.length > 0 &&
          !candidates.some((symbol) => matched.has(symbol.name))
        ) {
          found.push({ attribute: attributeName, symbols: candidates });
        }
      }

      return found;
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
  misplaced(tagName, attributes) {
    return load().misplaced(tagName, attributes);
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
  parseSelector,
};
