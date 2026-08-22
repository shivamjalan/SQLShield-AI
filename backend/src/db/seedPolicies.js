const pool = require("./pool");
const logger = require("../config/logger");

// Default policies per PLAN.md Section 7 Phase 3. All rows use the '*'
// wildcard table_name — per-table overrides (e.g. blocking developers from
// touching 'finance_reports') can be added later via the policies API.
const DEFAULT_POLICIES = [
  { role: "intern", table_name: "*", operation: "SELECT", allowed: true, requires_approval: false },
  { role: "intern", table_name: "*", operation: "INSERT", allowed: false, requires_approval: false },
  { role: "intern", table_name: "*", operation: "UPDATE", allowed: false, requires_approval: false },
  { role: "intern", table_name: "*", operation: "DELETE", allowed: false, requires_approval: false },
  { role: "intern", table_name: "*", operation: "DROP", allowed: false, requires_approval: false },

  { role: "developer", table_name: "*", operation: "SELECT", allowed: true, requires_approval: false },
  { role: "developer", table_name: "*", operation: "INSERT", allowed: true, requires_approval: false },
  { role: "developer", table_name: "*", operation: "UPDATE", allowed: true, requires_approval: false },
  { role: "developer", table_name: "*", operation: "DELETE", allowed: true, requires_approval: true },
  { role: "developer", table_name: "*", operation: "DROP", allowed: false, requires_approval: false },

  { role: "admin", table_name: "*", operation: "SELECT", allowed: true, requires_approval: false },
  { role: "admin", table_name: "*", operation: "INSERT", allowed: true, requires_approval: false },
  { role: "admin", table_name: "*", operation: "UPDATE", allowed: true, requires_approval: false },
  { role: "admin", table_name: "*", operation: "DELETE", allowed: true, requires_approval: false },
  { role: "admin", table_name: "*", operation: "DROP", allowed: true, requires_approval: false },

  // 'policies' and 'audit_logs' govern the RBAC system and its own audit
  // trail, so non-admins are denied on these two specific tables even
  // though their generic '*' wildcard above allows the same operation
  // elsewhere (an exact table_name match wins over '*' for the same
  // role+operation -- see policyEngine.js). The REST layer is already
  // admin-gated (routes/policies.js) or read-only (routes/audit.js has no
  // mutation route at all) -- these rows are defense-in-depth at the
  // policy-engine layer itself, in case query execution is ever wired
  // into POST /api/query.
  { role: "intern", table_name: "policies", operation: "INSERT", allowed: false, requires_approval: false },
  { role: "intern", table_name: "policies", operation: "UPDATE", allowed: false, requires_approval: false },
  { role: "intern", table_name: "policies", operation: "DELETE", allowed: false, requires_approval: false },
  { role: "developer", table_name: "policies", operation: "INSERT", allowed: false, requires_approval: false },
  { role: "developer", table_name: "policies", operation: "UPDATE", allowed: false, requires_approval: false },
  { role: "developer", table_name: "policies", operation: "DELETE", allowed: false, requires_approval: false },

  { role: "intern", table_name: "audit_logs", operation: "UPDATE", allowed: false, requires_approval: false },
  { role: "intern", table_name: "audit_logs", operation: "DELETE", allowed: false, requires_approval: false },
  { role: "developer", table_name: "audit_logs", operation: "UPDATE", allowed: false, requires_approval: false },
  { role: "developer", table_name: "audit_logs", operation: "DELETE", allowed: false, requires_approval: false },
];

// Idempotent via the (role, table_name, operation) unique constraint — safe
// to call on every server startup; existing rows (including ones an admin
// has since edited via the policies API) are left untouched.
async function seedPolicies() {
  for (const p of DEFAULT_POLICIES) {
    await pool.query(
      `INSERT INTO policies (role, table_name, operation, allowed, requires_approval)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (role, table_name, operation) DO NOTHING`,
      [p.role, p.table_name, p.operation, p.allowed, p.requires_approval]
    );
  }
  logger.info({ event: "policies_seeded" }, "Default policies seeded (existing rows left untouched).");
}

module.exports = { seedPolicies, DEFAULT_POLICIES };
