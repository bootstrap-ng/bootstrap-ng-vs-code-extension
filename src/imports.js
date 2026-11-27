"use strict";

const { index } = require("./catalog");
const {
  componentTemplateRanges,
  componentsIn,
  findProperty,
  inlineTemplate,
  matchingBracket,
  templateRange,
} = require("./angular-component");
const { parseTags } = require("./context");

function specifiers(body) {
  return body
    .split(",")
    .map((part) =>
      part
        .trim()
        .replace(/^type\s+/u, "")
        .split(/\s+/u),
    )
    .filter(([name]) => name && /^[A-Za-z_$]/u.test(name));
}

function identifiers(body) {
  return specifiers(body).map(([name]) => name);
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

/*
 * Maps each named import to its local name, so `import { BsAlert as Alert }`
 * gives BsAlert -> Alert. Any module counts, not only bootstrap-ng, because
 * the library's own files import from relative paths and apps can re-export
 * bootstrap-ng through a barrel file. Classes declared in the file count too,
 * because the library's components import directives declared next to them.
 * Only declarations at the start of a line count, so `class Foo` in a comment
 * or string does not, and an import's mapping is never replaced.
 */
function importedNames(tsText) {
  const names = new Map();
  const pattern = /import\s+\{(?<body>[^}]*)\}\s*from\s*['"][^'"\n]+['"]/gu;
  const declaration =
    /^[ \t]*(?:export[ \t]+)?(?:default[ \t]+)?(?:abstract[ \t]+)?class[ \t]+(?<name>[A-Za-z_$][\w$]*)/gmu;

  for (const match of tsText.matchAll(pattern)) {
    for (const [name, keyword, local] of specifiers(match.groups.body)) {
      names.set(name, keyword === "as" && local ? local : name);
    }
  }

  for (const match of tsText.matchAll(declaration)) {
    if (!names.has(match.groups.name)) {
      names.set(match.groups.name, match.groups.name);
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
    .filter(
      (item) =>
        item.names.length > 0 && !declaredInNgModule(tsText, item.component),
    );
}

/*
 * A component marked `standalone: false` belongs to an NgModule, where an
 * `imports` property is a compile error, so the import fixes leave it alone.
 */
function declaredInNgModule(tsText, component) {
  return /\bstandalone\s*:\s*false\b/u.test(
    tsText.slice(component.open, component.close + 1),
  );
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

/*
 * Adds a comma after the last entry of a list body when it has none, keeping
 * any trailing comment and whitespace after it.
 */
function withTrailingComma(body) {
  const content = body.slice(0, body.search(/\s*$/u));
  const lastLine = content.slice(content.lastIndexOf("\n") + 1);
  const code = lastLine.replace(/\s*(?:\/\/.*|\/\*.*\*\/)$/u, "");
  const codeEnd = content.length - lastLine.length + code.length;

  if (!content.slice(0, codeEnd).trim() || content[codeEnd - 1] === ",") {
    return body;
  }

  return `${body.slice(0, codeEnd)},${body.slice(codeEnd)}`;
}

function insertNames(body, names) {
  if (!body.includes("\n")) {
    const trimmed = withTrailingComma(body.trim());
    const next = trimmed ? `${trimmed} ${names.join(", ")}` : names.join(", ");

    return ` ${next} `;
  }

  const indent = body.match(/\n(?<indent>[ \t]+)\S/u)?.groups.indent ?? "  ";
  const block = names.map((name) => `${indent}${name},`).join("\n");
  const listed = withTrailingComma(body);

  if (/\n[ \t]*$/u.test(listed)) {
    return listed.replace(/\n(?<tail>[ \t]*)$/u, `\n${block}\n$<tail>`);
  }

  return `${listed.replace(/\s*$/u, "")}\n${block}\n`;
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

/*
 * End of the last static import statement. Matching the module specifier
 * rather than the next semicolon keeps files written without semicolons
 * intact.
 */
function lastImport(tsText) {
  const pattern =
    /^import\s+(?:type\s+)?(?:[\w$*{},\s]+?\s*from\s*)?(?<quote>['"])[^'"\n]+\k<quote>[ \t]*;?/gmu;
  let last = { end: 0, semicolon: true };

  for (const match of tsText.matchAll(pattern)) {
    last = {
      end: match.index + match[0].length,
      semicolon: match[0].endsWith(";"),
    };
  }

  return last;
}

function createImport(tsText, names) {
  const { end, semicolon } = lastImport(tsText);
  const statement = `import { ${names.join(", ")} } from 'bootstrap-ng'${semicolon ? ";" : ""}\n`;

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

  const pattern =
    /import\s+\{(?<body>[^}]*)\}\s*from\s*['"]bootstrap-ng(?:\/[^'"]*)?['"]/gu;
  let match = null;

  for (const found of tsText.matchAll(pattern)) {
    match = found;

    if (/from\s*['"]bootstrap-ng['"]/u.test(found[0])) {
      break;
    }
  }

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

/*
 * Which directives a component's imports already provide. An imports value
 * that is not an array literal, a spread, or BOOTSTRAP_NG can provide any
 * directive, so the component counts as importing all of them.
 */
function componentResolver(tsText, component, imported) {
  const property = findProperty(
    tsText,
    component.open,
    component.close,
    "imports",
    null,
  );
  const array = importsArrayIn(tsText, component);
  const listed = new Set(array ? identifiers(array.body) : []);
  const all =
    (property !== -1 && !array) ||
    Boolean(array?.body.includes("...")) ||
    (imported.has("BOOTSTRAP_NG") && listed.has(imported.get("BOOTSTRAP_NG")));

  return (name) =>
    all || (imported.has(name) && listed.has(imported.get(name)));
}

function pendingImports(tsText, classNames, options = {}) {
  const imported = importedNames(tsText);
  const pending = [];

  for (const target of assignNames(tsText, classNames, options.templateFile)) {
    const resolved = componentResolver(tsText, target.component, imported);

    for (const name of target.names) {
      if (!resolved(name) && !pending.includes(name)) {
        pending.push(name);
      }
    }
  }

  return pending;
}

function buildImportEdits(tsText, classNames, options = {}) {
  const imported = importedNames(tsText);
  const needed = new Set();
  const componentEdits = [];

  for (const target of assignNames(tsText, classNames, options.templateFile)) {
    const resolved = componentResolver(tsText, target.component, imported);
    const names = target.names.filter((name) => !resolved(name));

    for (const name of names) {
      needed.add(name);
    }

    componentEdits.push(
      componentImportsEdit(
        tsText,
        names.map((name) => imported.get(name) ?? name),
        target.component,
      ),
    );
  }

  const needImport = classNames.filter(
    (name) => needed.has(name) && !imported.has(name),
  );

  return [importStatementEdit(tsText, needImport), ...componentEdits].filter(
    Boolean,
  );
}

function isStandalone(tsText, component) {
  const body = tsText.slice(component.open, component.close + 1);

  if (declaredInNgModule(tsText, component)) {
    return false;
  }

  if (/\bstandalone\s*:\s*true\b/u.test(body)) {
    return true;
  }

  if (/\bimports\s*:/u.test(body)) {
    return true;
  }

  /*
   * `templateUrl` without an imports array usually points at an NgModule
   * component. Inline templates without either still get checked.
   */
  return !/\btemplateUrl\s*:/u.test(body);
}

function unresolvedUsages(tsText, component, usages, base) {
  const resolved = componentResolver(tsText, component, importedNames(tsText));

  return usages
    .filter((usage) => !resolved(usage.name))
    .map((usage) => ({
      end: usage.end + base,
      name: usage.name,
      start: usage.start + base,
    }));
}

function missingInlineImports(tsText) {
  const missing = [];

  for (const component of componentsIn(tsText)) {
    const template = templateRange(tsText, component);

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
