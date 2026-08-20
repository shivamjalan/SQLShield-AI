const fs = require("fs");
const path = require("path");
const { Client } = require("pg");
const env = require("../config/env");
const logger = require("../config/logger");
const { waitFor } = require("./waitForDb");

const CUSTOMER_COUNT = 5000;
const ORDER_COUNT = 100000;

// CREATE DATABASE can't run inside a pooled connection against a DB that
// might not exist yet, so this connects to the `postgres` maintenance DB
// first (same host/user/password as TARGET_DATABASE_URL) and creates
// target_db there if missing, mirroring how sqlshield_core was created by
// hand in Phase 0/1 -- this just automates the equivalent step.
async function ensureDatabaseExists() {
  const url = new URL(env.TARGET_DATABASE_URL);
  const targetDbName = url.pathname.replace(/^\//, "");
  url.pathname = "/postgres";

  await waitFor("postgres maintenance DB", async () => {
    const probe = new Client({ connectionString: url.toString() });
    await probe.connect();
    await probe.end();
  });

  const client = new Client({ connectionString: url.toString() });
  await client.connect();
  try {
    const { rows } = await client.query("SELECT 1 FROM pg_database WHERE datname = $1", [
      targetDbName,
    ]);
    if (rows.length === 0) {
      // Database names can't be parameterized -- targetDbName comes from
      // our own .env, not user input.
      await client.query(`CREATE DATABASE "${targetDbName}"`);
      logger.info({ event: "target_db_created", database: targetDbName }, `Created database "${targetDbName}".`);
    }
  } finally {
    await client.end();
  }
}

// Container restarts re-run this script every boot (no separate one-off
// migration job) -- skip reseeding if orders already has data instead of
// dropping/regenerating 100k rows and losing whatever the seeded data has
// accumulated (e.g. rows created via the running app) on every restart.
async function alreadySeeded(client) {
  const { rows } = await client.query("SELECT to_regclass('public.orders') AS reg");
  if (!rows[0].reg) return false;
  const { rows: countRows } = await client.query("SELECT count(*)::int AS n FROM orders");
  return countRows[0].n > 0;
}

async function seed() {
  await ensureDatabaseExists();

  const client = new Client({ connectionString: env.TARGET_DATABASE_URL });
  await client.connect();

  try {
    if (await alreadySeeded(client)) {
      logger.info({ event: "target_db_already_seeded" }, "target_db already has data -- skipping seed.");
      return;
    }

    const schema = fs.readFileSync(path.join(__dirname, "target_init.sql"), "utf8");
    await client.query(schema);
    logger.info({ event: "target_db_schema_created" }, "target_db schema created.");

    await client.query(
      `INSERT INTO customers (name, email, created_at)
       SELECT
         'Customer ' || i,
         'customer' || i || '@example.com',
         now() - (random() * interval '365 days')
       FROM generate_series(1, $1) AS i`,
      [CUSTOMER_COUNT]
    );
    logger.info({ event: "target_db_seeded_customers", count: CUSTOMER_COUNT }, `Seeded ${CUSTOMER_COUNT} customers.`);

    // generate_series + random() does this in one server-side statement
    // instead of ${ORDER_COUNT} round trips from Node -- seeds 100k rows
    // in a couple of seconds.
    await client.query(
      `INSERT INTO orders (customer_id, status, amount, order_date, created_at)
       SELECT
         (floor(random() * $1) + 1)::int,
         (ARRAY['pending', 'shipped', 'delivered', 'cancelled'])[floor(random() * 4 + 1)],
         round((random() * 500)::numeric, 2),
         now() - (random() * interval '365 days'),
         now()
       FROM generate_series(1, $2) AS i`,
      [CUSTOMER_COUNT, ORDER_COUNT]
    );
    logger.info({ event: "target_db_seeded_orders", count: ORDER_COUNT }, `Seeded ${ORDER_COUNT} orders.`);

    await client.query("ANALYZE customers");
    await client.query("ANALYZE orders");
    logger.info({ event: "target_db_ready" }, "target_db ready.");
  } finally {
    await client.end();
  }
}

if (require.main === module) {
  seed().catch((err) => {
    logger.error({ event: "target_db_seed_failed", err: err.message }, "Seeding target_db failed");
    process.exit(1);
  });
}

module.exports = { seed };
