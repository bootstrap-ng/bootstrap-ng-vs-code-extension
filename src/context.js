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

  const escaped = text[state.index + 1];

  if (quote === "\\" && (escaped === '"' || escaped === "'")) {
    return escapedValue(text, state.index, escaped, base);
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

  while (valueEnd < text.length) {
    if (text[valueEnd] === quote) {
      break;
    }

    valueEnd += text[valueEnd] === "\\" ? 2 : 1;
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

/*
 * A value quoted with escaped quotes, such as class=\"row\" inside a
 * double-quoted TypeScript template string.
 */
function escapedValue(text, index, quote, base) {
  const valueStart = index + 2;
  let valueEnd = valueStart;

  while (
    valueEnd < text.length &&
    !(text[valueEnd] === "\\" && text[valueEnd + 1] === quote)
  ) {
    valueEnd += 1;
  }

  const closed = valueEnd < text.length;

  return {
    ...base,
    end: closed ? valueEnd + 2 : valueEnd,
    escaped: true,
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

  while (index < text.length && /[\w.:-]/u.test(text[index])) {
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

function rawElementEnd(text, lower, start) {
  const match = /<(?<name>script|style|textarea)(?![\w-])/iuy;
  match.lastIndex = start;
  const found = match.exec(text);

  if (!found) {
    return -1;
  }

  const close = lower.indexOf(
    `</${found.groups.name.toLowerCase()}`,
    start + found[0].length,
  );

  if (close === -1) {
    return text.length;
  }

  const end = text.indexOf(">", close);

  return end === -1 ? text.length : end + 1;
}

function mergeRanges(ranges) {
  const merged = [];

  for (const range of ranges.sort((left, right) => left.start - right.start)) {
    const last = merged.at(-1);

    if (last && range.start <= last.end) {
      last.end = Math.max(last.end, range.end);
    } else {
      merged.push({ ...range });
    }
  }

  return merged;
}

function rangesContain(ranges, index) {
  let low = 0;
  let high = ranges.length - 1;

  while (low <= high) {
    const middle = Math.floor((low + high) / 2);

    if (ranges[middle].start > index) {
      high = middle - 1;
    } else if (ranges[middle].end <= index) {
      low = middle + 1;
    } else {
      return true;
    }
  }

  return false;
}

function commentRanges(text) {
  const ranges = [];
  let open = text.indexOf("<!--");

  while (open !== -1) {
    ranges.push({ end: commentEnd(text, open), start: open });
    open = text.indexOf("<!--", open + 1);
  }

  return mergeRanges(ranges);
}

/*
 * Scans left to right so text such as "<script" inside a textarea does not
 * start a raw element of its own and hide the rest of the document.
 */
function rawRanges(lower, comments) {
  const ranges = [];
  const pattern = /<(?<name>script|style|textarea)(?![\w-])/gu;
  let found = pattern.exec(lower);

  while (found) {
    if (!rangesContain(comments, found.index)) {
      const close = lower.indexOf(`</${found.groups.name}`, pattern.lastIndex);

      // Start after the "<" so the element's own tag is still parsed.
      ranges.push({
        end: close === -1 ? Infinity : close,
        start: found.index + 1,
      });

      if (close === -1) {
        break;
      }

      pattern.lastIndex = close;
    }

    found = pattern.exec(lower);
  }

  return ranges;
}

/*
 * Every offset that sits inside an HTML comment or a script, style or
 * textarea element, worked out in one pass so callers can check each "<"
 * without searching the whole text again.
 */
function skippedRanges(text, lower = text.toLowerCase()) {
  const comments = commentRanges(text);
  const ranges = mergeRanges([...comments, ...rawRanges(lower, comments)]);

  return (index) => rangesContain(ranges, index);
}

function parseTags(text) {
  const lower = text.toLowerCase();
  const skipped = skippedRanges(text, lower);
  const tags = [];
  let index = 0;

  while (index < text.length) {
    const start = text.indexOf("<", index);

    if (start === -1) {
      break;
    }

    const comment = commentEnd(text, start);

    if (comment !== -1) {
      index = comment;
      continue;
    }

    if (skipped(start)) {
      index = start + 1;
      continue;
    }

    const tag = parseTagAt(text, start);
    const rawEnd = rawElementEnd(text, lower, start);
    index = tag ? Math.max(tag.end, start + 1) : start + 1;

    if (tag) {
      tags.push(tag);
    }

    // Skip the content of script, style and textarea, but keep their own tag.
    if (rawEnd !== -1) {
      index = Math.max(index, rawEnd);
    }
  }

  return tags;
}

function enclosingTag(text, offset) {
  const skipped = skippedRanges(text);
  let searchFrom = offset;

  while (searchFrom > 0) {
    const start = text.lastIndexOf("<", searchFrom - 1);

    if (start === -1) {
      return null;
    }

    if (skipped(start)) {
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

const CLASS_BINDINGS = new Set(["[class]", "[ngClass]"]);
const CLOSERS = { ")": "(", "]": "[", "}": "{" };

function scanExpression(text, start, offset) {
  const stack = [];
  let literal = null;

  for (let index = start; index < offset; index += 1) {
    const char = text[index];

    if (literal) {
      if (char === "\\") {
        index += 1;
      } else if (char === literal.quote) {
        literal = null;
      }

      continue;
    }

    if (char === "'" || char === '"' || char === "`") {
      literal = { quote: char, start: index + 1 };
    } else if (char === "(" || char === "[" || char === "{") {
      stack.push(char);
    } else if (CLOSERS[char] && stack.at(-1) === CLOSERS[char]) {
      stack.pop();
    }
  }

  return { literal, stack };
}

function literalEnd(text, start, limit, quote) {
  let index = start;

  while (index < limit && text[index] !== quote) {
    index += text[index] === "\\" ? 2 : 1;
  }

  return Math.min(index, limit);
}

function bindingClassContext(text, offset, tag, attribute, range) {
  const token = classTokenBounds(text, offset, range.start, range.end);

  return {
    attribute: publicAttribute(attribute),
    attributes: tag.attributes.map(publicAttribute),
    end: token.end,
    insertQuote: range.insertQuote ?? null,
    kind: "class-name",
    prefix: text.slice(token.start, token.end),
    present: range.present
      ? range.present
      : otherClassTokens(text, range.start, range.end, token.start, token.end),
    quote: attribute.quote,
    start: token.start,
    tagName: tag.name,
  };
}

function objectKeyContext(text, offset, tag, attribute, stack) {
  if (stack.at(-1) !== "{") {
    return null;
  }

  let start = offset;

  while (start > attribute.valueStart && /[\w$-]/u.test(text[start - 1])) {
    start -= 1;
  }

  let before = start - 1;

  while (before >= attribute.valueStart && /\s/u.test(text[before])) {
    before -= 1;
  }

  if (text[before] !== "{" && text[before] !== ",") {
    return null;
  }

  let end = offset;

  while (end < attribute.valueEnd && /[\w$-]/u.test(text[end])) {
    end += 1;
  }

  return bindingClassContext(text, offset, tag, attribute, {
    end,
    insertQuote: attribute.quote === "'" ? '"' : "'",
    present: [],
    start,
  });
}

function classBindingContext(text, offset, tag, attribute) {
  if (!CLASS_BINDINGS.has(attribute.rawName) || !attribute.quote) {
    return null;
  }

  const { literal, stack } = scanExpression(text, attribute.valueStart, offset);

  if (!literal) {
    return objectKeyContext(text, offset, tag, attribute, stack);
  }

  if (
    literal.quote === "`" &&
    text.slice(literal.start, offset).includes("${")
  ) {
    return null;
  }

  return bindingClassContext(text, offset, tag, attribute, {
    end: literalEnd(text, offset, attribute.valueEnd, literal.quote),
    start: literal.start,
  });
}

function staticClassTokens(tag) {
  const names = [];

  for (const attribute of tag.attributes) {
    if (attribute.rawName === "class" && attribute.value) {
      names.push(...(attribute.value.match(/[A-Za-z0-9_:-]+/gu) ?? []));
    }

    const toggle = attribute.rawName.match(/^\[class\.(?<name>[^\]]+)\]$/u);

    if (toggle) {
      names.push(toggle.groups.name);
    }
  }

  return names;
}

function classToggleContext(text, offset, tag, attribute) {
  const nameStart = attribute.nameStart + "[class.".length;

  if (
    !attribute.rawName.startsWith("[class.") ||
    offset < nameStart ||
    offset > attribute.nameEnd
  ) {
    return null;
  }

  let end = nameStart;

  while (end < attribute.nameEnd && CLASS_TOKEN.test(text[end])) {
    end += 1;
  }

  if (offset > end) {
    return null;
  }

  const prefix = text.slice(nameStart, end);
  const others = tag.attributes.filter((item) => item !== attribute);

  return {
    attribute: publicAttribute(attribute),
    attributes: others.map(publicAttribute),
    end,
    kind: "class-name",
    prefix,
    present: staticClassTokens({ attributes: others }),
    start: nameStart,
    tagName: tag.name,
  };
}

/*
 * The value of a property binding such as [theme]="'primary'". Values go
 * inside the string literal under the cursor, or in a new literal when the
 * expression is empty. Anything else is an expression, not a value.
 */
function boundValueContext(text, offset, tag, attribute) {
  const base = {
    attribute: publicAttribute(attribute),
    attributes: tag.attributes.map(publicAttribute),
    kind: "attribute-value",
    quote: attribute.quote,
    tagName: tag.name,
  };
  const expression = {
    ...base,
    end: attribute.valueEnd,
    expression: true,
    prefix: text.slice(attribute.valueStart, offset),
    start: attribute.valueStart,
  };
  const { literal } = scanExpression(text, attribute.valueStart, offset);

  if (literal) {
    if (
      literal.quote === "`" &&
      text.slice(literal.start, offset).includes("${")
    ) {
      return expression;
    }

    return {
      ...base,
      end: literalEnd(text, offset, attribute.valueEnd, literal.quote),
      prefix: text.slice(literal.start, offset),
      start: literal.start,
    };
  }

  if (text.slice(attribute.valueStart, attribute.valueEnd).trim() === "") {
    return {
      ...base,
      end: attribute.valueEnd,
      insertQuote: attribute.quote === "'" ? '"' : "'",
      prefix: "",
      start: attribute.valueStart,
    };
  }

  return expression;
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

    const bindingContext = classBindingContext(text, offset, tag, attribute);

    if (bindingContext) {
      return bindingContext;
    }

    if (attribute.rawName === `[${attribute.name}]`) {
      return boundValueContext(text, offset, tag, attribute);
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

  const toggleContext = classToggleContext(text, offset, tag, attribute);

  if (toggleContext) {
    return toggleContext;
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
    const context = shiftContext(
      htmlContext(range.content, offset - range.start),
      range.start,
    );

    return range.quote === "`"
      ? context
      : { ...context, templateQuote: range.quote };
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
