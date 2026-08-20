-- Schema for target_db, the sample "protected" business database the
-- optimizer engine runs EXPLAIN ANALYZE against. Run via
-- `npm run db:seed-target` (src/db/seedTarget.js), not db:migrate --
-- this is a separate database from sqlshield_core.

DROP TABLE IF EXISTS orders;
DROP TABLE IF EXISTS customers;

CREATE TABLE customers (
    id SERIAL PRIMARY KEY,
    name TEXT NOT NULL,
    email TEXT UNIQUE NOT NULL,
    created_at TIMESTAMPTZ DEFAULT now()
);

-- customer_id deliberately has NO index beyond what the FK constraint
-- requires (Postgres does not auto-index FK columns, only the referenced
-- PK) -- this is what lets the optimizer demonstrate a sequential scan on
-- `WHERE customer_id = ...` and suggest fixing it.
CREATE TABLE orders (
    id SERIAL PRIMARY KEY,
    customer_id INTEGER NOT NULL REFERENCES customers(id),
    status TEXT NOT NULL,
    amount NUMERIC(10, 2) NOT NULL,
    order_date TIMESTAMPTZ NOT NULL,
    created_at TIMESTAMPTZ DEFAULT now()
);
