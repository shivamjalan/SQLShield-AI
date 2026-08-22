const targetPool = require("../db/targetPool");
const logger = require("../config/logger");

// Kept separate from optimizer.js on purpose: that engine is about
// performance analysis (EXPLAIN ANALYZE, index experiments) and always
// ends in ROLLBACK without ever returning real result rows to a caller.
// Actually executing a query and handing back its real rows is a
// different responsibility -- a separate file keeps each engine's job
// legible from its name, same as parser/securityEngine/policyEngine
// staying split.

const STATEMENT_TIMEOUT_MS = 5000;
const ROW_CAP = 100;

// The caller (routes/query.js, routes/audit.js) has already confirmed
// this is exactly one SELECT statement via parser.js before this function
// is ever invoked -- stripping a trailing semicolon is just cleanup so the
// query can be wrapped as a subquery below, not a security boundary
// itself.
function stripTrailingSemicolon(sql) {
  return sql.trim().replace(/;\s*$/, "");
}

// Executes a single, already-validated read-only SELECT against target_db
// with defense-in-depth guardrails:
//   - a server-side statement_timeout so a slow/expensive query can't hang
//     the connection or the request, enforced by Postgres itself
//   - a READ ONLY transaction as a second, independent layer against
//     write access -- catches cases the operation==='SELECT' parser check
//     can miss (e.g. a write hidden inside a CTE: `WITH x AS (UPDATE ...
//     RETURNING *) SELECT * FROM x` parses as plain "SELECT", but
//     Postgres itself refuses to run it in a read-only transaction)
//   - a row cap enforced by wrapping the entire original query as a
//     subquery (`SELECT * FROM (<query>) AS x LIMIT 101`) -- works
//     regardless of whether the query already has its own LIMIT,
//     ORDER BY, or is a UNION, with no fragile SQL rewriting required.
//     Fetching cap+1 rows tells us whether the result was truncated
//     without a separate COUNT(*) query.
// Every path ends the transaction with ROLLBACK -- there is nothing to
// commit for a read, and always rolling back removes any doubt that this
// function could ever leave target_db mutated.
async function executeQuerySafely(sql) {
  const client = await targetPool.connect();
  const startedAt = Date.now();

  try {
    await client.query("BEGIN");
    await client.query(`SET LOCAL statement_timeout = ${STATEMENT_TIMEOUT_MS}`);
    await client.query("SET TRANSACTION READ ONLY");

    const cappedSql = `SELECT * FROM (${stripTrailingSemicolon(sql)}) AS _sqlshield_capped LIMIT ${ROW_CAP + 1}`;
    const result = await client.query(cappedSql);

    const truncated = result.rows.length > ROW_CAP;
    const rows = truncated ? result.rows.slice(0, ROW_CAP) : result.rows;

    return {
      rows,
      rowCount: rows.length,
      truncated,
      executionTimeMs: Date.now() - startedAt,
      error: null,
    };
  } catch (err) {
    logger.error(
      { event: "query_execution_failed", err: err.message },
      "Query execution against target_db failed"
    );
    return {
      rows: [],
      rowCount: 0,
      truncated: false,
      executionTimeMs: Date.now() - startedAt,
      error: err.message,
    };
  } finally {
    try {
      await client.query("ROLLBACK");
    } catch {
      // ROLLBACK itself failing (e.g. the connection was already broken by
      // a statement_timeout cancellation) isn't something the caller needs
      // to see -- the client is released either way.
    }
    client.release();
  }
}

module.exports = { executeQuerySafely };
