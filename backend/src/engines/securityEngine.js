const RISK_LEVELS = ["LOW", "MEDIUM", "HIGH", "CRITICAL"];
const MAX_TABLES_BEFORE_MEDIUM = 3;
const COMMENT_PATTERN = /--|\/\*/;

function higherRisk(a, b) {
  return RISK_LEVELS.indexOf(a) >= RISK_LEVELS.indexOf(b) ? a : b;
}

// Fully deterministic — no AI/LLM calls. Returns { riskLevel, reasons: [] }.
function runSecurityChecks(parsedQuery) {
  if (parsedQuery.parseError) {
    return { riskLevel: "CRITICAL", reasons: ["unparseable query"] };
  }

  const { operation, tablesReferenced, hasWhereClause, columnsReferenced, statementCount, raw } =
    parsedQuery;

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
