const express = require("express");
const pool = require("../db/pool");
const { authenticate } = require("../auth/middleware");
const { rateLimit } = require("../config/redis");
const logger = require("../config/logger");
const { parseQuery } = require("../engines/parser");
const { makeDecision } = require("../engines/decisionEngine");

const router = express.Router();

router.post("/query", authenticate, rateLimit, async (req, res) => {
  const { query } = req.body;

  if (!query || typeof query !== "string") {
    return res.status(400).json({ error: "query is required" });
  }

  logger.info({ event: "query_received", userId: req.user.id, role: req.user.role }, "Query received");

  const parsed = parseQuery(query);
  const result = await makeDecision(parsed, req.user.role);

  logger.info(
    {
      event: "decision_made",
      userId: req.user.id,
      operation: parsed.operation,
      riskLevel: result.riskLevel,
      decision: result.decision,
      pendingApproval: result.pendingApproval,
    },
    "Decision made"
  );

  try {
    await pool.query(
      `INSERT INTO query_history (user_id, query_text) VALUES ($1, $2)`,
      [req.user.id, query]
    );
  } catch (err) {
    logger.error({ event: "query_history_write_failed", err: err.message }, "Failed to save query history");
  }

  try {
    await pool.query(
      `INSERT INTO audit_logs
         (user_id, raw_query, parsed_operation, target_table, risk_level, decision, pending_approval, reasons, ai_explanation, suggested_rewrite)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
      [
        req.user.id,
        query,
        parsed.operation,
        parsed.tablesReferenced.join(", ") || null,
        result.riskLevel,
        result.decision,
        result.pendingApproval,
        JSON.stringify(result.reasons),
        result.aiExplanation,
        result.suggestedRewrite,
      ]
    );
  } catch (err) {
    logger.error({ event: "audit_log_write_failed", err: err.message }, "Failed to write audit log");
  }

  res.json({
    query,
    parsed: {
      operation: parsed.operation,
      tablesReferenced: parsed.tablesReferenced,
      hasWhereClause: parsed.hasWhereClause,
      columnsReferenced: parsed.columnsReferenced,
    },
    riskLevel: result.riskLevel,
    reasons: result.reasons,
    decision: {
      decision: result.decision,
      riskScore: result.riskLevel,
      reasons: result.reasons,
      pendingApproval: result.pendingApproval,
      aiExplanation: result.aiExplanation,
      suggestedRewrite: result.suggestedRewrite,
      rewrittenQuery: result.rewrittenQuery,
    },
  });
});

module.exports = router;
