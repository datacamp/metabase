export * from "./config";

import _ from "underscore";
import Dimension from "metabase-lib/lib/Dimension";
import {
  OPERATORS,
  FUNCTIONS,
  getMBQLName,
  LITERAL_QUOTE_DEFAULT,
  IDENTIFIER_QUOTE_DEFAULT,
  IDENTIFIER_ALWAYS_QUOTE,
} from "./config";

// IDENTIFIERS

// can be double-quoted, but are not by default unless they have non-word characters or are reserved
export function formatIdentifier(name) {
  if (!IDENTIFIER_ALWAYS_QUOTE && /^\w+$/.test(name) && !isReservedWord(name)) {
    return name;
  }
  return quoteString(name, IDENTIFIER_QUOTE_DEFAULT);
}

export function parseIdentifierString(identifierString) {
  return unquoteString(identifierString);
}

export function isReservedWord(word) {
  return !!getMBQLName(word);
}

// METRICS

export function parseMetric(metricName, query) {
  return query
    .table()
    .metrics.find(
      metric => metric.name.toLowerCase() === metricName.toLowerCase(),
    );
}

export function formatMetricName(metric) {
  return formatIdentifier(metric.name);
}

// SEGMENTS

export function parseSegment(segmentName, query) {
  return query
    .table()
    .segments.find(
      segment => segment.name.toLowerCase() === segmentName.toLowerCase(),
    );
}

export function formatSegmentName(segment) {
  return formatIdentifier(segment.name);
}

// DIMENSIONS

export function parseDimension(name, query) {
  // FIXME: this is pretty inefficient, create a lookup table?
  return query
    .dimensionOptions()
    .all()
    .find(d => getDimensionName(d) === name);
}

export function formatDimensionName(dimension) {
  return formatIdentifier(getDimensionName(dimension));
}

export function getDimensionName(dimension) {
  return dimension.render();
}

// STRING LITERALS

export function formatStringLiteral(mbqlString) {
  return quoteString(mbqlString, LITERAL_QUOTE_DEFAULT);
}
export function parseStringLiteral(expressionString) {
  return unquoteString(expressionString);
}

function quoteString(string, quote) {
  if (quote === '"') {
    return JSON.stringify(string);
  } else if (quote === "'") {
    return swapQuotes(JSON.stringify(swapQuotes(string)));
  } else if (quote === "[") {
    // TODO: escape brackets
    if (string.match(/\[|\]/)) {
      throw new Error("String currently can't contain brackets: " + string);
    }
    return `[${string}]`;
  } else {
    throw new Error("Unknown quoting: " + quote);
  }
}
function unquoteString(string) {
  const quote = string.charAt(0);
  if (quote === '"') {
    return JSON.parse(string);
  } else if (quote === "'") {
    return swapQuotes(JSON.parse(swapQuotes(string)));
  } else if (quote === "[") {
    // TODO: unescape brackets
    return string.slice(1, -1);
  } else {
    throw new Error("Unknown quoting: " + string);
  }
}

// HACK: use JSON.stringify to escape single quotes by swapping single and doulble quotes before/after
function swapQuotes(str) {
  return str.replace(/['"]/g, q => (q === "'" ? '"' : "'"));
}

// move to query lib

export function isExpression(expr) {
  return (
    isLiteral(expr) ||
    isOperator(expr) ||
    isFunction(expr) ||
    isDimension(expr) ||
    isMetric(expr) ||
    isSegment(expr) ||
    isCase(expr)
  );
}

export function isLiteral(expr) {
  return isStringLiteral(expr) || isNumberLiteral(expr);
}

export function isStringLiteral(expr) {
  return typeof expr === "string";
}

export function isNumberLiteral(expr) {
  return typeof expr === "number";
}

export function isOperator(expr) {
  return (
    Array.isArray(expr) &&
    OPERATORS.has(expr[0]) &&
    expr
      .slice(1, hasOptions(expr) ? -1 : 0) // skip options object at the end
      .every(isExpression)
  );
}

function isPlainObject(obj) {
  return obj && Object.getPrototypeOf(obj) === Object.prototype;
}

export function hasOptions(expr) {
  return isPlainObject(expr[expr.length - 1]);
}

export function isFunction(expr) {
  return (
    Array.isArray(expr) &&
    FUNCTIONS.has(expr[0]) &&
    expr
      .slice(1, hasOptions(expr) ? -1 : 0) // skip options object at the end
      .every(isExpression)
  );
}

export function isDimension(expr) {
  return !!Dimension.parseMBQL(expr);
}

export function isMetric(expr) {
  return (
    Array.isArray(expr) &&
    expr[0] === "metric" &&
    expr.length === 2 &&
    typeof expr[1] === "number"
  );
}

export function isSegment(expr) {
  return (
    Array.isArray(expr) &&
    expr[0] === "segment" &&
    expr.length === 2 &&
    typeof expr[1] === "number"
  );
}

export function isCase(expr) {
  return Array.isArray(expr) && expr[0] === "case"; // && _.all(expr.slice(1), isValidArg)
}
