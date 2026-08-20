const targetPool = require("../db/targetPool");

// Below this many rows, a sequential scan is basically free -- Postgres
// reading a few hundred rows off disk/cache is faster than the overhead of
// consulting an index, so the planner is *right* to seq-scan. Suggesting an
// index only makes sense once a seq scan is actually walking a meaningful
// number of rows.
const SEQ_SCAN_ROW_THRESHOLD = 1000;

// Runs EXPLAIN (ANALYZE, FORMAT JSON) against target_db and returns the
// parsed plan (the `Plan` object plus top-level fields like
// "Execution Time"). EXPLAIN ANALYZE actually EXECUTES the query -- callers
// must only pass SELECT statements that have already passed the
// security/policy engines.
async function runExplainAnalyze(sql) {
  const result = await targetPool.query(`EXPLAIN (ANALYZE, FORMAT JSON, BUFFERS) ${sql}`);
  return result.rows[0]["QUERY PLAN"][0];
}

// Recursively walks an EXPLAIN plan tree collecting every "Seq Scan" node
// (a plan can have several, e.g. one per side of a join).
function collectSeqScans(node, results) {
  if (!node) return results;
  if (node["Node Type"] === "Seq Scan") {
    results.push(node);
  }
  for (const child of node.Plans || []) {
    collectSeqScans(child, results);
  }
  return results;
}

// A Seq Scan node's "Filter" text looks like "(customer_id = 42)" or
// "((status = 'pending'::text) AND (amount > 100))". This pulls out the
// bare column identifiers being compared, skipping SQL keywords/operators.
// Deliberately simple regex-based extraction, not a real SQL parser -- good
// enough for single-column comparisons, which cover the common "missing
// index on a WHERE/JOIN column" case this heuristic targets.
function extractFilterColumns(filterText) {
  if (!filterText) return [];
  const matches = filterText.match(/[a-zA-Z_][a-zA-Z0-9_]*(?=\s*(=|<|>|<=|>=|<>|!=|\bIS\b|\bLIKE\b))/g) || [];
  return Array.from(new Set(matches));
}

// A Seq Scan node's "Actual Rows" is the rows RETURNED after applying the
// filter, not the rows examined -- a highly selective filter (e.g. matching
// 20 of 100k rows) reports a tiny "Actual Rows" even though Postgres walked
// every row of the table to find them. What actually makes a seq scan
// expensive is the size of the table it's scanning, so this looks up the
// table's own row count from pg_class.reltuples (kept fresh by ANALYZE,
// which the seed script already runs) instead of trusting the node's own
// row counts.
async function tableRowEstimate(table) {
  const { rows } = await targetPool.query(
    "SELECT reltuples::bigint AS estimate FROM pg_class WHERE relname = $1",
    [table]
  );
  return rows[0] ? Number(rows[0].estimate) : 0;
}

// Inspects an EXPLAIN plan for sequential scans on tables large enough that
// the scan is expensive, where the scan is filtering on a column with no
// supporting index (that's exactly what triggered the seq scan in the first
// place). Returns [{ table, column, sql, reason }].
async function suggestIndexes(explainResult) {
  const seqScans = collectSeqScans(explainResult.Plan, []);
  const suggestions = [];

  for (const node of seqScans) {
    const table = node["Relation Name"];
    if (!table) continue;

    const columns = extractFilterColumns(node.Filter);
    if (columns.length === 0) continue;

    const tableRows = await tableRowEstimate(table);
    if (tableRows < SEQ_SCAN_ROW_THRESHOLD) continue;

    for (const column of columns) {
      suggestions.push({
        table,
        column,
        sql: `CREATE INDEX IF NOT EXISTS idx_${table}_${column} ON ${table} (${column});`,
        reason: `Sequential scan over "${table}" (~${tableRows} rows) filtering on "${column}" with no supporting index.`,
      });
    }
  }

  return suggestions;
}

// Measures target_db's own reported "Execution Time" (ms) for a query via
// EXPLAIN ANALYZE -- this is Postgres's own server-side timing, not
// wall-clock-from-Node, so it isn't skewed by network/driver overhead.
async function timedExecutionMs(sql) {
  const plan = await runExplainAnalyze(sql);
  return plan["Execution Time"];
}

// Runs `sql`, records its time, applies `indexStatements` inside a
// transaction, re-runs and records the new time, then ROLLBACKs so
// target_db is never permanently mutated -- every call starts from the
// same unindexed baseline. Returns real measured numbers, not estimates.
async function benchmarkBeforeAfter(sql, indexStatements = []) {
  const beforeMs = await timedExecutionMs(sql);

  if (indexStatements.length === 0) {
    return { beforeMs, afterMs: beforeMs, indexesApplied: [] };
  }

  const client = await targetPool.connect();
  let afterMs;
  try {
    await client.query("BEGIN");
    for (const statement of indexStatements) {
      await client.query(statement);
    }
    const result = await client.query(`EXPLAIN (ANALYZE, FORMAT JSON, BUFFERS) ${sql}`);
    afterMs = result.rows[0]["QUERY PLAN"][0]["Execution Time"];
  } finally {
    // Always roll back, success or failure -- the suggested index is a
    // proposal, not something this benchmark should leave behind.
    await client.query("ROLLBACK");
    client.release();
  }

  return { beforeMs, afterMs, indexesApplied: indexStatements };
}

module.exports = { runExplainAnalyze, suggestIndexes, benchmarkBeforeAfter };
