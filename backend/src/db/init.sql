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

-- audit_logs: the final decision recorded for every POST /api/query call.
-- pending_approval is an immutable historical fact set once at submission
-- time (does the policy in effect at that moment require a human to sign
-- off on this decision?). approval_status/reviewed_by/reviewed_at are a
-- separate, mutable review-workflow state layered on top -- set later, at
-- most once, via PATCH /api/audit-logs/:id/review. Keeping them distinct
-- means a query's original pending_approval flag stays accurate as a
-- record of what happened at submission time even after it's been
-- reviewed.
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
    approval_status TEXT DEFAULT NULL,  -- NULL | 'approved' | 'rejected'
    reviewed_by UUID REFERENCES users(id),
    reviewed_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT now()
);

-- CREATE TABLE IF NOT EXISTS above won't add new columns to an
-- already-existing table, so re-running this file on an older DB needs an
-- explicit ADD COLUMN too.
ALTER TABLE audit_logs ADD COLUMN IF NOT EXISTS pending_approval BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE audit_logs ADD COLUMN IF NOT EXISTS approval_status TEXT DEFAULT NULL;
ALTER TABLE audit_logs ADD COLUMN IF NOT EXISTS reviewed_by UUID REFERENCES users(id);
ALTER TABLE audit_logs ADD COLUMN IF NOT EXISTS reviewed_at TIMESTAMPTZ;

-- role_change_logs: audit trail for admin-driven role changes made via
-- PATCH /api/users/:id/role. Deliberately separate from audit_logs -- a
-- role change isn't a query decision (no raw_query/risk_level/decision
-- apply to it), so a dedicated table keeps every column meaningful instead
-- of mostly-null.
CREATE TABLE IF NOT EXISTS role_change_logs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    admin_id UUID REFERENCES users(id),
    target_user_id UUID REFERENCES users(id),
    old_role TEXT NOT NULL,
    new_role TEXT NOT NULL,
    created_at TIMESTAMPTZ DEFAULT now()
);
