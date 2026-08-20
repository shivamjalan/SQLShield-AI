const { Pool } = require("pg");
const env = require("../config/env");

// Connection to target_db -- the sample "protected" business database the
// optimizer runs EXPLAIN ANALYZE / index experiments against. Kept as its
// own pool, separate from db/pool.js (sqlshield_core), so a bug here can
// never touch app data (users, policies, audit_logs).
const targetPool = new Pool({ connectionString: env.TARGET_DATABASE_URL });

module.exports = targetPool;
