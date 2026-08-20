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

// Returns { operation, tablesReferenced, hasWhereClause, columnsReferenced,
// raw, statementCount, parseError }. On invalid/unsupported SQL (including
// syntax this parser dialect doesn't support, e.g. DROP DATABASE), returns
// operation "UNKNOWN" with parseError set instead of throwing — callers
// (securityEngine) treat that as CRITICAL "unparseable query".
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
      columnsReferenced: [],
      statementCount: 0,
      parseError: err.message,
    };
  }
}

module.exports = { parseQuery };
