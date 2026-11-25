"use strict";

function skipBraces(text, start) {
  let depth = 1;
  let index = start;

  while (index < text.length && depth > 0) {
    if (text[index] === "{") {
      depth += 1;
    } else if (text[index] === "}") {
      depth -= 1;
    }

    index += 1;
  }

  return index;
}

function closingBacktick(text, start) {
  let index = start;

  while (index < text.length) {
    if (text[index] === "\\") {
      index += 2;
      continue;
    }

    if (text[index] === "`") {
      return index;
    }

    if (text[index] === "$" && text[index + 1] === "{") {
      index = skipBraces(text, index + 2);
      continue;
    }

    index += 1;
  }

  return -1;
}

function skipWhitespace(text, offset) {
  let cursor = offset;

  while (cursor < text.length && /[\t\n\r ]/u.test(text[cursor])) {
    cursor += 1;
  }

  return cursor;
}

function skipComment(text, offset) {
  if (text[offset] === "/" && text[offset + 1] === "/") {
    let cursor = offset + 2;

    while (cursor < text.length && text[cursor] !== "\n") {
      cursor += 1;
    }

    return cursor;
  }

  if (text[offset] === "/" && text[offset + 1] === "*") {
    let cursor = offset + 2;

    while (
      cursor < text.length - 1 &&
      !(text[cursor] === "*" && text[cursor + 1] === "/")
    ) {
      cursor += 1;
    }

    return cursor + 2;
  }

  return offset;
}

function skipCode(text, offset) {
  const quote = text[offset];

  if (quote === "'" || quote === '"') {
    let cursor = offset + 1;

    while (
      cursor < text.length &&
      text[cursor] !== quote &&
      text[cursor] !== "\n"
    ) {
      cursor += text[cursor] === "\\" ? 2 : 1;
    }

    return Math.min(text.length, cursor + 1);
  }

  if (quote === "`") {
    const end = closingBacktick(text, offset + 1);

    return end === -1 ? text.length : end + 1;
  }

  return offset;
}

function skipStringLiteral(text, offset) {
  const quote = text[offset];

  if (quote !== "'" && quote !== '"') {
    return offset;
  }

  let cursor = offset + 1;

  while (
    cursor < text.length &&
    text[cursor] !== quote &&
    text[cursor] !== "\n"
  ) {
    cursor += text[cursor] === "\\" ? 2 : 1;
  }

  return Math.min(text.length, cursor + 1);
}

function skipBeforeProperty(text, offset) {
  let cursor = offset;

  while (cursor < text.length) {
    const spaced = skipWhitespace(text, cursor);

    if (spaced !== cursor) {
      cursor = spaced;
      continue;
    }

    const comment = skipComment(text, cursor);

    if (comment !== cursor) {
      cursor = comment;
      continue;
    }

    return cursor;
  }

  return cursor;
}

function skipTrivia(text, offset) {
  let cursor = offset;

  while (cursor < text.length) {
    const spaced = skipWhitespace(text, cursor);

    if (spaced !== cursor) {
      cursor = spaced;
      continue;
    }

    const comment = skipComment(text, cursor);

    if (comment !== cursor) {
      cursor = comment;
      continue;
    }

    const string = skipStringLiteral(text, cursor);

    if (string !== cursor) {
      return string;
    }

    return cursor;
  }

  return cursor;
}

function skipNonCode(text, offset) {
  let cursor = offset;

  while (cursor < text.length) {
    const trivia = skipTrivia(text, cursor);

    if (trivia !== cursor) {
      cursor = trivia;
      continue;
    }

    const code = skipCode(text, cursor);

    if (code !== cursor) {
      return code;
    }

    return cursor;
  }

  return cursor;
}

function matchingBracket(text, openIndex, open, close) {
  let depth = 0;

  for (let cursor = openIndex; cursor < text.length; cursor += 1) {
    const next = skipNonCode(text, cursor);

    if (next !== cursor) {
      cursor = next - 1;
      continue;
    }

    if (text[cursor] === open) {
      depth += 1;
    } else if (text[cursor] === close) {
      depth -= 1;

      if (depth === 0) {
        return cursor;
      }
    }
  }

  return -1;
}

function componentsIn(tsText) {
  const components = [];
  let cursor = 0;

  while (cursor < tsText.length) {
    cursor = skipTrivia(tsText, cursor);

    if (cursor >= tsText.length) {
      break;
    }

    if (!tsText.startsWith("@Component", cursor)) {
      cursor += 1;
      continue;
    }

    const previous = tsText[cursor - 1];

    if (previous && /[\w$]/u.test(previous)) {
      cursor += 1;
      continue;
    }

    let index = cursor + "@Component".length;
    index = skipTrivia(tsText, index);

    if (tsText[index] !== "(") {
      cursor += 1;
      continue;
    }

    index = skipTrivia(tsText, index + 1);

    if (tsText[index] !== "{") {
      cursor += 1;
      continue;
    }

    const open = index;
    const close = matchingBracket(tsText, open, "{", "}");

    if (close !== -1) {
      components.push({ close, open });
    }

    cursor = open + 1;
  }

  return components;
}

function readPropertyKey(text, cursor, limit) {
  const index = skipBeforeProperty(text, cursor);

  if (index >= limit) {
    return null;
  }

  const quote = text[index];

  if (quote === '"' || quote === "'") {
    let end = index + 1;

    while (end < limit && text[end] !== quote) {
      end += text[end] === "\\" ? 2 : 1;
    }

    if (end >= limit) {
      return null;
    }

    try {
      return { end: end + 1, name: JSON.parse(text.slice(index, end + 1)) };
    } catch {
      return null;
    }
  }

  if (!/[A-Za-z_$]/u.test(text[index])) {
    return null;
  }

  let end = index;

  while (end < limit && /[\w$]/u.test(text[end])) {
    end += 1;
  }

  return { end, name: text.slice(index, end) };
}

function skipValue(text, cursor, limit) {
  let index = skipTrivia(text, cursor);

  if (index >= limit) {
    return index;
  }

  if (text[index] === "{" || text[index] === "[") {
    const open = text[index];
    const close = open === "{" ? "}" : "]";
    const end = matchingBracket(text, index, open, close);

    return end === -1 ? limit : end + 1;
  }

  const code = skipCode(text, index);

  if (code !== index) {
    return code;
  }

  while (index < limit) {
    const ch = text[index];

    if (ch === "," || ch === "}") {
      return index;
    }

    const next = skipTrivia(text, index);

    if (next > index) {
      index = next;
      continue;
    }

    index += 1;
  }

  return index;
}

function findProperty(text, from, to, property, bracket) {
  let cursor = from + 1;
  let depth = 1;

  while (cursor < to) {
    cursor = skipBeforeProperty(text, cursor);

    if (cursor >= to) {
      break;
    }

    if (depth === 1 && text[cursor] === "}") {
      break;
    }

    if (depth > 1) {
      if (text[cursor] === "{" || text[cursor] === "[") {
        depth += 1;
      } else if (text[cursor] === "}" || text[cursor] === "]") {
        depth -= 1;
      }

      cursor += 1;
      continue;
    }

    const key = readPropertyKey(text, cursor, to);

    if (!key) {
      cursor += 1;
      continue;
    }

    let valueStart = skipTrivia(text, key.end);

    if (valueStart >= to || text[valueStart] !== ":") {
      cursor = skipValue(text, key.end, to);
      continue;
    }

    valueStart = skipTrivia(text, valueStart + 1);

    if (
      key.name === property &&
      (bracket === null || text[valueStart] === bracket)
    ) {
      return valueStart;
    }

    cursor = skipValue(text, valueStart, to);
  }

  return -1;
}

function inlineTemplate(tsText, component) {
  const start = findProperty(
    tsText,
    component.open,
    component.close,
    "template",
    "`",
  );

  if (start === -1) {
    return null;
  }

  const end = closingBacktick(tsText, start + 1);

  if (end === -1 || end > component.close) {
    return null;
  }

  return tsText.slice(start + 1, end);
}

function componentTemplateRanges(tsText) {
  const ranges = [];

  for (const component of componentsIn(tsText)) {
    const open = findProperty(
      tsText,
      component.open,
      component.close,
      "template",
      "`",
    );

    if (open === -1) {
      continue;
    }

    const close = closingBacktick(tsText, open + 1);

    if (close === -1 || close > component.close) {
      continue;
    }

    ranges.push({
      content: tsText.slice(open + 1, close),
      end: close,
      start: open + 1,
    });
  }

  return ranges;
}

module.exports = {
  closingBacktick,
  componentTemplateRanges,
  componentsIn,
  findProperty,
  inlineTemplate,
  matchingBracket,
  skipCode,
};
