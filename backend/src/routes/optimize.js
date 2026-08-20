const express = require("express");
const { authenticate } = require("../auth/middleware");
const { parseQuery } = require("../engines/parser");
const { runSecurityChecks } = require("../engines/securityEngine");
const { checkPolicy } = require("../engines/policyEngine");
const { runExplainAnalyze, suggestIndexes, benchmarkBeforeAfter } = require("../engines/optimizer");

const router = express.Router();

// Separate from POST /api/query on purpose: optimizing a query means
// running EXPLAIN ANALYZE (executes the query for real) and then applying a
// candidate index inside a transaction before rolling it back -- both slow
// compared to a plain security/policy check, and neither belongs on the hot
// path every ALLOWED query takes. This is an opt-in analysis a user runs
// from the Performance Analytics page, not something that fires on every
// query submission.
router.post("/optimize", authenticate, async (req, res) => {
  const { query } = req.body;

  if (!query || typeof query !== "string") {
    return res.status(400).json({ error: "query is required" });
  }

  const parsed = parseQuery(query);

  if (parsed.operation !== "SELECT") {
    return res.status(400).json({
      error: "Only SELECT queries can be optimized -- EXPLAIN ANALYZE executes the query as given.",
    });
  }

  const security = runSecurityChecks(parsed);
  if (security.riskLevel === "CRITICAL") {
    return res.status(403).json({ error: "Query blocked by security engine", reasons: security.reasons });
  }

  const policy = await checkPolicy(req.user.role, parsed);
  if (!policy.allowed) {
    return res.status(403).json({ error: "Query blocked by policy engine", reasons: policy.reasons });
  }

  try {
    const plan = await runExplainAnalyze(query);
    const suggestions = await suggestIndexes(plan);
    const indexStatements = suggestions.map((s) => s.sql);
    const benchmark = await benchmarkBeforeAfter(query, indexStatements);

    res.json({
      query,
      plan,
      suggestions,
      benchmark,
    });
  } catch (err) {
    res.status(400).json({ error: `Failed to analyze query against target_db: ${err.message}` });
  }
});

module.exports = router;
