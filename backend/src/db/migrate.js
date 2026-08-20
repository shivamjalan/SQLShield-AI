const fs = require("fs");
const path = require("path");
const pool = require("./pool");
const logger = require("../config/logger");
const { waitFor } = require("./waitForDb");

async function migrate() {
  await waitFor("sqlshield_core", () => pool.query("SELECT 1"));

  const sql = fs.readFileSync(path.join(__dirname, "init.sql"), "utf8");
  await pool.query(sql);
  logger.info({ event: "migration_applied" }, "Migration applied: schema is ready.");
  await pool.end();
}

migrate().catch((err) => {
  logger.error({ event: "migration_failed", err: err.message }, "Migration failed");
  process.exit(1);
});
