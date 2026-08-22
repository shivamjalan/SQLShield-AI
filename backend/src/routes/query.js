const express = require("express");
const pool = require("../db/pool");
const { authenticate } = require("../auth/middleware");
const { rateLimit } = require("../config/redis");
const logger = require("../config/logger");
const { parseQuery } = require("../engines/parser");
const { makeDecision } = require("../engines/decisionEngine");
const { executeQuerySafely } = require("../engines/executor");

// Execution only ever runs for the narrowest possible case: an ALLOWed,
// not-pending-approval, read-only SELECT. Not INSERT/UPDATE/DELETE/DROP
// even when policy permits them for a role, not REWRITE (a suggestion the
// user hasn't actually asked to run), and not anything still awaiting
// approval even if its eventual decision would be ALLOW -- see the
// executor.js/query.js comments and the chat explanation this shipped
// with for why each of those boundaries exists.
function isEligibleForExecution(parsed, result) {
  return result.decision === "ALLOW" && !result.pendingApproval && parsed.operation === "SELECT";
}

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

  let execution = null;
  if (isEligibleForExecution(parsed, result)) {
    logger.info(
      { event: "query_execution_attempt", userId: req.user.id, operation: parsed.operation },
      "Executing ALLOWed SELECT against target_db"
    );
    execution = await executeQuerySafely(query);
    if (execution.error) {
      logger.error(
        { event: "query_execution_error", userId: req.user.id, err: execution.error },
        "Query execution failed"
      );
    }
  }

  try {
    await pool.query(
      `INSERT INTO audit_logs
         (user_id, raw_query, parsed_operation, target_table, risk_level, decision, pending_approval, reasons, ai_explanation, suggested_rewrite, execution_time_ms)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
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
        execution ? execution.executionTimeMs : null,
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
    execution: execution
      ? {
          rows: execution.rows,
          rowCount: execution.rowCount,
          truncated: execution.truncated,
          executionTimeMs: execution.executionTimeMs,
          error: execution.error,
        }
      : null,
  });
});

module.exports = router;
