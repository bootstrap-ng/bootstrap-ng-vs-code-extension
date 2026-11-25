"use strict";

const { index } = require("./catalog");
const { componentTemplateRanges } = require("./angular-component");
const { parseTags } = require("./context");
const { missingInlineImports, missingTemplateImports } = require("./imports");
const { translate } = require("./l10n");

const DATA_API_CODE = "bootstrap5-data-api";
const INVALID_VALUE_CODE = "invalid-value";
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

function namesOf(tag) {
  return tag.attributes.map((attribute) => attribute.name);
}

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

function valueFixes(attribute, values) {
  const suggestions = closestValues(attribute.value, values);

  return suggestions.map((suggestion, position) => ({
    edits: [
      {
        end: attribute.valueEnd,
        start: attribute.valueStart,
        text: suggestion,
      },
    ],
    preferred: position === 0 && suggestions.length === 1,
    title: translate('Change to "{0}"', suggestion),
  }));
}

function enumDiagnostic(attribute, directives) {
  if (
    !isStaticAttribute(attribute) ||
    (attribute.quote !== '"' && attribute.quote !== "'")
  ) {
    return null;
  }

  if (!attribute.value || attribute.value.includes("{{")) {
    return null;
  }

  const inputs = directives.flatMap((directive) =>
    directive.inputs.filter(
      (input) => input.name === attribute.name && input.values.length > 0,
    ),
  );

  if (
    inputs.length === 0 ||
    inputs.some((input) => input.values.includes(attribute.value))
  ) {
    return null;
  }

  const input = inputs[0];
  const fixes = valueFixes(
    attribute,
    inputs.flatMap((item) => item.values),
  );

  return {
    code: INVALID_VALUE_CODE,
    end: attribute.valueEnd,
    fixes,
    message: translate(
      '{0}="{1}" is not a documented bootstrap-ng value. Expected {2}.',
      attribute.name,
      attribute.value,
      expectedText(input),
    ),
    severity: "warning",
    start: attribute.valueStart,
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

  const quote = attribute.quote ?? '"';

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

function diagnoseTag(html, tag, settings) {
  const directives = index.directivesFor(tag.name, namesOf(tag));
  const items = [];

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
  closestValues,
  diagnose,
  MISSING_IMPORT_CODE,
};
