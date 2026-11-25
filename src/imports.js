"use strict";

const { index } = require("./catalog");
const {
  closingBacktick,
  componentTemplateRanges,
  componentsIn,
  findProperty,
  inlineTemplate,
  matchingBracket,
} = require("./angular-component");
const { parseTags } = require("./context");

function identifiers(body) {
  return body
    .split(",")
    .map((part) => part.trim().split(/\s+/u)[0])
    .filter((name) => name && /^[A-Za-z_]/u.test(name));
}

function usageRange(tag, symbol) {
  const attribute = tag.attributes.find((item) =>
    symbol.attributes.includes(item.name),
  );

  if (attribute) {
    return { end: attribute.nameEnd, start: attribute.nameStart };
  }

  return { end: tag.nameEnd, start: tag.nameStart };
}

function directiveUsages(html) {
  const usages = [];

  for (const tag of parseTags(html)) {
    const attributeNames = tag.attributes.map((attribute) => attribute.name);

    for (const symbol of index.directivesFor(tag.name, attributeNames)) {
      if (symbol.kind === "directive") {
        usages.push({ name: symbol.name, ...usageRange(tag, symbol) });
      }
    }
  }

  return usages;
}

function classNamesIn(html) {
  const names = new Set(directiveUsages(html).map((usage) => usage.name));

  return [...names].sort();
}

function templateClassNames(tsText) {
  const names = new Set();

  for (const range of componentTemplateRanges(tsText)) {
    if (!range.content.includes("<")) {
      continue;
    }

    for (const name of classNamesIn(range.content)) {
      names.add(name);
    }
  }

  return [...names].sort();
}

function importedNames(tsText) {
  const names = new Set();
  const pattern =
    /import\s+\{(?<body>[^}]*)\}\s*from\s*['"]bootstrap-ng(?:\/[^'"]*)?['"]/gu;

  for (const match of tsText.matchAll(pattern)) {
    for (const name of identifiers(match.groups.body)) {
      names.add(name);
    }
  }

  return names;
}

function referencesTemplate(source, fileName) {
  for (const match of source.matchAll(
    /templateUrl\s*:\s*['"](?<url>[^'"]+)['"]/gu,
  )) {
    const { url } = match.groups;
    const boundary = url.length - fileName.length - 1;

    if (
      url.endsWith(fileName) &&
      (boundary < 0 || url[boundary] === "/" || url[boundary] === "\\")
    ) {
      return true;
    }
  }

  return false;
}

function targetForLeftover(tsText, components, templateFile) {
  if (templateFile) {
    const found = components.findIndex((component) =>
      referencesTemplate(
        tsText.slice(component.open, component.close + 1),
        templateFile,
      ),
    );

    if (found !== -1) {
      return found;
    }
  }

  return components.length === 1 ? 0 : -1;
}

function assignNames(tsText, classNames, templateFile) {
  const components = componentsIn(tsText);
  const assigned = components.map(() => []);
  const claimed = new Set();

  for (const [position, component] of components.entries()) {
    const html = inlineTemplate(tsText, component);

    if (!html) {
      continue;
    }

    const present = new Set(classNamesIn(html));

    for (const name of classNames) {
      if (!present.has(name)) {
        continue;
      }

      assigned[position].push(name);
      claimed.add(name);
    }
  }

  const target = targetForLeftover(tsText, components, templateFile);

  if (target !== -1) {
    for (const name of classNames) {
      if (!claimed.has(name) && !assigned[target].includes(name)) {
        assigned[target].push(name);
      }
    }
  }

  return components
    .map((component, position) => ({
      component,
      names: assigned[position],
    }))
    .filter((item) => item.names.length > 0);
}

function importsArrayIn(tsText, component) {
  const open = findProperty(
    tsText,
    component.open,
    component.close,
    "imports",
    "[",
  );

  if (open === -1) {
    return null;
  }

  const close = matchingBracket(tsText, open, "[", "]");

  if (close === -1) {
    return null;
  }

  return { body: tsText.slice(open + 1, close), close, open };
}

function insertNames(body, names) {
  if (!body.includes("\n")) {
    const trimmed = body.trim();
    const next = trimmed ? `${trimmed}, ${names.join(", ")}` : names.join(", ");

    return ` ${next} `;
  }

  const indent = body.match(/\n(?<indent>[ \t]+)\S/u)?.groups.indent ?? "  ";
  const block = names.map((name) => `${indent}${name},`).join("\n");

  if (/\n[ \t]*$/u.test(body)) {
    return body.replace(/\n(?<tail>[ \t]*)$/u, `\n${block}\n$<tail>`);
  }

  return `${body.replace(/\s*$/u, "")}\n${block}\n`;
}

function braceEdit(match, names) {
  const { body } = match.groups;
  const missing = names.filter((name) => !identifiers(body).includes(name));

  if (missing.length === 0) {
    return null;
  }

  const start = match.index + match[0].indexOf("{") + 1;

  return { end: start + body.length, start, text: insertNames(body, missing) };
}

function lastImportEnd(tsText) {
  let end = 0;

  for (const match of tsText.matchAll(/^import\s[\s\S]*?;/gmu)) {
    end = match.index + match[0].length;
  }

  return end;
}

function createImport(tsText, names) {
  const statement = `import { ${names.join(", ")} } from 'bootstrap-ng';\n`;
  const end = lastImportEnd(tsText);

  if (end === 0) {
    return { end: 0, start: 0, text: statement };
  }

  const start = tsText[end] === "\n" ? end + 1 : end;

  return {
    end: start,
    start,
    text: tsText[end] === "\n" ? statement : `\n${statement}`,
  };
}

function importStatementEdit(tsText, names) {
  if (names.length === 0) {
    return null;
  }

  const match = tsText.match(
    /import\s+\{(?<body>[^}]*)\}\s*from\s*['"]bootstrap-ng['"]/u,
  );

  if (!match) {
    return createImport(tsText, names);
  }

  return braceEdit(match, names);
}

function listEdit(array, names) {
  const missing = names.filter(
    (name) => !identifiers(array.body).includes(name),
  );

  if (missing.length === 0) {
    return null;
  }

  return {
    end: array.close,
    start: array.open + 1,
    text: insertNames(array.body, missing),
  };
}

function createImportsProperty(component, names) {
  const start = component.open + 1;

  return { end: start, start, text: `\n  imports: [${names.join(", ")}],` };
}

function componentImportsEdit(tsText, names, component) {
  if (names.length === 0) {
    return null;
  }

  const array = importsArrayIn(tsText, component);

  if (!array) {
    return createImportsProperty(component, names);
  }

  return listEdit(array, names);
}

function pendingImports(tsText, classNames, options = {}) {
  const imported = importedNames(tsText);
  const pending = [];

  for (const target of assignNames(tsText, classNames, options.templateFile)) {
    const array = importsArrayIn(tsText, target.component);
    const listed = new Set(array ? identifiers(array.body) : []);

    for (const name of target.names) {
      if (
        (!imported.has(name) || !listed.has(name)) &&
        !pending.includes(name)
      ) {
        pending.push(name);
      }
    }
  }

  return pending;
}

function buildImportEdits(tsText, classNames, options = {}) {
  const imported = importedNames(tsText);
  const needImport = classNames.filter((name) => !imported.has(name));
  const edits = [importStatementEdit(tsText, needImport)];

  for (const target of assignNames(tsText, classNames, options.templateFile)) {
    edits.push(componentImportsEdit(tsText, target.names, target.component));
  }

  return edits.filter(Boolean);
}

function inlineTemplateRange(tsText, component) {
  const open = findProperty(
    tsText,
    component.open,
    component.close,
    "template",
    "`",
  );

  if (open === -1) {
    return null;
  }

  const close = closingBacktick(tsText, open + 1);

  if (close === -1 || close > component.close) {
    return null;
  }

  return { content: tsText.slice(open + 1, close), start: open + 1 };
}

function isStandalone(tsText, component) {
  const body = tsText.slice(component.open, component.close + 1);

  return !/\bstandalone\s*:\s*false\b/u.test(body);
}

function unresolvedUsages(tsText, component, usages, base) {
  const imported = importedNames(tsText);
  const array = importsArrayIn(tsText, component);
  const listed = new Set(array ? identifiers(array.body) : []);

  return usages
    .filter((usage) => !imported.has(usage.name) || !listed.has(usage.name))
    .map((usage) => ({
      end: usage.end + base,
      name: usage.name,
      start: usage.start + base,
    }));
}

function missingInlineImports(tsText) {
  const missing = [];

  for (const component of componentsIn(tsText)) {
    const template = inlineTemplateRange(tsText, component);

    if (!template || !isStandalone(tsText, component)) {
      continue;
    }

    missing.push(
      ...unresolvedUsages(
        tsText,
        component,
        directiveUsages(template.content),
        template.start,
      ),
    );
  }

  return missing;
}

function missingTemplateImports(html, tsText, templateFile) {
  if (!templateFile) {
    return [];
  }

  const component = componentsIn(tsText).find((item) =>
    referencesTemplate(tsText.slice(item.open, item.close + 1), templateFile),
  );

  if (!component || !isStandalone(tsText, component)) {
    return [];
  }

  return unresolvedUsages(tsText, component, directiveUsages(html), 0);
}

function applyEdits(text, edits) {
  let next = text;

  for (const edit of [...edits].sort(
    (left, right) => right.start - left.start,
  )) {
    next = next.slice(0, edit.start) + edit.text + next.slice(edit.end);
  }

  return next;
}

module.exports = {
  applyEdits,
  buildImportEdits,
  classNamesIn,
  missingInlineImports,
  missingTemplateImports,
  pendingImports,
  templateClassNames,
};
