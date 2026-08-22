const { Parser } = require("node-sql-parser");

const parser = new Parser();
const PARSE_OPTS = { database: "postgresql" };

function lastSegment(qualifiedName) {
  const parts = qualifiedName.split("::");
  const value = parts[parts.length - 1];
  return value === "(.*)" ? "*" : value;
}

function dedupe(list) {
  return Array.from(new Set(list));
}

// node-sql-parser always gives a statement a `.limit` object of the shape
// { seperator, value }; `value` is an empty array when no LIMIT clause was
// written, populated when one was.
function hasLimit(node) {
  return Boolean(node && node.limit && node.limit.value && node.limit.value.length > 0);
}

// Subqueries (in an IN(...), a derived FROM table, a scalar subquery in the
// SELECT list, etc.) all show up somewhere in the AST as a nested object
// with `type: "select"` -- the parser doesn't tag *where* it found them, so
// rather than special-case every position they can appear in, this just
// walks the whole AST and tracks how many "select" nodes are nested inside
// one another along any path. A plain, non-nested SELECT has depth 1; each
// level of subquery adds 1.
function maxSelectDepth(node, currentDepth = 0) {
  if (node === null || typeof node !== "object") {
    return currentDepth;
  }

  const isSelectNode = !Array.isArray(node) && node.type === "select";
  const nextDepth = isSelectNode ? currentDepth + 1 : currentDepth;

  let deepest = nextDepth;
  const children = Array.isArray(node) ? node : Object.values(node);
  for (const child of children) {
    const childDepth = maxSelectDepth(child, nextDepth);
    if (childDepth > deepest) {
      deepest = childDepth;
    }
  }
  return deepest;
}

// Returns { operation, tablesReferenced, hasWhereClause, hasLimitClause,
// subqueryDepth, columnsReferenced, raw, statementCount, parseError }. On
// invalid/unsupported SQL (including syntax this parser dialect doesn't
// support, e.g. DROP DATABASE), returns operation "UNKNOWN" with parseError
// set instead of throwing — callers (securityEngine) treat that as
// CRITICAL "unparseable query".
function parseQuery(sql) {
  try {
    const ast = parser.astify(sql, PARSE_OPTS);
    const statements = Array.isArray(ast) ? ast : [ast];

    if (statements.length === 0) {
      throw new Error("Empty query");
    }

    const primary = statements[0];

    return {
      raw: sql,
      operation: (primary.type || "unknown").toUpperCase(),
      tablesReferenced: dedupe(parser.tableList(sql, PARSE_OPTS).map(lastSegment)),
      hasWhereClause: Boolean(primary.where),
      hasLimitClause: hasLimit(primary),
      subqueryDepth: maxSelectDepth(primary),
      columnsReferenced: dedupe(parser.columnList(sql, PARSE_OPTS).map(lastSegment)),
      statementCount: statements.length,
      parseError: null,
    };
  } catch (err) {
    return {
      raw: sql,
      operation: "UNKNOWN",
      tablesReferenced: [],
      hasWhereClause: false,
      hasLimitClause: false,
      subqueryDepth: 0,
      columnsReferenced: [],
      statementCount: 0,
      parseError: err.message,
    };
  }
}

module.exports = { parseQuery };
