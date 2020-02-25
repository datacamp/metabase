import { CstParser } from "chevrotain";

import _ from "underscore";

import {
  lexer,
  allTokens,
  LParen,
  RParen,
  Operator,
  AdditiveOperator,
  MultiplicativeOperator,
  Case,
  FilterOperator,
  BooleanOperator,
  Not,
  StringLiteral,
  NumberLiteral,
  Minus,
  Identifier,
  IdentifierString,
  Comma,
  FUNCTION_TOKENS,
  FunctionName,
} from "./lexer";

const RETURN_TYPES = ["expression", "aggregation", "boolean", "undefined"];

export class ExpressionParser extends CstParser {
  constructor(config = {}) {
    super(allTokens, {
      // reduced for performance reasons
      maxLookahead: 3,
      ...config,
    });

    const $ = this;

    // START RULES:

    $.RULE("any", returnType => {
      $.OR([
        {
          GATE: () => !returnType || returnType === "expression",
          ALT: () => {
            $.SUBRULE($.expression, { LABEL: "expression" });
          },
        },
        {
          GATE: () => !returnType || returnType === "aggregation",
          ALT: () => {
            $.SUBRULE($.aggregation, { LABEL: "expression" });
          },
        },
        {
          GATE: () => !returnType || returnType === "boolean",
          ALT: () => {
            $.SUBRULE($.filter, { LABEL: "expression" });
          },
        },
      ]);
    });

    // an expression without aggregations in it
    $.RULE("expression", (returnType = "expression") => {
      $.SUBRULE($.additionExpression, { ARGS: [returnType] });
    });

    // an expression with aggregations in it
    $.RULE("aggregation", () => {
      $.SUBRULE($.additionExpression, { ARGS: ["aggregation"] });
    });

    // a filter expression
    $.RULE("filter", () => {
      $.SUBRULE($.booleanExpression);
    });

    // EXPRESSIONS:

    // Lowest precedence thus it is first in the rule chain
    // The precedence of binary expressions is determined by
    // how far down the Parse Tree the binary expression appears.
    $.RULE("additionExpression", returnType => {
      $.AT_LEAST_ONE_SEP({
        SEP: AdditiveOperator,
        DEF: () =>
          $.SUBRULE($.multiplicationExpression, {
            ARGS: [returnType],
            LABEL: "operands",
          }),
      });
    });

    $.RULE("multiplicationExpression", returnType => {
      $.AT_LEAST_ONE_SEP({
        SEP: MultiplicativeOperator,
        DEF: () =>
          $.SUBRULE($.atomicExpression, {
            ARGS: [returnType],
            LABEL: "operands",
          }),
      });
    });

    $.RULE("booleanExpression", () => {
      $.AT_LEAST_ONE_SEP({
        SEP: BooleanOperator,
        DEF: () =>
          $.SUBRULE($.atomicExpression, {
            ARGS: ["boolean"],
            LABEL: "operands",
          }),
      });
    });

    $.RULE("unaryOperatorExpression", () => {
      $.CONSUME(Not, { LABEL: "operators" });
      $.SUBRULE($.atomicExpression, { LABEL: "operands", ARGS: ["boolean"] });
    });

    $.RULE("binaryOperatorExpression", () => {
      $.SUBRULE($.dimensionExpression, {
        LABEL: "operands",
      });
      $.CONSUME(FilterOperator, { LABEL: "operators" });
      $.SUBRULE($.expression, {
        LABEL: "operands",
      });
    });

    $.RULE("functionExpression", returnType => {
      $.OR([
        {
          GATE: () => {
            const fn = FUNCTION_TOKENS.get(this.LA(1).tokenType);
            return !fn || fn.type === returnType;
          },
          ALT: () => {
            $.CONSUME(FunctionName, { LABEL: "functionName" });
          },
        },
      ]);
      $.OR1([
        {
          GATE: () => {
            const fn = FUNCTION_TOKENS.get(this.LA(0).tokenType);
            return !fn || fn.args.length > 0;
          },
          ALT: () => {
            // TODO: this validates the argument types but not the number of arguments?
            const fn = FUNCTION_TOKENS.get(this.LA(0).tokenType);
            $.CONSUME(LParen);
            let i = 0;
            $.AT_LEAST_ONE_SEP({
              SEP: Comma,
              DEF: () => {
                $.SUBRULE($.any, {
                  LABEL: "arguments",
                  ARGS: fn && [fn.args[i++]],
                });
              },
            });
            $.CONSUME(RParen);
          },
        },
        {
          GATE: () => {
            const fn = FUNCTION_TOKENS.get(this.LA(0).tokenType);
            return !fn || fn.args.length === 0;
          },
          ALT: () => {
            $.OPTION(() => {
              $.CONSUME1(LParen);
              $.CONSUME1(RParen);
            });
          },
        },
      ]);
    });

    $.RULE("caseExpression", returnType => {
      $.CONSUME(Case);
      $.CONSUME(LParen);
      $.SUBRULE($.filter);
      $.CONSUME(Comma);
      $.SUBRULE($.expression);
      $.MANY(() => {
        $.CONSUME2(Comma);
        $.SUBRULE2($.filter);
        $.CONSUME3(Comma);
        $.SUBRULE3($.expression, { ARGS: [returnType] });
      });
      $.OPTION(() => {
        $.CONSUME4(Comma);
        $.SUBRULE4($.expression, { LABEL: "default", ARGS: [returnType] });
      });
      $.CONSUME(RParen);
    });

    $.RULE("metricExpression", () => {
      $.OR([
        { ALT: () => $.SUBRULE($.identifierString, { LABEL: "metricName" }) },
        { ALT: () => $.SUBRULE($.identifier, { LABEL: "metricName" }) },
      ]);
    });

    $.RULE("segmentExpression", () => {
      $.OR([
        { ALT: () => $.SUBRULE($.identifierString, { LABEL: "segmentName" }) },
        { ALT: () => $.SUBRULE($.identifier, { LABEL: "segmentName" }) },
      ]);
    });

    $.RULE("dimensionExpression", () => {
      $.OR([
        {
          ALT: () => $.SUBRULE($.identifierString, { LABEL: "dimensionName" }),
        },
        { ALT: () => $.SUBRULE($.identifier, { LABEL: "dimensionName" }) },
      ]);
    });

    $.RULE("identifier", () => {
      $.CONSUME(Identifier);
    });

    $.RULE("identifierString", () => {
      $.CONSUME(IdentifierString);
    });

    $.RULE("stringLiteral", () => {
      $.CONSUME(StringLiteral);
    });

    $.RULE("numberLiteral", () => {
      $.OPTION(() => $.CONSUME(Minus));
      $.CONSUME(NumberLiteral);
    });

    // to avoid V8 hidden class changes by dynamic definition of properties on "this"
    for (const returnType of RETURN_TYPES) {
      $[`atomicExpression-${returnType}`] = undefined;
    }

    $.RULE("atomicExpression", returnType => {
      $.OR(
        // optimization: https://sap.github.io/chevrotain/docs/guide/performance.html#caching-arrays-of-alternatives
        $[`atomicExpression-${returnType}`] ||
          ($[`atomicExpression-${returnType}`] = {
            DEF: [
              // functions: used by aggregations, expressions, and filters
              {
                ALT: () =>
                  $.SUBRULE($.functionExpression, {
                    ARGS: [returnType],
                    LABEL: "expression",
                  }),
              },
              // aggregations
              {
                GATE: () => returnType === "aggregation",
                ALT: () =>
                  $.SUBRULE($.metricExpression, {
                    LABEL: "expression",
                  }),
              },
              // filters
              {
                GATE: () => returnType === "boolean",
                ALT: () =>
                  $.SUBRULE($.binaryOperatorExpression, {
                    LABEL: "expression",
                  }),
              },
              {
                GATE: () => returnType === "boolean",
                ALT: () =>
                  $.SUBRULE($.unaryOperatorExpression, {
                    LABEL: "expression",
                  }),
              },
              {
                GATE: () => returnType === "boolean",
                ALT: () =>
                  $.SUBRULE($.segmentExpression, {
                    LABEL: "expression",
                  }),
              },
              // expressions
              {
                GATE: () => returnType === "expression",
                ALT: () =>
                  $.SUBRULE($.caseExpression, {
                    LABEL: "expression",
                    ARGS: [returnType],
                  }),
              },
              {
                GATE: () => returnType === "expression",
                ALT: () =>
                  $.SUBRULE($.dimensionExpression, {
                    LABEL: "expression",
                  }),
              },
              // number and string literals
              {
                GATE: () => returnType === "expression",
                ALT: () =>
                  $.SUBRULE($.stringLiteral, {
                    LABEL: "expression",
                  }),
              },
              {
                GATE: () =>
                  returnType === "expression" || returnType === "aggregation",
                ALT: () =>
                  $.SUBRULE($.numberLiteral, {
                    LABEL: "expression",
                  }),
              },
              // grouping
              {
                ALT: () =>
                  $.SUBRULE($.parenthesisExpression, {
                    ARGS: [returnType],
                    LABEL: "expression",
                  }),
              },
            ],
            ERR_MSG: returnType,
          }),
      );
    });

    $.RULE("parenthesisExpression", returnType => {
      $.CONSUME(LParen);
      $.SUBRULE($.any, { LABEL: "expression", ARGS: [returnType] });
      $.CONSUME(RParen);
    });

    // FILTERS

    this.performSelfAnalysis();
  }

  canTokenTypeBeInsertedInRecovery(tokType) {
    // console.log("canTokenTypeBeInsertedInRecovery", tokType);
    switch (tokType) {
      case RParen:
      case LParen:
        return true;
      default:
        return false;
    }
  }

  getTokenToInsert(tokType) {
    // console.log("getTokenToInsert", tokType);
    switch (tokType) {
      case RParen:
        return { image: ")" };
      case LParen:
        return { image: "(" };
    }
  }
}

export const parser = new ExpressionParser();
export const parserWithRecovery = new ExpressionParser({
  recoveryEnabled: true,
});

export const ExpressionCstVisitor = parser.getBaseCstVisitorConstructor();

export function parse(
  source,
  { startRule = "expression", recover = false } = {},
) {
  // Lex
  const { tokens, errors } = lexer.tokenize(source);
  if (errors.length > 0) {
    throw errors;
  }

  // Parse
  const p = recover ? parserWithRecovery : parser;
  p.input = tokens;
  const cst = p[startRule]();

  if (p.errors.length > 0) {
    for (const error of p.errors) {
      // clean up error messages
      error.message =
        error.message &&
        error.message
          .replace(/^Expecting:?\s+/, "Expected ")
          .replace(/--> (.*?) <--/g, "$1")
          .replace(/(\n|\s)*but found:?/, " but found ")
          .replace(/\s*but found\s+''$/, "");
    }
    throw p.errors;
  }

  return cst;
}
