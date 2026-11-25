"use strict";

function format(message, args) {
  return message.replace(/\{(?<index>\d+)\}/gu, (match, index) => {
    const value = args[Number(index)];

    return value === undefined ? match : String(value);
  });
}

function extensionTranslate() {
  try {
    const { l10n } = require("vscode");

    if (typeof l10n?.t === "function") {
      return (message, ...args) => l10n.t(message, ...args);
    }
  } catch {
    // Unit tests run outside the extension host, where vscode is absent.
  }

  return null;
}

const translateWithHost = extensionTranslate();

function translate(message, ...args) {
  if (translateWithHost) {
    return translateWithHost(message, ...args);
  }

  return format(message, args);
}

module.exports = {
  translate,
};
