const express = require("express");
const pool = require("../db/pool");
const { authenticate, requireRole } = require("../auth/middleware");
const logger = require("../config/logger");
const { parseQuery } = require("../engines/parser");
const { runSecurityChecks } = require("../engines/securityEngine");
const { checkPolicy } = require("../engines/policyEngine");
const { executeQuerySafely } = require("../engines/executor");

const router = express.Router();

const VALID_DECISIONS = ["ALLOW", "BLOCK", "REWRITE"];
const VALID_RISK_LEVELS = ["LOW", "MEDIUM", "HIGH", "CRITICAL"];
const VALID_REVIEW_DECISIONS = ["approved", "rejected"];
const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200;

router.get("/audit-logs", authenticate, async (req, res) => {
  const { decision, risk_level: riskLevel, user_id: userId } = req.query;

  if (decision && !VALID_DECISIONS.includes(decision)) {
    return res.status(400).json({ error: `decision must be one of ${VALID_DECISIONS.join(", ")}` });
  }
  if (riskLevel && !VALID_RISK_LEVELS.includes(riskLevel)) {
    return res.status(400).json({ error: `risk_level must be one of ${VALID_RISK_LEVELS.join(", ")}` });
  }

  const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || DEFAULT_LIMIT, 1), MAX_LIMIT);
  const offset = Math.max(parseInt(req.query.offset, 10) || 0, 0);

  const conditions = [];
  const params = [];

  if (decision) {
    params.push(decision);
    conditions.push(`a.decision = $${params.length}`);
  }
  if (riskLevel) {
    params.push(riskLevel);
    conditions.push(`a.risk_level = $${params.length}`);
  }
  if (userId) {
    params.push(userId);
    conditions.push(`a.user_id = $${params.length}`);
  }

  const whereClause = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";

  try {
    const countResult = await pool.query(`SELECT COUNT(*) FROM audit_logs a ${whereClause}`, params);

    const logsParams = [...params, limit, offset];
    const logsResult = await pool.query(
      `SELECT a.id, a.user_id, u.email AS user_email, a.raw_query, a.parsed_operation,
              a.target_table, a.risk_level, a.decision, a.pending_approval, a.reasons,
              a.ai_explanation, a.suggested_rewrite, a.execution_time_ms,
              a.approval_status, a.reviewed_by, a.reviewed_at, a.created_at
       FROM audit_logs a
       LEFT JOIN users u ON u.id = a.user_id
       ${whereClause}
       ORDER BY a.created_at DESC
       LIMIT $${logsParams.length - 1} OFFSET $${logsParams.length}`,
      logsParams
    );

    res.json({
      logs: logsResult.rows,
      total: parseInt(countResult.rows[0].count, 10),
      limit,
      offset,
    });
  } catch (err) {
    logger.error({ event: "audit_logs_list_failed", err: err.message }, "Failed to list audit logs");
    res.status(500).json({ error: "Internal server error" });
  }
});

router.get("/audit-logs/stats", authenticate, async (req, res) => {
  try {
    const [totalResult, decisionResult, riskResult, pendingResult] = await Promise.all([
      pool.query(`SELECT COUNT(*) FROM audit_logs`),
      pool.query(`SELECT decision, COUNT(*) FROM audit_logs GROUP BY decision`),
      pool.query(`SELECT risk_level, COUNT(*) FROM audit_logs GROUP BY risk_level`),
      pool.query(`SELECT COUNT(*) FROM audit_logs WHERE pending_approval = true`),
    ]);

    // Every decision/risk-level key is always present (defaulted to 0) so the
    // frontend chart/cards don't have to special-case missing keys.
    const byDecision = Object.fromEntries(VALID_DECISIONS.map((d) => [d, 0]));
    for (const row of decisionResult.rows) {
      byDecision[row.decision] = parseInt(row.count, 10);
    }

    const byRiskLevel = Object.fromEntries(VALID_RISK_LEVELS.map((r) => [r, 0]));
    for (const row of riskResult.rows) {
      byRiskLevel[row.risk_level] = parseInt(row.count, 10);
    }

    res.json({
      total: parseInt(totalResult.rows[0].count, 10),
      byDecision,
      byRiskLevel,
      pendingApproval: parseInt(pendingResult.rows[0].count, 10),
    });
  } catch (err) {
    logger.error({ event: "audit_stats_failed", err: err.message }, "Failed to compute audit log stats");
    res.status(500).json({ error: "Internal server error" });
  }
});

// Admin-only queue of decisions still awaiting review: the policy engine
// set pending_approval=true at submission time and nobody has acted on it
// yet (approval_status is still NULL). Once reviewed, a row drops out of
// this list on its own — approval_status is no longer NULL — without
// needing a separate "resolved" flag.
router.get("/audit-logs/pending", authenticate, requireRole("admin"), async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT a.id, a.user_id, u.email AS user_email, a.raw_query, a.parsed_operation,
              a.target_table, a.risk_level, a.decision, a.reasons, a.created_at
       FROM audit_logs a
       LEFT JOIN users u ON u.id = a.user_id
       WHERE a.pending_approval = true AND a.approval_status IS NULL
       ORDER BY a.created_at DESC`
    );
    res.json({ logs: result.rows });
  } catch (err) {
    logger.error({ event: "pending_approvals_list_failed", err: err.message }, "Failed to list pending approvals");
    res.status(500).json({ error: "Internal server error" });
  }
});

// Records an admin's approve/reject decision on one pending audit log row.
// Deliberately does NOT execute the underlying query -- that's a separate
// concern from recording the review itself. A row can only be reviewed
// once: it must currently be pending_approval=true AND approval_status
// still NULL, so neither a never-pending row nor an already-reviewed one
// can be reviewed (again).
router.patch("/audit-logs/:id/review", authenticate, requireRole("admin"), async (req, res) => {
  const { decision } = req.body;

  if (!VALID_REVIEW_DECISIONS.includes(decision)) {
    return res.status(400).json({ error: `decision must be one of ${VALID_REVIEW_DECISIONS.join(", ")}` });
  }

  try {
    const existing = await pool.query(
      `SELECT id, pending_approval, approval_status FROM audit_logs WHERE id = $1`,
      [req.params.id]
    );
    const log = existing.rows[0];
    if (!log) {
      return res.status(404).json({ error: "Audit log entry not found" });
    }
    if (!log.pending_approval || log.approval_status !== null) {
      return res.status(400).json({ error: "This audit log entry is not awaiting approval" });
    }

    const updated = await pool.query(
      `UPDATE audit_logs
       SET approval_status = $1, reviewed_by = $2, reviewed_at = now()
       WHERE id = $3
       RETURNING id, raw_query, decision, pending_approval, approval_status, reviewed_by, reviewed_at`,
      [decision, req.user.id, req.params.id]
    );

    logger.info(
      { event: "approval_reviewed", adminId: req.user.id, auditLogId: req.params.id, decision },
      "Pending query approval reviewed"
    );

    res.json({ log: updated.rows[0] });
  } catch (err) {
    logger.error({ event: "approval_review_failed", err: err.message }, "Failed to review pending approval");
    res.status(500).json({ error: "Internal server error" });
  }
});

// Runs a previously-approved query for real, admin-only. Deliberately not
// auto-triggered by the approval itself (PATCH /:id/review above) --
// approving and executing are separate actions with separate audit
// trails. The stored decision is never trusted here: the original query
// text is re-parsed and re-checked using the ORIGINAL SUBMITTER's CURRENT
// role (not the reviewing admin's, which would make this check meaningless
// since admins can do almost everything) so a policy change since
// submission is caught rather than silently ignored.
//
// This deliberately calls runSecurityChecks + checkPolicy directly rather
// than the full decisionEngine.makeDecision. makeDecision's pendingApproval
// signal means "does this need human approval" in the abstract, which is
// permanently true for any query matching a requires_approval policy --
// re-asserting that here would mean NO query could ever pass this check
// after being approved once, since the very policy that required approval
// keeps requiring it forever. The human sign-off already happened
// (approval_status checked above); what matters now is only whether the
// query is still fundamentally safe (not newly CRITICAL) and still
// permitted at all for this role (not newly denied) -- not whether it
// would, in the abstract, need approval again.
router.post("/audit-logs/:id/execute", authenticate, requireRole("admin"), async (req, res) => {
  try {
    const existing = await pool.query(
      `SELECT id, user_id, raw_query, approval_status FROM audit_logs WHERE id = $1`,
      [req.params.id]
    );
    const log = existing.rows[0];
    if (!log) {
      return res.status(404).json({ error: "Audit log entry not found" });
    }
    if (log.approval_status !== "approved") {
      return res.status(400).json({ error: "This audit log entry has not been approved" });
    }

    const submitter = await pool.query(`SELECT role FROM users WHERE id = $1`, [log.user_id]);
    if (submitter.rows.length === 0) {
      return res.status(400).json({ error: "The original submitter's account no longer exists" });
    }

    const parsed = parseQuery(log.raw_query);
    if (parsed.operation !== "SELECT") {
      return res.status(400).json({
        error: "Only SELECT queries can be executed through this endpoint",
        operation: parsed.operation,
      });
    }

    const security = runSecurityChecks(parsed);
    if (security.riskLevel === "CRITICAL") {
      return res.status(400).json({
        error: "Query is no longer eligible for execution: now flagged CRITICAL by the security engine",
        reasons: security.reasons,
      });
    }

    const policy = await checkPolicy(submitter.rows[0].role, parsed);
    if (!policy.allowed) {
      return res.status(400).json({
        error: "Query is no longer permitted for the submitter's current role under current policy",
        reasons: policy.reasons,
      });
    }

    logger.info(
      { event: "query_execution_attempt", auditLogId: log.id, adminId: req.user.id },
      "Executing previously-approved query against target_db"
    );

    const execution = await executeQuerySafely(log.raw_query);

    if (execution.error) {
      logger.error(
        { event: "query_execution_error", auditLogId: log.id, err: execution.error },
        "Approved query execution failed"
      );
    } else {
      await pool.query(`UPDATE audit_logs SET execution_time_ms = $1 WHERE id = $2`, [
        execution.executionTimeMs,
        log.id,
      ]);
    }

    res.json({
      rows: execution.rows,
      rowCount: execution.rowCount,
      truncated: execution.truncated,
      executionTimeMs: execution.executionTimeMs,
      error: execution.error,
    });
  } catch (err) {
    logger.error({ event: "approved_query_execution_failed", err: err.message }, "Failed to execute approved query");
    res.status(500).json({ error: "Internal server error" });
  }
});

module.exports = router;
