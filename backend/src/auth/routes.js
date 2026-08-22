const express = require("express");
const bcrypt = require("bcrypt");
const pool = require("../db/pool");
const { signAccessToken, signRefreshToken, verifyRefreshToken } = require("./jwt");
const logger = require("../config/logger");

const router = express.Router();

const SALT_ROUNDS = 10;

// role is intentionally NOT read from the request body -- self-service
// registration always creates an 'intern', full stop. If it were
// client-controlled, anyone could register as 'admin' and the entire
// policy/RBAC system would be decorative. The only ways a user ever gets a
// higher role are: an existing admin promoting them via
// PATCH /api/users/:id/role (src/routes/users.js), or the one-time
// scripts/seedAdmin.js run directly against the database for the very
// first admin account.
router.post("/register", async (req, res) => {
  const { email, password } = req.body;

  if (!email || !password) {
    return res.status(400).json({ error: "email and password are required" });
  }

  try {
    const passwordHash = await bcrypt.hash(password, SALT_ROUNDS);
    const result = await pool.query(
      `INSERT INTO users (email, password_hash, role)
       VALUES ($1, $2, 'intern')
       RETURNING id, email, role, created_at`,
      [email, passwordHash]
    );
    res.status(201).json({ user: result.rows[0] });
  } catch (err) {
    if (err.code === "23505") {
      return res.status(409).json({ error: "Email already registered" });
    }
    logger.error({ event: "register_failed", err: err.message }, "Register error");
    res.status(500).json({ error: "Internal server error" });
  }
});

router.post("/login", async (req, res) => {
  const { email, password } = req.body;

  if (!email || !password) {
    return res.status(400).json({ error: "email and password are required" });
  }

  try {
    const result = await pool.query(
      `SELECT id, email, password_hash, role FROM users WHERE email = $1`,
      [email]
    );
    const user = result.rows[0];
    if (!user) {
      return res.status(401).json({ error: "Invalid email or password" });
    }

    const passwordMatches = await bcrypt.compare(password, user.password_hash);
    if (!passwordMatches) {
      return res.status(401).json({ error: "Invalid email or password" });
    }

    const accessToken = signAccessToken(user);
    const refreshToken = signRefreshToken(user);

    res.json({
      accessToken,
      refreshToken,
      user: { id: user.id, email: user.email, role: user.role },
    });
  } catch (err) {
    logger.error({ event: "login_failed", err: err.message }, "Login error");
    res.status(500).json({ error: "Internal server error" });
  }
});

router.post("/refresh", async (req, res) => {
  const { refreshToken } = req.body;

  if (!refreshToken) {
    return res.status(400).json({ error: "refreshToken is required" });
  }

  try {
    const payload = verifyRefreshToken(refreshToken);
    const result = await pool.query(
      `SELECT id, email, role FROM users WHERE id = $1`,
      [payload.sub]
    );
    const user = result.rows[0];
    if (!user) {
      return res.status(401).json({ error: "User no longer exists" });
    }

    const accessToken = signAccessToken(user);
    res.json({ accessToken });
  } catch (err) {
    return res.status(401).json({ error: "Invalid or expired refresh token" });
  }
});

module.exports = router;
