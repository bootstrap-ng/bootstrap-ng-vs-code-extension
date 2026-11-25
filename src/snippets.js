"use strict";

const fs = require("node:fs");
const path = require("node:path");

// Resolves from both src/ (tests) and out/ (bundled extension).
const SNIPPETS_FILE = path.join(
  __dirname,
  "..",
  "snippets",
  "bootstrap-ng.code-snippets",
);

let loaded = null;

function templateSnippets() {
  if (!loaded) {
    try {
      const data = JSON.parse(fs.readFileSync(SNIPPETS_FILE, "utf8"));

      loaded = Object.values(data).map((entry) => ({
        body: Array.isArray(entry.body) ? entry.body.join("\n") : entry.body,
        description: entry.description,
        prefix: entry.prefix,
      }));
    } catch {
      loaded = [];
    }
  }

  return loaded;
}

module.exports = {
  templateSnippets,
};
