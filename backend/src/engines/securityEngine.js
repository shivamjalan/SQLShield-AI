const RISK_LEVELS = ["LOW", "MEDIUM", "HIGH", "CRITICAL"];
const MAX_TABLES_BEFORE_MEDIUM = 3;
const COMMENT_PATTERN = /--|\/\*/;

// Classic SQL injection tautology bypasses: "OR 1=1", "OR '1'='1'",
// "OR TRUE". Each alternative requires the two compared literals to
// actually be equal (via a backreference) rather than flagging any OR'd
// comparison, so "OR status = 'b'" doesn't false-positive.
const TAUTOLOGY_PATTERN = new RegExp(
  [
    "\\bOR\\s+(\\d+)\\s*=\\s*\\1\\b",
    "\\bOR\\s+'([^']*)'\\s*=\\s*'\\2'",
    '\\bOR\\s+"([^"]*)"\\s*=\\s*"\\3"',
    "\\bOR\\s+TRUE\\b",
  ].join("|"),
  "i"
);

// Statements this deterministic on/off list always treats as CRITICAL
// regardless of any WHERE clause -- they destroy data (TRUNCATE) or change
// database-level structure/permissions (ALTER, GRANT, REVOKE) outright.
// DROP has its own check below with its own reason text; DROP DATABASE
// isn't listed here because this parser dialect can't parse it at all, so
// it already lands on CRITICAL via the parseError branch.
const OTHER_CRITICAL_OPERATIONS = {
  TRUNCATE: "permanently removes all rows from a table",
  ALTER: "changes table/role structure or permissions",
  GRANT: "changes database-level permissions",
  REVOKE: "changes database-level permissions",
};

// Tables known to be large enough that a SELECT with no LIMIT is worth
// flagging. A static list (rather than a live pg_class.reltuples lookup
// like optimizer.js does) keeps this engine synchronous and DB-free like
// the rest of its checks -- the tradeoff is it needs updating by hand if a
// new large table is added.
const KNOWN_LARGE_TABLES = new Set(["orders"]);

// A subquery of any kind (IN(...), a derived FROM table, a scalar
// subquery...) adds one level to parser.js's subqueryDepth. A plain query
// with no subqueries is depth 1, so ">2" means "at least two levels of
// subquery nesting", not "any subquery at all".
const MAX_SUBQUERY_DEPTH_BEFORE_MEDIUM = 2;

function higherRisk(a, b) {
  return RISK_LEVELS.indexOf(a) >= RISK_LEVELS.indexOf(b) ? a : b;
}

// Fully deterministic — no AI/LLM calls. Returns { riskLevel, reasons: [] }.
function runSecurityChecks(parsedQuery) {
  if (parsedQuery.parseError) {
    return { riskLevel: "CRITICAL", reasons: ["unparseable query"] };
  }

  const {
    operation,
    tablesReferenced,
    hasWhereClause,
    hasLimitClause,
    subqueryDepth,
    columnsReferenced,
    statementCount,
    raw,
  } = parsedQuery;

  let riskLevel = "LOW";
  const reasons = [];

  if ((operation === "DELETE" || operation === "UPDATE") && !hasWhereClause) {
    riskLevel = higherRisk(riskLevel, "CRITICAL");
    reasons.push(`${operation} without WHERE clause affects all rows in the table`);
  }

  if (operation === "DROP") {
    riskLevel = higherRisk(riskLevel, "CRITICAL");
    reasons.push("DROP statement permanently removes a table");
  }

  if (OTHER_CRITICAL_OPERATIONS[operation]) {
    riskLevel = higherRisk(riskLevel, "CRITICAL");
    reasons.push(`${operation} statement ${OTHER_CRITICAL_OPERATIONS[operation]}`);
  }

  if (TAUTOLOGY_PATTERN.test(raw)) {
    riskLevel = higherRisk(riskLevel, "HIGH");
    reasons.push("WHERE clause contains a classic SQL injection tautology (e.g. OR 1=1)");
  }

  if (subqueryDepth > MAX_SUBQUERY_DEPTH_BEFORE_MEDIUM) {
    riskLevel = higherRisk(riskLevel, "MEDIUM");
    reasons.push(
      `Query nests subqueries ${subqueryDepth} levels deep (threshold: ${MAX_SUBQUERY_DEPTH_BEFORE_MEDIUM})`
    );
  }

  if (
    operation === "SELECT" &&
    !hasLimitClause &&
    tablesReferenced.some((table) => KNOWN_LARGE_TABLES.has(table))
  ) {
    riskLevel = higherRisk(riskLevel, "LOW");
    reasons.push("SELECT on a known-large table with no LIMIT clause");
  }

  if (tablesReferenced.length > MAX_TABLES_BEFORE_MEDIUM) {
    riskLevel = higherRisk(riskLevel, "MEDIUM");
    reasons.push(
      `Query touches ${tablesReferenced.length} tables (threshold: ${MAX_TABLES_BEFORE_MEDIUM})`
    );
  }

  if (operation === "SELECT" && columnsReferenced.includes("*")) {
    riskLevel = higherRisk(riskLevel, "LOW");
    reasons.push("SELECT * used instead of an explicit column list");
  }

  if (statementCount > 1) {
    riskLevel = higherRisk(riskLevel, "HIGH");
    reasons.push("Multiple stacked SQL statements detected (semicolon-separated)");
  }

  if (COMMENT_PATTERN.test(raw)) {
    riskLevel = higherRisk(riskLevel, "HIGH");
    reasons.push("Suspicious inline SQL comment detected");
  }

  return { riskLevel, reasons };
}

module.exports = { runSecurityChecks };
