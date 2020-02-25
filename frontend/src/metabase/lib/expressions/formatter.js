import _ from "underscore";

import {
  MBQL_CLAUSES,
  OPERATOR_PRECEDENCE,
  isNumberLiteral,
  isStringLiteral,
  isOperator,
  isFunction,
  isDimension,
  isMetric,
  isSegment,
  isCase,
  formatMetricName,
  formatSegmentName,
  formatDimensionName,
  getExpressionName,
  formatStringLiteral,
  hasOptions,
} from "../expressions";

// convert a MBQL expression back into an expression string
export function format(mbql, info, parens = false) {
  if (mbql == null || _.isEqual(mbql, [])) {
    return "";
  } else if (isNumberLiteral(mbql)) {
    return formatNumberLiteral(mbql, info);
  } else if (isStringLiteral(mbql)) {
    return formatStringLiteral(mbql, info);
  } else if (isOperator(mbql)) {
    return formatOperator(mbql, info, parens);
  } else if (isFunction(mbql)) {
    return formatFunction(mbql, info);
  } else if (isDimension(mbql)) {
    return formatDimension(mbql, info);
  } else if (isMetric(mbql)) {
    return formatMetric(mbql, info);
  } else if (isSegment(mbql)) {
    return formatSegment(mbql, info);
  } else if (isCase(mbql)) {
    return formatCase(mbql, info);
  }
  throw new Error("Unknown MBQL clause " + JSON.stringify(mbql));
}

function formatNumberLiteral(mbql) {
  return JSON.stringify(mbql);
}

function formatDimension(fieldRef, { query }) {
  if (query) {
    const dimension = query.parseFieldReference(fieldRef);
    return formatDimensionName(dimension);
  } else {
    throw new Error("`query` is a required parameter to format expressions");
  }
}

function formatMetric([, metricId], { query }) {
  const metric = _.findWhere(query.table().metrics, { id: metricId });
  if (!metric) {
    throw "metric with ID does not exist: " + metricId;
  }
  return formatMetricName(metric);
}

function formatSegment([, segmentId], { query }) {
  const segment = _.findWhere(query.table().segments, { id: segmentId });
  if (!segment) {
    throw "segment with ID does not exist: " + segment;
  }
  return formatSegmentName(segment);
}

function formatFunction([fn, ...args], info) {
  if (hasOptions(args)) {
    // FIXME: how should we format args?
    args = args.slice(0, -1);
  }
  const formattedName = getExpressionName(fn);
  const formattedArgs = args.map(arg => format(arg, info));
  return args.length === 0
    ? formattedName
    : `${formattedName}(${formattedArgs.join(", ")})`;
}

function formatOperator([op, ...args], info, parens) {
  if (hasOptions(args)) {
    // FIXME: how should we format args?
    args = args.slice(0, -1);
  }
  const formattedOperator = getExpressionName(op) || op;
  const formattedArgs = args.map(arg => {
    const isLowerPrecedence =
      isOperator(arg) && OPERATOR_PRECEDENCE[op] > OPERATOR_PRECEDENCE[arg[0]];
    return format(arg, info, isLowerPrecedence);
  });
  const clause = MBQL_CLAUSES[op];
  const formatted =
    clause && clause.args.length === 1
      ? // unary operator
        `${formattedOperator} ${formattedArgs[0]}`
      : formattedArgs.join(` ${formattedOperator} `);
  return parens ? `(${formatted})` : formatted;
}

function formatCase([_, clauses, options = {}], info) {
  const formattedName = getExpressionName("case");
  const formattedClauses = clauses
    .map(([filter, mbql]) => format(filter, info) + ", " + format(mbql, info))
    .join(", ");
  const defaultExpression =
    options.default !== undefined ? ", " + format(options.default, info) : "";
  return `${formattedName}(${formattedClauses}${defaultExpression})`;
}
