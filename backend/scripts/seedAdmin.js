// Creates an admin account by inserting directly into the users table.
//
// This is the ONLY sanctioned way an admin account should ever come into
// existence. It must NEVER be exposed as an HTTP endpoint or otherwise
// made reachable over the network -- POST /auth/register deliberately
// hardcodes role='intern' and ignores any role field a client sends
// specifically to prevent self-service admin creation; an API route
// wrapping this same insert would defeat that entirely. Run it locally /
// in CI / by whoever has direct database access, once, to bootstrap the
// first admin (or any subsequent one) -- after that, further role changes
// go through an existing admin using PATCH /api/users/:id/role.
//
// Usage:
//   node scripts/seedAdmin.js <email> <password>
//   ADMIN_EMAIL=you@example.com ADMIN_PASSWORD=... node scripts/seedAdmin.js
const bcrypt = require("bcrypt");
const pool = require("../src/db/pool");
const logger = require("../src/config/logger");

const SALT_ROUNDS = 10;

async function seedAdmin() {
  const email = process.argv[2] || process.env.ADMIN_EMAIL;
  const password = process.argv[3] || process.env.ADMIN_PASSWORD;

  if (!email || !password) {
    console.error("Usage: node scripts/seedAdmin.js <email> <password>  (or set ADMIN_EMAIL/ADMIN_PASSWORD)");
    process.exitCode = 1;
    return;
  }

  const passwordHash = await bcrypt.hash(password, SALT_ROUNDS);

  try {
    const result = await pool.query(
      `INSERT INTO users (email, password_hash, role)
       VALUES ($1, $2, 'admin')
       RETURNING id, email, role, created_at`,
      [email, passwordHash]
    );
    logger.info(
      { event: "admin_seeded", email: result.rows[0].email },
      `Admin account created: ${result.rows[0].email}`
    );
  } catch (err) {
    if (err.code === "23505") {
      console.error(`A user with email "${email}" already exists.`);
      process.exitCode = 1;
      return;
    }
    throw err;
  } finally {
    await pool.end();
  }
}

seedAdmin().catch((err) => {
  logger.error({ event: "admin_seed_failed", err: err.message }, "Failed to seed admin account");
  process.exitCode = 1;
});
