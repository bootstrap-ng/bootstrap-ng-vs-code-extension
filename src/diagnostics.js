"use strict";

const { index } = require("./catalog");
const { componentTemplateRanges } = require("./angular-component");
const { parseTags } = require("./context");
const { missingInlineImports, missingTemplateImports } = require("./imports");
const { translate } = require("./l10n");

const DATA_API_CODE = "bootstrap5-data-api";
const INVALID_VALUE_CODE = "invalid-value";
const MISPLACED_CODE = "misplaced-directive";
const MISSING_IMPORT_CODE = "missing-import";

/*
 * Data attributes that move onto the same element as a bootstrap-ng directive
 * input when a data-bs-toggle tooltip or popover is replaced.
 */
const CONTENT_ATTRIBUTES = {
  popover: {
    "data-bs-content": "bsPopover",
    "data-bs-placement": "placement",
    "data-bs-title": "popoverTitle",
    "data-bs-trigger": "trigger",
    title: "popoverTitle",
  },
  tooltip: {
    "data-bs-placement": "placement",
    "data-bs-title": "bsTooltip",
    "data-bs-trigger": "trigger",
    title: "bsTooltip",
  },
};

const DISMISS_REPLACEMENTS = {
  alert: "bsAlert with dismissible",
  modal: "bsDialogClose",
  offcanvas: "bsDrawerClose",
  toast: "bsToastClose",
};

const TOGGLE_REPLACEMENTS = {
  collapse: "bsCollapseToggle",
  dropdown: "bsMenuToggle",
  modal: "bsDialog",
  offcanvas: "bsDrawerToggle",
  pill: "bsTab",
  popover: "bsPopover",
  tab: "bsTab",
  tooltip: "bsTooltip",
};

/*
 * Toggles and dismissals that become a single directive on the same element.
 * The rest (such as modal or collapse toggles) need a reference to the target
 * element, so they keep the hint without a quick fix.
 */
const SAME_ELEMENT_FIXES = {
  "data-bs-dismiss": {
    modal: "bsDialogClose",
    offcanvas: "bsDrawerClose",
    toast: "bsToastClose",
  },
  "data-bs-toggle": {
    popover: "bsPopover",
    tooltip: "bsTooltip",
  },
};

function expectedText(input) {
  if (input.values.length > 8) {
    return input.type;
  }

  return input.values.join(", ");
}

function isStaticAttribute(attribute) {
  return attribute.rawName === attribute.name;
}

/*
 * Optimal string alignment distance: Levenshtein plus adjacent transpositions,
 * so "primray" is one edit from "primary".
 */
function editDistance(left, right) {
  const rows = Array.from({ length: left.length + 1 }, (_unused, row) => [row]);

  for (let column = 1; column <= right.length; column += 1) {
    rows[0][column] = column;
  }

  for (let row = 1; row <= left.length; row += 1) {
    for (let column = 1; column <= right.length; column += 1) {
      const cost = left[row - 1] === right[column - 1] ? 0 : 1;

      rows[row][column] = Math.min(
        rows[row - 1][column] + 1,
        rows[row][column - 1] + 1,
        rows[row - 1][column - 1] + cost,
      );

      if (
        row > 1 &&
        column > 1 &&
        left[row - 1] === right[column - 2] &&
        left[row - 2] === right[column - 1]
      ) {
        rows[row][column] = Math.min(
          rows[row][column],
          rows[row - 2][column - 2] + 1,
        );
      }
    }
  }

  return rows[left.length][right.length];
}

function closestValues(value, values) {
  const typed = value.toLowerCase();
  const scored = [];

  for (const candidate of new Set(values)) {
    const distance = editDistance(typed, candidate.toLowerCase());
    const limit = Math.min(2, Math.floor(candidate.length / 3));

    if (distance <= limit) {
      scored.push({ candidate, distance });
    }
  }

  scored.sort(
    (left, right) =>
      left.distance - right.distance ||
      left.candidate.localeCompare(right.candidate),
  );

  return scored.slice(0, 3).map((item) => item.candidate);
}

function valueFixes(target, values) {
  const suggestions = closestValues(target.value, values);

  return suggestions.map((suggestion, position) => ({
    edits: [
      {
        end: target.end,
        start: target.start,
        text: suggestion,
      },
    ],
    preferred: position === 0 && suggestions.length === 1,
    title: translate('Change to "{0}"', suggestion),
  }));
}

/*
 * A property binding whose expression is one string literal, such as
 * [theme]="'primray'". The quote may be escaped when the template is itself a
 * quoted TypeScript string.
 */
const STRING_LITERAL =
  /^(?<lead>\s*(?<escape>\\?)(?<quote>['"]))(?<inner>[^'"\\]*)\k<escape>\k<quote>\s*$/u;

function boundLiteral(attribute) {
  if (
    attribute.rawName !== `[${attribute.name}]` ||
    attribute.valueStart === null ||
    attribute.value === null
  ) {
    return null;
  }

  const match = STRING_LITERAL.exec(attribute.value);

  if (!match) {
    return null;
  }

  const start = attribute.valueStart + match.groups.lead.length;

  return {
    end: start + match.groups.inner.length,
    label: `[${attribute.name}]`,
    quoted: `'${match.groups.inner}'`,
    start,
    value: match.groups.inner,
  };
}

/*
 * The value to check against an input's documented values: a static
 * attribute value, or a string literal bound to the input.
 */
function enumTarget(attribute) {
  if (!isStaticAttribute(attribute)) {
    return boundLiteral(attribute);
  }

  if (attribute.quote !== '"' && attribute.quote !== "'") {
    return null;
  }

  return {
    end: attribute.valueEnd,
    label: attribute.name,
    quoted: attribute.value,
    start: attribute.valueStart,
    value: attribute.value,
  };
}

function enumDiagnostic(attribute, directives) {
  const target = enumTarget(attribute);

  if (!target?.value || target.value.includes("{{")) {
    return null;
  }

  const inputs = directives.flatMap((directive) =>
    directive.inputs.filter(
      (input) => input.name === attribute.name && input.values.length > 0,
    ),
  );

  if (
    inputs.length === 0 ||
    inputs.some((input) =>
      input.values.some(
        (value) => value.toLowerCase() === target.value.toLowerCase(),
      ),
    )
  ) {
    return null;
  }

  const input = inputs[0];
  const fixes = valueFixes(
    target,
    inputs.flatMap((item) => item.values),
  );

  return {
    code: INVALID_VALUE_CODE,
    end: target.end,
    fixes,
    message: translate(
      '{0}="{1}" is not a documented bootstrap-ng value. Expected {2}.',
      target.label,
      target.quoted,
      expectedText(input),
    ),
    severity: "warning",
    start: target.start,
  };
}

/*
 * Start of an attribute including the whitespace before it, so removing it
 * leaves the tag tidy.
 */
function removalStart(html, attribute) {
  let start = attribute.nameStart;

  while (start > 0 && /\s/u.test(html[start - 1])) {
    start -= 1;
  }

  return start;
}

function attributeText(name, attribute) {
  if (attribute.value === null) {
    return name;
  }

  const mark = attribute.quote ?? '"';
  // Keep escaped quotes inside a quoted TypeScript template string.
  const quote = attribute.escaped ? `\\${mark}` : mark;

  return `${name}=${quote}${attribute.value}${quote}`;
}

function dataApiFixes(html, tag, attribute) {
  const directive = SAME_ELEMENT_FIXES[attribute.name]?.[attribute.value];

  if (!directive) {
    return [];
  }

  const moves = CONTENT_ATTRIBUTES[attribute.value] ?? {};
  const edits = [];
  const added = new Map();

  for (const other of tag.attributes) {
    const target = moves[other.name];

    if (!target || !isStaticAttribute(other) || added.has(target)) {
      continue;
    }

    if (other.value === null || other.value === "") {
      continue;
    }

    added.set(target, attributeText(target, other));
    edits.push({ end: other.end, start: removalStart(html, other), text: "" });
  }

  const value = added.get(directive);
  added.delete(directive);

  const replacement = [
    value ?? directive,
    ...[...added.keys()].sort().map((key) => added.get(key)),
  ].join(" ");

  edits.push({
    end: attribute.end,
    start: attribute.nameStart,
    text: replacement,
  });
  edits.sort((left, right) => left.start - right.start);

  return [
    {
      edits,
      preferred: true,
      title: translate("Replace with {0}", directive),
    },
  ];
}

function dataApiDiagnostic(html, tag, attribute) {
  const replacements =
    attribute.name === "data-bs-toggle" ? TOGGLE_REPLACEMENTS : null;
  const dismissals =
    attribute.name === "data-bs-dismiss" ? DISMISS_REPLACEMENTS : null;
  const replacement = (replacements ?? dismissals)?.[attribute.value];

  if (!replacement) {
    return null;
  }

  return {
    code: DATA_API_CODE,
    end: attribute.end,
    fixes: dataApiFixes(html, tag, attribute),
    message: translate(
      'Bootstrap 5 {0}="{1}" is handled by {2} in bootstrap-ng.',
      attribute.name,
      attribute.value,
      translate(replacement),
    ),
    severity: "information",
    start: attribute.nameStart,
  };
}

function ownsName(directives, name) {
  return directives.some(
    (directive) =>
      directive.attributes.includes(name) ||
      directive.inputs.some((input) => input.name === name) ||
      directive.outputs.some((output) => output.name === name),
  );
}

/*
 * A directive attribute on an element its selector does not match, such as
 * `bsButton` on a `div` or `bsCheck` on a radio input, which Angular silently
 * ignores.
 */
function misplacedDiagnostics(tag, directives) {
  const items = [];

  for (const { attribute, symbols } of index.misplaced(
    tag.name,
    tag.attributes,
  )) {
    const node = tag.attributes.find((item) => item.name === attribute);

    if (!node || ownsName(directives, attribute)) {
      continue;
    }

    items.push({
      code: MISPLACED_CODE,
      end: node.nameEnd,
      fixes: [],
      message: translate(
        "{0} has no effect on <{1}>. It applies to {2}.",
        attribute,
        tag.name,
        symbols.map((symbol) => symbol.selector).join(", "),
      ),
      severity: "warning",
      start: node.nameStart,
    });
  }

  return items;
}

function diagnoseTag(html, tag, settings) {
  const directives = index.directivesFor(tag.name, tag.attributes);
  const items = settings.validateHostElements
    ? misplacedDiagnostics(tag, directives)
    : [];

  for (const attribute of tag.attributes) {
    if (settings.validateAttributeValues) {
      const enumItem = enumDiagnostic(attribute, directives);

      if (enumItem) {
        items.push(enumItem);
      }
    }

    if (settings.hintBootstrap5DataApi) {
      const hint = dataApiDiagnostic(html, tag, attribute);

      if (hint) {
        items.push(hint);
      }
    }
  }

  return items;
}

function shift(item, base) {
  return {
    ...item,
    end: item.end + base,
    fixes: item.fixes.map((fix) => ({
      ...fix,
      edits: fix.edits.map((edit) => ({
        ...edit,
        end: edit.end + base,
        start: edit.start + base,
      })),
    })),
    start: item.start + base,
  };
}

function diagnoseHtml(html, base, settings) {
  const found = [];

  for (const tag of parseTags(html)) {
    for (const item of diagnoseTag(html, tag, settings)) {
      found.push(shift(item, base));
    }
  }

  return found;
}

function missingImportDiagnostic(usage) {
  return {
    code: MISSING_IMPORT_CODE,
    end: usage.end,
    fixes: [],
    message: translate(
      "{0} is used in this template but not imported.",
      usage.name,
    ),
    severity: "warning",
    start: usage.start,
  };
}

function settingsFrom(options) {
  return {
    hintBootstrap5DataApi: options.hintBootstrap5DataApi !== false,
    validateAttributeValues: options.validateAttributeValues !== false,
    validateHostElements: options.validateHostElements !== false,
    validateImports: options.validateImports !== false,
  };
}

function diagnose(text, languageId, options = {}) {
  const settings = settingsFrom(options);

  if (languageId === "html") {
    const missing =
      settings.validateImports && options.componentSource
        ? missingTemplateImports(
            text,
            options.componentSource,
            options.templateFile,
          )
        : [];

    return [
      ...diagnoseHtml(text, 0, settings),
      ...missing.map(missingImportDiagnostic),
    ];
  }

  if (languageId !== "typescript") {
    return [];
  }

  const found = [];

  for (const range of componentTemplateRanges(text)) {
    if (!range.content.includes("<")) {
      continue;
    }

    found.push(...diagnoseHtml(range.content, range.start, settings));
  }

  if (settings.validateImports) {
    found.push(...missingInlineImports(text).map(missingImportDiagnostic));
  }

  return found;
}

module.exports = {
  DATA_API_CODE,
  INVALID_VALUE_CODE,
  MISPLACED_CODE,
  closestValues,
  diagnose,
  MISSING_IMPORT_CODE,
};
