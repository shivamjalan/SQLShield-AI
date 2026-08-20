-- Core DB schema. Run via `npm run db:migrate` (src/db/migrate.js).

CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS users (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    email TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    role TEXT NOT NULL DEFAULT 'intern', -- intern | developer | admin
    created_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS query_history (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID REFERENCES users(id),
    query_text TEXT NOT NULL,
    created_at TIMESTAMPTZ DEFAULT now()
);

-- policies: table-level and operation-level rules per role. table_name='*'
-- is a wildcard fallback matched when no row exists for the specific table
-- (see policyEngine.js). The unique constraint makes seeding idempotent
-- (ON CONFLICT) and prevents two ambiguous rules for the same lookup key.
CREATE TABLE IF NOT EXISTS policies (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    role TEXT NOT NULL,
    table_name TEXT NOT NULL,       -- e.g. 'users', 'finance_reports', '*' for all
    operation TEXT NOT NULL,        -- SELECT | INSERT | UPDATE | DELETE | DROP
    allowed BOOLEAN NOT NULL,
    requires_approval BOOLEAN DEFAULT false,
    created_at TIMESTAMPTZ DEFAULT now(),
    UNIQUE (role, table_name, operation)
);

-- audit_logs: the final decision recorded for every POST /api/query call
CREATE TABLE IF NOT EXISTS audit_logs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID REFERENCES users(id),
    raw_query TEXT NOT NULL,
    parsed_operation TEXT,
    target_table TEXT,
    risk_level TEXT,                -- LOW | MEDIUM | HIGH | CRITICAL
    decision TEXT NOT NULL,         -- ALLOW | BLOCK (REWRITE added in Phase 5)
    pending_approval BOOLEAN NOT NULL DEFAULT false,
    reasons JSONB,
    ai_explanation TEXT,            -- nullable, populated in Phase 5
    suggested_rewrite TEXT,         -- nullable, populated in Phase 5
    execution_time_ms INTEGER,      -- nullable, populated in Phase 6
    created_at TIMESTAMPTZ DEFAULT now()
);

-- CREATE TABLE IF NOT EXISTS above won't add new columns to an
-- already-existing table, so re-running this file on an older DB needs an
-- explicit ADD COLUMN too.
ALTER TABLE audit_logs ADD COLUMN IF NOT EXISTS pending_approval BOOLEAN NOT NULL DEFAULT false;
