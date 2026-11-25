"use strict";

const { componentTemplateRanges } = require("./angular-component");

function skipWhitespace(text, index) {
  let cursor = index;

  while (cursor < text.length && /[\t\n\r ]/u.test(text[cursor])) {
    cursor += 1;
  }

  return cursor;
}

function bareName(raw) {
  const twoWay = raw.match(/^\[\((?<name>[^)]+)\)\]$/u);

  if (twoWay) {
    return twoWay.groups.name;
  }

  const binding = raw.match(/^\[(?<name>[^\]]+)\]$/u);

  if (binding) {
    return binding.groups.name;
  }

  const output = raw.match(/^\((?<name>[^)]+)\)$/u);

  if (output) {
    return output.groups.name;
  }

  const star = raw.match(/^\*(?<name>.+)$/u);

  return star ? star.groups.name : raw;
}

function readValue(text, state) {
  const quote = text[state.index];
  const base = {
    name: bareName(state.rawName),
    nameEnd: state.nameEnd,
    nameStart: state.nameStart,
    rawName: state.rawName,
  };

  if (quote === '"' || quote === "'") {
    return quotedValue(text, state.index, quote, base);
  }

  let valueEnd = state.index;

  while (valueEnd < text.length && !/[\s>]/u.test(text[valueEnd])) {
    valueEnd += 1;
  }

  return {
    ...base,
    end: valueEnd,
    quote: null,
    value: text.slice(state.index, valueEnd),
    valueEnd,
    valueStart: state.index,
  };
}

function quotedValue(text, index, quote, base) {
  const valueStart = index + 1;
  let valueEnd = valueStart;

  while (valueEnd < text.length && text[valueEnd] !== quote) {
    valueEnd += 1;
  }

  const closed = valueEnd < text.length;

  return {
    ...base,
    end: closed ? valueEnd + 1 : valueEnd,
    quote,
    value: text.slice(valueStart, valueEnd),
    valueEnd,
    valueStart,
  };
}

function readAttribute(text, start) {
  let index = start;

  while (index < text.length && !/[\s=>/]/u.test(text[index])) {
    index += 1;
  }

  if (index === start) {
    return null;
  }

  const nameEnd = index;
  const rawName = text.slice(start, nameEnd);
  index = skipWhitespace(text, index);

  if (text[index] !== "=") {
    return {
      end: nameEnd,
      name: bareName(rawName),
      nameEnd,
      nameStart: start,
      quote: null,
      rawName,
      value: null,
      valueEnd: null,
      valueStart: null,
    };
  }

  return readValue(text, {
    index: skipWhitespace(text, index + 1),
    nameEnd,
    nameStart: start,
    rawName,
  });
}

function tagResult(state) {
  return {
    attributes: state.attributes,
    end: state.end,
    name: state.name,
    nameEnd: state.nameEnd,
    nameStart: state.nameStart,
    start: state.start,
    unclosed: state.unclosed === true,
  };
}

function finishTag(text, state) {
  let { index } = state;

  while (index < text.length) {
    index = skipWhitespace(text, index);

    if (index >= text.length) {
      return tagResult({ ...state, end: text.length, unclosed: true });
    }

    if (text[index] === ">") {
      return tagResult({ ...state, end: index + 1 });
    }

    if (text[index] === "/" && text[index + 1] === ">") {
      return tagResult({ ...state, end: index + 2 });
    }

    const attribute = readAttribute(text, index);

    if (!attribute) {
      break;
    }

    state.attributes.push(attribute);
    index = attribute.end;
  }

  return tagResult({ ...state, end: index, unclosed: true });
}

function parseTagAt(text, start) {
  if (text[start] !== "<" || !/[A-Za-z]/u.test(text[start + 1] ?? "")) {
    return null;
  }

  const nameStart = start + 1;
  let index = nameStart + 1;

  while (index < text.length && /[\w:-]/u.test(text[index])) {
    index += 1;
  }

  return finishTag(text, {
    attributes: [],
    index,
    name: text.slice(nameStart, index),
    nameEnd: index,
    nameStart,
    start,
  });
}

function commentEnd(text, start) {
  if (!text.startsWith("<!--", start)) {
    return -1;
  }

  const end = text.indexOf("-->", start + 4);

  return end === -1 ? text.length : end + 3;
}

function insideComment(text, index) {
  const start = text.lastIndexOf("<!--", index);

  if (start === -1) {
    return false;
  }

  const end = text.indexOf("-->", start + 4);

  return end === -1 || end >= index;
}

function rawElementEnd(text, start) {
  const match = /^<(?<name>script|style|textarea)(?![\w-])/iu.exec(
    text.slice(start),
  );

  if (!match) {
    return -1;
  }

  const { name } = match.groups;
  const close = text
    .toLowerCase()
    .indexOf(`</${name.toLowerCase()}`, start + match[0].length);

  if (close === -1) {
    return text.length;
  }

  const end = text.indexOf(">", close);

  return end === -1 ? text.length : end + 1;
}

function insideRawElement(text, index) {
  const lower = text.toLowerCase();

  for (const name of ["script", "style", "textarea"]) {
    let open = lower.lastIndexOf(`<${name}`, index);

    while (open !== -1) {
      const boundary = lower[open + name.length + 1];
      const opened =
        (!boundary || !/[\w-]/u.test(boundary)) && !insideComment(text, open);

      if (opened) {
        const close = lower.indexOf(`</${name}`, open + name.length + 2);

        if (close === -1 || close > index) {
          return true;
        }
      }

      open = lower.lastIndexOf(`<${name}`, open - 1);
    }
  }

  return false;
}

function parseTags(text) {
  const tags = [];
  let index = 0;

  while (index < text.length) {
    const start = text.indexOf("<", index);

    if (start === -1) {
      break;
    }

    const comment = commentEnd(text, start);
    const rawEnd = comment === -1 ? rawElementEnd(text, start) : -1;

    if (comment !== -1 || rawEnd !== -1) {
      index = comment === -1 ? rawEnd : comment;
      continue;
    }

    if (insideComment(text, start) || insideRawElement(text, start)) {
      index = start + 1;
      continue;
    }

    const tag = parseTagAt(text, start);
    index = tag ? Math.max(tag.end, start + 1) : start + 1;

    if (tag) {
      tags.push(tag);
    }
  }

  return tags;
}

function enclosingTag(text, offset) {
  let searchFrom = offset;

  while (searchFrom > 0) {
    const start = text.lastIndexOf("<", searchFrom - 1);

    if (start === -1) {
      return null;
    }

    if (insideComment(text, start) || insideRawElement(text, start)) {
      searchFrom = start;
      continue;
    }

    const tag = skippedTag(text, start) ? null : parseTagAt(text, start);

    if (tag && cursorInside(tag, offset, start)) {
      return tag;
    }

    searchFrom = start;
  }

  return null;
}

function skippedTag(text, start) {
  const next = text[start + 1];

  return next === "/" || next === "!" || next === "?";
}

function cursorInside(tag, offset, start) {
  if (offset <= start) {
    return false;
  }

  return tag.unclosed ? offset <= tag.end : offset < tag.end;
}

function publicAttribute(attribute) {
  return {
    name: attribute.name,
    rawName: attribute.rawName,
    value: attribute.value,
  };
}

const CLASS_TOKEN = /[A-Za-z0-9_:-]/u;

function insideInterpolation(text, start, offset) {
  const before = text.slice(start, offset);

  return before.lastIndexOf("{{") > before.lastIndexOf("}}");
}

function classTokenBounds(text, offset, valueStart, valueEnd) {
  let start = offset;
  let end = offset;

  while (start > valueStart && CLASS_TOKEN.test(text[start - 1])) {
    start -= 1;
  }

  while (end < valueEnd && CLASS_TOKEN.test(text[end])) {
    end += 1;
  }

  return { end, start };
}

function otherClassTokens(text, valueStart, valueEnd, tokenStart, tokenEnd) {
  const present = [];

  for (const match of text
    .slice(valueStart, valueEnd)
    .matchAll(/[A-Za-z0-9_:-]+/gu)) {
    const start = valueStart + match.index;
    const end = start + match[0].length;

    if (start === tokenStart && end === tokenEnd) {
      continue;
    }

    present.push(match[0]);
  }

  return present;
}

function classValueContext(text, offset, tag, attribute) {
  if (insideInterpolation(text, attribute.valueStart, offset)) {
    return null;
  }

  const token = classTokenBounds(
    text,
    offset,
    attribute.valueStart,
    attribute.valueEnd,
  );

  return {
    attribute: publicAttribute(attribute),
    attributes: tag.attributes.map(publicAttribute),
    end: token.end,
    kind: "class-name",
    prefix: text.slice(token.start, token.end),
    present: otherClassTokens(
      text,
      attribute.valueStart,
      attribute.valueEnd,
      token.start,
      token.end,
    ),
    quote: attribute.quote,
    start: token.start,
    tagName: tag.name,
  };
}

function attributeContext(text, offset, tag, attribute) {
  if (
    attribute.valueStart !== null &&
    offset >= attribute.valueStart &&
    offset <= attribute.valueEnd
  ) {
    if (attribute.rawName === "class" && attribute.quote) {
      const classContext = classValueContext(text, offset, tag, attribute);

      if (classContext) {
        return classContext;
      }
    }

    return {
      attribute: publicAttribute(attribute),
      attributes: tag.attributes.map(publicAttribute),
      end: attribute.valueEnd,
      kind: "attribute-value",
      prefix: text.slice(attribute.valueStart, offset),
      quote: attribute.quote,
      start: attribute.valueStart,
      tagName: tag.name,
    };
  }

  if (offset < attribute.nameStart || offset > attribute.nameEnd) {
    return null;
  }

  const attributes = tag.attributes
    .filter((item) => item !== attribute)
    .map(publicAttribute);

  return {
    attribute: publicAttribute(attribute),
    attributes,
    end: attribute.nameEnd,
    kind: "attribute-name",
    prefix: text.slice(attribute.nameStart, offset),
    start: attribute.nameStart,
    tagName: tag.name,
  };
}

function htmlContext(text, offset) {
  const tag = enclosingTag(text, offset);

  if (!tag) {
    return textContext(text, offset);
  }

  if (offset >= tag.nameStart && offset <= tag.nameEnd) {
    return {
      attributes: tag.attributes.map(publicAttribute),
      end: tag.nameEnd,
      kind: "tag-name",
      prefix: text.slice(tag.nameStart, offset),
      start: tag.nameStart,
      tagName: tag.name,
    };
  }

  for (const attribute of tag.attributes) {
    const context = attributeContext(text, offset, tag, attribute);

    if (context) {
      return context;
    }
  }

  return {
    attribute: null,
    attributes: tag.attributes.map(publicAttribute),
    end: offset,
    kind: "attribute-name",
    prefix: "",
    start: offset,
    tagName: tag.name,
  };
}

function textContext(text, offset) {
  const match = text.slice(0, offset).match(/(?<word>[A-Za-z][\w-]*)$/u);
  const prefix = match?.groups.word ?? "";

  return {
    attributes: [],
    end: offset,
    kind: "text",
    prefix,
    start: offset - prefix.length,
    tagName: null,
  };
}

function importContext(text, offset) {
  const before = text.slice(0, offset);
  const opened = before.match(/import\s+(?:type\s+)?\{(?<body>[^}]*)$/u);

  if (!opened) {
    return null;
  }

  const fromMatch = text
    .slice(offset)
    .match(/^(?<rest>[^}]*)\}\s*from\s*['"](?<specifier>[^'"]+)['"]/u);
  const specifier = fromMatch?.groups.specifier ?? null;

  if (specifier && !specifier.startsWith("bootstrap-ng")) {
    return null;
  }

  const segment = opened.groups.body.split(",").at(-1) ?? "";

  if (/\bas\b/u.test(segment)) {
    return null;
  }

  const word = before.match(/(?<word>[A-Za-z_][\w]*)$/u);
  const prefix = word?.groups.word ?? "";

  if (!specifier && !/^(?:Bs|provideBs|BOOTSTRAP)/u.test(prefix)) {
    return null;
  }

  return {
    attributes: [],
    end: offset,
    kind: "import",
    prefix,
    specifier,
    start: offset - prefix.length,
    tagName: null,
  };
}

function identifierContext(text, offset) {
  let start = offset;
  let end = offset;

  while (start > 0 && /[\w$]/u.test(text[start - 1])) {
    start -= 1;
  }

  while (end < text.length && /[\w$]/u.test(text[end])) {
    end += 1;
  }

  if (start === end) {
    return null;
  }

  return {
    attributes: [],
    end,
    kind: "identifier",
    prefix: text.slice(start, end),
    start,
    tagName: null,
  };
}

function shiftContext(context, base) {
  if (!context || base === 0) {
    return context;
  }

  return { ...context, end: context.end + base, start: context.start + base };
}

function analyzeTypeScript(text, offset) {
  const range = componentTemplateRanges(text).find(
    (item) => offset >= item.start && offset <= item.end,
  );

  if (range) {
    return shiftContext(
      htmlContext(range.content, offset - range.start),
      range.start,
    );
  }

  return importContext(text, offset) ?? identifierContext(text, offset);
}

function analyze(text, offset, languageId) {
  if (languageId === "typescript") {
    return analyzeTypeScript(text, offset);
  }

  if (languageId === "html") {
    return htmlContext(text, offset);
  }

  return null;
}

module.exports = {
  analyze,
  parseTags,
};
