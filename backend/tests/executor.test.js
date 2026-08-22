// Integration suite -- like optimizer.test.js, this needs a real Postgres
// connection (TARGET_DATABASE_URL) since it exercises real transactions,
// the statement_timeout guard, and the row cap, not just wrapper logic.
const targetPool = require("../src/db/targetPool");
const { executeQuerySafely } = require("../src/engines/executor");

const TABLE = "executor_test_widgets";
const ROW_COUNT = 150;

beforeAll(async () => {
  await targetPool.query(`DROP TABLE IF EXISTS ${TABLE}`);
  await targetPool.query(`
    CREATE TABLE ${TABLE} (
      id SERIAL PRIMARY KEY,
      label TEXT NOT NULL
    )
  `);
  await targetPool.query(
    `INSERT INTO ${TABLE} (label) SELECT 'widget-' || i FROM generate_series(1, $1) AS i`,
    [ROW_COUNT]
  );
});

afterAll(async () => {
  await targetPool.query(`DROP TABLE IF EXISTS ${TABLE}`);
  await targetPool.end();
});

describe("executeQuerySafely (live target_db)", () => {
  it("executes a safe, filtered SELECT and returns real rows", async () => {
    const result = await executeQuerySafely(`SELECT * FROM ${TABLE} WHERE id = 1`);

    expect(result.error).toBeNull();
    expect(result.rowCount).toBe(1);
    expect(result.rows[0]).toMatchObject({ id: 1, label: "widget-1" });
    expect(result.truncated).toBe(false);
    expect(result.executionTimeMs).toBeGreaterThanOrEqual(0);
  });

  it("caps a SELECT with no LIMIT at 100 rows and marks it truncated", async () => {
    const result = await executeQuerySafely(`SELECT * FROM ${TABLE}`);

    expect(result.error).toBeNull();
    expect(result.rowCount).toBe(100);
    expect(result.truncated).toBe(true);
  });

  it("does not mark a result already under the cap as truncated", async () => {
    const result = await executeQuerySafely(`SELECT * FROM ${TABLE} WHERE id <= 10`);

    expect(result.rowCount).toBe(10);
    expect(result.truncated).toBe(false);
  });

  it("respects an existing LIMIT smaller than the cap instead of always returning 100", async () => {
    const result = await executeQuerySafely(`SELECT * FROM ${TABLE} ORDER BY id LIMIT 5`);

    expect(result.rowCount).toBe(5);
    expect(result.truncated).toBe(false);
  });

  it("is cut off by the statement timeout instead of hanging, and returns a clean error", async () => {
    const result = await executeQuerySafely("SELECT pg_sleep(8)");

    expect(result.error).toEqual(expect.stringContaining("timeout"));
    expect(result.rows).toEqual([]);
  }, 15000);

  it("returns a clean error for a malformed query instead of throwing", async () => {
    const result = await executeQuerySafely("SELEKT * FRUM nowhere");

    expect(result.error).toEqual(expect.any(String));
    expect(result.rows).toEqual([]);
  });

  it("blocks a write hidden inside a CTE via the READ ONLY transaction, and leaves the table unchanged", async () => {
    const before = await targetPool.query(`SELECT label FROM ${TABLE} WHERE id = 1`);

    const result = await executeQuerySafely(
      `WITH x AS (UPDATE ${TABLE} SET label = 'HACKED' WHERE id = 1 RETURNING *) SELECT * FROM x`
    );

    expect(result.error).toEqual(expect.any(String));

    const after = await targetPool.query(`SELECT label FROM ${TABLE} WHERE id = 1`);
    expect(after.rows[0].label).toBe(before.rows[0].label);
  });
});
