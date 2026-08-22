const express = require("express");
const pool = require("../db/pool");
const { authenticate, requireRole } = require("../auth/middleware");
const logger = require("../config/logger");

const router = express.Router();

const VALID_ROLES = ["intern", "developer", "admin"];

// Admin-only user directory -- the frontend User Management page needs
// this to know who exists before it can offer to change anyone's role.
router.get("/users", authenticate, requireRole("admin"), async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT id, email, role, created_at FROM users ORDER BY created_at DESC`
    );
    res.json({ users: result.rows });
  } catch (err) {
    logger.error({ event: "users_list_failed", err: err.message }, "Failed to list users");
    res.status(500).json({ error: "Internal server error" });
  }
});

// The only place a user's role can change after registration. Every call
// is written to role_change_logs -- who did it, whose role changed, and
// old -> new -- so this power is fully auditable.
router.patch("/users/:id/role", authenticate, requireRole("admin"), async (req, res) => {
  const { role } = req.body;

  if (!VALID_ROLES.includes(role)) {
    return res.status(400).json({ error: `role must be one of ${VALID_ROLES.join(", ")}` });
  }

  try {
    const existing = await pool.query(`SELECT id, role FROM users WHERE id = $1`, [req.params.id]);
    const user = existing.rows[0];
    if (!user) {
      return res.status(404).json({ error: "User not found" });
    }

    const oldRole = user.role;

    const updated = await pool.query(
      `UPDATE users SET role = $1 WHERE id = $2 RETURNING id, email, role, created_at`,
      [role, req.params.id]
    );

    await pool.query(
      `INSERT INTO role_change_logs (admin_id, target_user_id, old_role, new_role)
       VALUES ($1, $2, $3, $4)`,
      [req.user.id, req.params.id, oldRole, role]
    );

    logger.info(
      { event: "role_changed", adminId: req.user.id, targetUserId: req.params.id, oldRole, newRole: role },
      "User role changed"
    );

    res.json({ user: updated.rows[0] });
  } catch (err) {
    logger.error({ event: "role_change_failed", err: err.message }, "Failed to change user role");
    res.status(500).json({ error: "Internal server error" });
  }
});

module.exports = router;
