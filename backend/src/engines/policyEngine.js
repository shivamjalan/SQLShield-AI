const pool = require("../db/pool");

const WILDCARD_TABLE = "*";

// Looks up every policy row for (userRole, operation) in one query, then
// resolves each referenced table against it in JS: an exact table_name
// match wins over the '*' wildcard row for that same role+operation. If
// neither exists, the query defaults to denied (fail closed) rather than
// silently allowing access to a table nobody has written a policy for.
async function checkPolicy(userRole, parsedQuery) {
  const { operation, tablesReferenced } = parsedQuery;
  const tables = tablesReferenced.length > 0 ? tablesReferenced : [WILDCARD_TABLE];

  const result = await pool.query(
    `SELECT table_name, allowed, requires_approval
     FROM policies
     WHERE role = $1 AND operation = $2`,
    [userRole, operation]
  );
  const byTable = new Map(result.rows.map((row) => [row.table_name, row]));

  let allowed = true;
  let requiresApproval = false;
  const reasons = [];

  for (const table of tables) {
    const policy = byTable.get(table) || byTable.get(WILDCARD_TABLE);

    if (!policy) {
      allowed = false;
      reasons.push(
        `No policy found for role '${userRole}' to ${operation} '${table}' — defaulting to deny`
      );
      continue;
    }

    if (!policy.allowed) {
      allowed = false;
      reasons.push(`Role '${userRole}' is not permitted to ${operation} '${table}'`);
    } else if (policy.requires_approval) {
      requiresApproval = true;
      reasons.push(`${operation} on '${table}' requires approval for role '${userRole}'`);
    }
  }

  return { allowed, requiresApproval, reasons };
}

module.exports = { checkPolicy };
