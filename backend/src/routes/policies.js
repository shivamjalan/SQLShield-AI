const express = require("express");
const pool = require("../db/pool");
const { authenticate, requireRole } = require("../auth/middleware");
const logger = require("../config/logger");

const router = express.Router();

const VALID_OPERATIONS = ["SELECT", "INSERT", "UPDATE", "DELETE", "DROP"];

router.get("/policies", authenticate, requireRole("admin"), async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT id, role, table_name, operation, allowed, requires_approval, created_at
       FROM policies
       ORDER BY role, table_name, operation`
    );
    res.json({ policies: result.rows });
  } catch (err) {
    logger.error({ event: "policies_list_failed", err: err.message }, "Failed to list policies");
    res.status(500).json({ error: "Internal server error" });
  }
});

router.post("/policies", authenticate, requireRole("admin"), async (req, res) => {
  const { role, table_name, operation, allowed, requires_approval = false } = req.body;

  if (!role || !table_name || !operation || typeof allowed !== "boolean") {
    return res.status(400).json({
      error: "role, table_name, operation, and allowed (boolean) are required",
    });
  }
  if (!VALID_OPERATIONS.includes(operation)) {
    return res.status(400).json({ error: `operation must be one of ${VALID_OPERATIONS.join(", ")}` });
  }

  try {
    // Upsert: re-submitting the same (role, table_name, operation) edits
    // the existing rule instead of erroring, since policies are meant to
    // be editable via this API.
    const result = await pool.query(
      `INSERT INTO policies (role, table_name, operation, allowed, requires_approval)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (role, table_name, operation)
       DO UPDATE SET allowed = EXCLUDED.allowed, requires_approval = EXCLUDED.requires_approval
       RETURNING id, role, table_name, operation, allowed, requires_approval, created_at`,
      [role, table_name, operation, allowed, requires_approval]
    );
    res.status(201).json({ policy: result.rows[0] });
  } catch (err) {
    logger.error({ event: "policy_upsert_failed", err: err.message }, "Failed to create policy");
    res.status(500).json({ error: "Internal server error" });
  }
});

router.delete("/policies/:id", authenticate, requireRole("admin"), async (req, res) => {
  try {
    const result = await pool.query(`DELETE FROM policies WHERE id = $1 RETURNING id`, [
      req.params.id,
    ]);
    if (result.rows.length === 0) {
      return res.status(404).json({ error: "Policy not found" });
    }
    res.status(204).send();
  } catch (err) {
    logger.error({ event: "policy_delete_failed", err: err.message }, "Failed to delete policy");
    res.status(500).json({ error: "Internal server error" });
  }
});

module.exports = router;
