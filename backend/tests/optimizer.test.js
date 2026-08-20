// Integration suite -- unlike the other engine tests, this one needs a real
// Postgres connection (TARGET_DATABASE_URL from .env) because it exercises
// real EXPLAIN ANALYZE plans and a real CREATE INDEX/ROLLBACK, not just the
// heuristic logic around them. Requires `npm run db:seed-target` to have
// created target_db at least once (this suite creates/drops its own table,
// so it doesn't depend on that seed data existing).
const targetPool = require("../src/db/targetPool");
const { runExplainAnalyze, suggestIndexes, benchmarkBeforeAfter } = require("../src/engines/optimizer");

const TABLE = "optimizer_test_widgets";
const ROW_COUNT = 30000;
const QUERY = `SELECT * FROM ${TABLE} WHERE owner_id = 42`;

beforeAll(async () => {
  await targetPool.query(`DROP TABLE IF EXISTS ${TABLE}`);
  await targetPool.query(`
    CREATE TABLE ${TABLE} (
      id SERIAL PRIMARY KEY,
      owner_id INTEGER NOT NULL,
      label TEXT NOT NULL
    )
  `);
  await targetPool.query(
    `INSERT INTO ${TABLE} (owner_id, label)
     SELECT (floor(random() * 5000) + 1)::int, 'widget-' || i
     FROM generate_series(1, $1) AS i`,
    [ROW_COUNT]
  );
  await targetPool.query(`ANALYZE ${TABLE}`);
});

afterAll(async () => {
  await targetPool.query(`DROP TABLE IF EXISTS ${TABLE}`);
  await targetPool.end();
});

describe("optimizer engine (live target_db)", () => {
  it("runExplainAnalyze returns a real plan for a missing-index query", async () => {
    const plan = await runExplainAnalyze(QUERY);

    expect(plan.Plan["Node Type"]).toBe("Seq Scan");
    expect(plan.Plan["Relation Name"]).toBe(TABLE);
    expect(typeof plan["Execution Time"]).toBe("number");
  });

  it("suggestIndexes flags the unindexed filter column on the large table", async () => {
    const plan = await runExplainAnalyze(QUERY);
    const suggestions = await suggestIndexes(plan);

    expect(suggestions).toHaveLength(1);
    expect(suggestions[0]).toMatchObject({ table: TABLE, column: "owner_id" });
    expect(suggestions[0].sql).toBe(`CREATE INDEX IF NOT EXISTS idx_${TABLE}_owner_id ON ${TABLE} (owner_id);`);
  });

  it("benchmarkBeforeAfter measures a real improvement, then leaves target_db unindexed", async () => {
    const plan = await runExplainAnalyze(QUERY);
    const suggestions = await suggestIndexes(plan);
    const indexStatements = suggestions.map((s) => s.sql);

    const benchmark = await benchmarkBeforeAfter(QUERY, indexStatements);

    expect(benchmark.indexesApplied).toEqual(indexStatements);
    expect(benchmark.beforeMs).toBeGreaterThan(0);
    expect(benchmark.afterMs).toBeGreaterThan(0);
    expect(benchmark.afterMs).toBeLessThan(benchmark.beforeMs);

    // The transaction must have rolled back -- the index should not exist.
    const { rows } = await targetPool.query(
      `SELECT indexname FROM pg_indexes WHERE tablename = $1`,
      [TABLE]
    );
    expect(rows.map((r) => r.indexname)).not.toContain(`idx_${TABLE}_owner_id`);
  });

  it("benchmarkBeforeAfter with no suggested indexes returns beforeMs === afterMs and makes no changes", async () => {
    const benchmark = await benchmarkBeforeAfter(`SELECT * FROM ${TABLE} WHERE id = 1`, []);

    expect(benchmark.indexesApplied).toEqual([]);
    expect(benchmark.afterMs).toBe(benchmark.beforeMs);
  });
});
