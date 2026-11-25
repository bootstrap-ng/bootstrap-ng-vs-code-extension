"use strict";

const fs = require("node:fs");
const path = require("node:path");

const { buildCatalog } = require("./parse-docs");

const LINK_URL = "https://bootstrap-ng.com/llms.txt";
const FULL_URL = "https://bootstrap-ng.com/llms-full.txt";

async function readSource(source) {
  if (source.startsWith("http://") || source.startsWith("https://")) {
    const response = await fetch(source);

    if (!response.ok) {
      throw new Error(`Failed to fetch ${source}: ${response.status}`);
    }

    return response.text();
  }

  return fs.promises.readFile(source, "utf8");
}

async function main() {
  const linkSource = process.argv[2] ?? LINK_URL;
  const fullSource = process.argv[3] ?? FULL_URL;
  const [linkMarkdown, fullMarkdown] = await Promise.all([
    readSource(linkSource),
    readSource(fullSource),
  ]);
  const catalog = buildCatalog(linkMarkdown, fullMarkdown);
  const destination = path.join(__dirname, "..", "src", "data", "catalog.json");

  await fs.promises.mkdir(path.dirname(destination), { recursive: true });
  await fs.promises.writeFile(
    destination,
    `${JSON.stringify(catalog, null, 2)}\n`,
  );
  process.stdout.write(
    `Wrote ${catalog.symbols.length} symbols to ${destination}\n`,
  );
}

main().catch((error) => {
  process.stderr.write(`${error.stack ?? error.message}\n`);
  process.exitCode = 1;
});
