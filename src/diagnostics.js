"use strict";

const { index } = require("./catalog");
const { componentTemplateRanges } = require("./angular-component");
const { parseTags } = require("./context");
const { translate } = require("./l10n");

const DISMISS_REPLACEMENTS = {
  alert: "bsAlert with dismissible",
  modal: "bsDialogClose",
  offcanvas: "bsDrawerClose",
  toast: "bsToastClose",
};

const TOGGLE_REPLACEMENTS = {
  collapse: "bsCollapse",
  dropdown: "bsMenu",
  modal: "bsDialog",
  offcanvas: "bsDrawer",
  pill: "bsTab",
  popover: "bsPopover",
  tab: "bsTab",
  tooltip: "bsTooltip",
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

  return {
    end: attribute.valueEnd,
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

function dataApiDiagnostic(attribute) {
  const replacements =
    attribute.name === "data-bs-toggle" ? TOGGLE_REPLACEMENTS : null;
  const dismissals =
    attribute.name === "data-bs-dismiss" ? DISMISS_REPLACEMENTS : null;
  const replacement = (replacements ?? dismissals)?.[attribute.value];

  if (!replacement) {
    return null;
  }

  return {
    end: attribute.end,
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

function diagnoseTag(tag, settings) {
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
      const hint = dataApiDiagnostic(attribute);

      if (hint) {
        items.push(hint);
      }
    }
  }

  return items;
}

function diagnoseHtml(html, base, settings) {
  const found = [];

  for (const tag of parseTags(html)) {
    for (const item of diagnoseTag(tag, settings)) {
      found.push({ ...item, end: item.end + base, start: item.start + base });
    }
  }

  return found;
}

function settingsFrom(options) {
  return {
    hintBootstrap5DataApi: options.hintBootstrap5DataApi !== false,
    validateAttributeValues: options.validateAttributeValues !== false,
  };
}

function diagnose(text, languageId, options = {}) {
  const settings = settingsFrom(options);

  if (languageId === "html") {
    return diagnoseHtml(text, 0, settings);
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

  return found;
}

module.exports = {
  diagnose,
};
