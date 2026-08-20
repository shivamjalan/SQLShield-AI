const express = require("express");
const pool = require("../db/pool");
const { authenticate } = require("../auth/middleware");
const logger = require("../config/logger");

const router = express.Router();

const VALID_DECISIONS = ["ALLOW", "BLOCK", "REWRITE"];
const VALID_RISK_LEVELS = ["LOW", "MEDIUM", "HIGH", "CRITICAL"];
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
              a.ai_explanation, a.suggested_rewrite, a.execution_time_ms, a.created_at
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

module.exports = router;
