"use strict";

const { translate } = require("./l10n");

function escapeText(value) {
  return value.replace(/</gu, "&lt;");
}

function documentationFor(symbol) {
  const parts = [`**${symbol.name}**`];

  if (symbol.summary) {
    parts.push(escapeText(symbol.summary));
  }

  if (symbol.selector) {
    parts.push(translate("Selector: `{0}`", symbol.selector));
  }

  if (symbol.docUrl) {
    parts.push(translate("[Docs]({0})", symbol.docUrl));
  }

  return parts.join("\n\n");
}

function inputDocumentation(input, symbol) {
  const parts = [
    translate("**{0}** on `{1}`", input.name, symbol.name),
    `\`${input.type}\``,
  ];

  if (input.defaultValue) {
    parts.push(translate("Default: `{0}`.", input.defaultValue));
  }

  if (input.description) {
    parts.push(escapeText(input.description));
  }

  if (input.model) {
    parts.push(translate("Supports `[({0})]`.", input.name));
  }

  if (input.values.length > 0 && input.values.length <= 12) {
    parts.push(input.values.map((value) => `\`${value}\``).join(", "));
  }

  if (symbol.docUrl) {
    parts.push(translate("[Docs]({0})", symbol.docUrl));
  }

  return parts.join("\n\n");
}

module.exports = {
  documentationFor,
  escapeText,
  inputDocumentation,
};
