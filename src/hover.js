"use strict";

const { index } = require("./catalog");
const { classByName, documentationForClass } = require("./classes");
const { analyze } = require("./context");
const { documentationFor, inputDocumentation } = require("./markdown");

/*
 * The import context only covers the text before the cursor, for completion,
 * so widen it to the whole name for hovers and the docs command.
 */
function wholeName(text, context) {
  if (context.kind !== "import") {
    return context;
  }

  let { end, start } = context;

  while (start > 0 && /[\w$]/u.test(text[start - 1])) {
    start -= 1;
  }

  while (end < text.length && /[\w$]/u.test(text[end])) {
    end += 1;
  }

  return { ...context, end, prefix: text.slice(start, end), start };
}

function hoverResult(context, markdown) {
  return { end: context.end, markdown, start: context.start };
}

function findMember(directives, name) {
  for (const symbol of directives) {
    const input = symbol.inputs.find((item) => item.name === name);

    if (input) {
      return { input, symbol };
    }

    const output = symbol.outputs.find((item) => item.name === name);

    if (output) {
      return { output, symbol };
    }
  }

  return null;
}

function scopedDirectives(context) {
  const attributes = [...(context.attributes ?? [])];

  if (
    context.attribute?.name &&
    !attributes.some((item) => item.name === context.attribute.name)
  ) {
    attributes.push(context.attribute);
  }

  return index.directivesFor(context.tagName, attributes);
}

function owns(symbol, name) {
  return (
    symbol.attributes.includes(name) ||
    symbol.inputs.some((input) => input.name === name) ||
    symbol.outputs.some((output) => output.name === name)
  );
}

function hoverAttribute(context) {
  const name = context.attribute?.name;

  if (!name) {
    return null;
  }

  const directives = scopedDirectives(context);
  const owner = directives.find((symbol) => symbol.attributes.includes(name));

  if (owner && context.kind === "attribute-name") {
    return hoverResult(context, documentationFor(owner));
  }

  const member = findMember(directives, name);

  if (member?.input) {
    return hoverResult(
      context,
      inputDocumentation(member.input, member.symbol),
    );
  }

  if (member?.output) {
    return hoverResult(
      context,
      `**${member.output.name}** (\`${member.output.type}\`)\n\n${member.output.description}`,
    );
  }

  if (owner) {
    return hoverResult(context, documentationFor(owner));
  }

  return null;
}

function hoverAt(text, offset, languageId) {
  const found = analyze(text, offset, languageId);
  const context = found && wholeName(text, found);

  if (!context) {
    return null;
  }

  if (context.kind === "class-name") {
    const entry = classByName(context.prefix);

    return entry ? hoverResult(context, documentationForClass(entry)) : null;
  }

  if (context.kind === "attribute-name" || context.kind === "attribute-value") {
    return hoverAttribute(context);
  }

  if (context.kind === "tag-name") {
    const symbol = index.element(context.tagName)[0];

    return symbol ? hoverResult(context, documentationFor(symbol)) : null;
  }

  if (context.kind === "identifier" || context.kind === "import") {
    const symbol = index.symbol(context.prefix);

    return symbol ? hoverResult(context, documentationFor(symbol)) : null;
  }

  return null;
}

function symbolAt(text, offset, languageId) {
  const found = analyze(text, offset, languageId);
  const context = found && wholeName(text, found);

  if (!context) {
    return null;
  }

  if (context.kind === "identifier" || context.kind === "import") {
    return index.symbol(context.prefix);
  }

  if (context.kind === "tag-name") {
    return index.element(context.tagName)[0] ?? null;
  }

  if (context.kind !== "attribute-name" && context.kind !== "attribute-value") {
    return null;
  }

  const name = context.attribute?.name;
  const directives = scopedDirectives(context);

  return (
    directives.find((symbol) => owns(symbol, name)) ?? directives[0] ?? null
  );
}

module.exports = {
  hoverAt,
  symbolAt,
};
