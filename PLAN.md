# SQLShield AI — Complete Build Plan & Architecture (MERN + PostgreSQL)

**Project:** Intelligent SQL Security, Policy Enforcement & Query Optimization Gateway
**Stack:** MERN-based — React.js, Node.js, Express.js — but with **PostgreSQL** in place of MongoDB, since this project is *about* protecting a relational database.
**Purpose of this document:** A self-contained spec you can hand to Claude Code phase by phase to build this project from zero, assuming no prior knowledge of the underlying concepts.

---

## 0. How to use this document

- Work through **Phase 0 → Phase 7** in order. Don't skip ahead.
- Each phase has: **what you'll learn**, **what you'll build**, **why it matters**, and a **"Prompt for Claude Code"** block — copy that block in as-is to get that phase built.
- After each phase there's a **checkpoint** you should verify works before moving on.
- Keep this file as `PLAN.md` in your repo root so Claude Code always has context.

---

## 1. What you're building, in plain English

Every application that talks to a database sends its SQL queries through a **checkpoint** first. That checkpoint:

1. Reads the query and understands what it's trying to do.
2. Checks it against **rules** ("no DELETE without a WHERE clause", "interns can't INSERT").
3. Checks it against **who's asking** (their role, which tables they're allowed to touch).
4. If something is unusual or unclear, asks an **AI model** to explain the risk in plain language and optionally suggest a safer query.
5. Optionally suggests a **faster version** of the query (index recommendations).
6. Logs everything, and either **allows**, **rewrites**, or **blocks** the query.

**The one sentence to remember while building this:** *rules decide, AI explains.* The security decision is always made by deterministic code — the LLM only explains it or suggests alternatives afterward. See the note on AI's role at the top of this conversation for the full reasoning — it's the part of this project most worth being able to explain clearly in an interview.

---

## 2. Prerequisites — what you need to understand before writing code

### 2.1 Why MERN here, with SQL instead of Mongo?
You already know MERN (React, Express, Node) from Vistaar — that's your strength, so we lean on it. But MongoDB is a **document database** (schema-flexible, no built-in relational integrity) — wrong tool for a project about relational-database security. **PostgreSQL** is used instead: a relational database with real foreign keys, transactions, and — critically — `EXPLAIN ANALYZE`, which the optimization engine depends on. You'll talk to Postgres from Node using a library instead of Mongoose.

### 2.2 Talking to PostgreSQL from Node
Two common approaches:
- **`pg`** (node-postgres): the raw client — you write SQL directly, get rows back. More control, closer to the metal — recommended here since this project *is* about SQL, so writing real SQL yourself is part of the point.
- **An ORM** (Sequelize, Prisma): abstracts SQL into JS objects. Convenient, but hides the exact queries — less useful when your whole project is about inspecting queries.

**Use `pg` directly for this project.** You'll write real SQL in your route handlers, which also makes talking about it in interviews much more concrete.

### 2.3 What is a SQL parser, and what will you use in Node?
A parser turns raw SQL text (`"DELETE FROM users"`) into a structured object your code can inspect (`{operation: 'DELETE', table: 'users', hasWhere: false}`) instead of guessing from the raw string with regex. In Python this was `sqlglot`; the Node equivalent is **`node-sql-parser`** — same purpose, JS API.

### 2.4 What is JWT authentication and RBAC?
**JWT (JSON Web Token)** is a signed string your server gives a user after login; they send it back on every future request so the server knows who they are without re-checking the password each time.
**RBAC (Role-Based Access Control)** means permissions attach to **roles** (Intern, Developer, Admin), not individuals.

### 2.5 What is Redis and why use it here?
An in-memory store, much faster than Postgres but not for permanent complex data. Used here for **rate limiting** (counting requests per user per minute) and lightweight caching.

### 2.6 What is Docker and Docker Compose?
Docker packages your app with its exact dependencies into a portable container. Docker Compose lets you define multiple containers (API, Postgres, Redis, frontend) and start them all with one command.

### 2.7 LLM API calls — and the boundary you must enforce in code
You'll call an LLM via the OpenAI or Anthropic API. Its job is narrow: **explain risk, suggest safer/faster queries** — never decide allow/block. You enforce this by only calling the LLM *after* the rule engine and policy engine have already produced a final decision, and treating its output purely as an explanation attached to the audit log (see the AI-role explanation above).

### 2.8 React — you already know this
From Vistaar. The frontend here is a dashboard visualizing what the backend gateway is doing — secondary to the backend, where the real technical depth lives.

---

## 3. System Architecture

```
                        ┌──────────────────┐
                        │   React Frontend  │
                        │ (Dashboard, Query  │
                        │   Playground)      │
                        └────────┬──────────┘
                                 │ HTTPS (JWT in header)
                                 ▼
                    ┌────────────────────────────┐
                    │   Node.js / Express Gateway │
                    │                              │
                    │  1. Auth Middleware (JWT)   │
                    │  2. Rate Limiter (Redis)    │
                    │  3. SQL Parser              │
                    │     (node-sql-parser)       │
                    │  4. Security Rule Engine    │
                    │  5. Policy / RBAC Engine    │
                    │  6. Decision Engine ────┐   │
                    │  7. AI Risk & Explain   │   │
                    │     Engine (LLM, async) │   │
                    │  8. Optimization Engine │   │
                    └───────────┬──────────────┘  │
                                │                  │
                 ┌──────────────┼──────────────────┘
                 │              │
              ALLOW          REWRITE          BLOCK
                 │              │                │
                 └──────────────┼────────────────┘
                                ▼
                     ┌─────────────────────┐
                     │   PostgreSQL (Core)   │
                     │  - users, roles       │
                     │  - policies           │
                     │  - audit_logs         │
                     │  - query_history      │
                     └─────────────────────┘
                                │
                     ┌─────────────────────┐
                     │ PostgreSQL (Target)   │  ← the DB being protected
                     │  sample business data │
                     └─────────────────────┘

                     ┌─────────────────────┐
                     │        Redis          │
                     │  rate limits, cache    │
                     └─────────────────────┘
```

### Request flow
1. Client sends a SQL query + JWT to `POST /api/query`.
2. Auth middleware verifies JWT → identifies user + role.
3. Rate limiter (Redis) checks the user's quota.
4. `node-sql-parser` turns the raw SQL into a structured object.
5. **Security Rule Engine** runs deterministic checks — no AI. If CRITICAL → BLOCK, skip to step 8.
6. **Policy Engine** checks role/table permissions from the `policies` table. If blocked → BLOCK, skip to step 8.
7. If MEDIUM/HIGH risk (ambiguous) → call the **AI Risk Engine** asynchronously for explanation + optional rewrite suggestion.
8. **Decision Engine** finalizes ALLOW / REWRITE / BLOCK, writes to `audit_logs`.
9. If ALLOWED, optionally execute against the Target DB and return results.
10. Dashboard reads `audit_logs` / `query_history` via normal REST endpoints.

---

## 4. Tech Stack

| Layer | Technology | Why |
|---|---|---|
| Backend framework | Node.js + Express.js | You already know this from Vistaar |
| SQL parsing | `node-sql-parser` | JS equivalent of sqlglot — real AST, not regex |
| Core DB | PostgreSQL (`pg` client) | Relational integrity + `EXPLAIN ANALYZE` for the optimizer |
| Target DB (protected) | PostgreSQL (separate schema/instance) | Keeps "protected DB" cleanly separate from app's own data |
| Cache / rate limiting | Redis (`ioredis` or `redis` npm package) | Fast, standard interview keyword |
| Auth | JWT (`jsonwebtoken`) + bcrypt, RBAC | Standard stateless auth, same as Vistaar |
| AI layer | OpenAI or Anthropic Node SDK | Narrow role: explanation/suggestion only |
| Frontend | React + Tailwind CSS | Same as Vistaar |
| Containerization | Docker + Docker Compose | One-command local deployment |
| Testing | Jest + Supertest | Standard Node testing stack |

---

## 5. Database Schema (Core DB) — unchanged from the relational design

```sql
-- users
CREATE TABLE users (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    email TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    role TEXT NOT NULL DEFAULT 'intern', -- intern | developer | admin
    created_at TIMESTAMPTZ DEFAULT now()
);

-- policies: table-level and operation-level rules per role
CREATE TABLE policies (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    role TEXT NOT NULL,
    table_name TEXT NOT NULL,       -- e.g. 'users', 'finance_reports', '*' for all
    operation TEXT NOT NULL,        -- SELECT | INSERT | UPDATE | DELETE | DROP
    allowed BOOLEAN NOT NULL,
    requires_approval BOOLEAN DEFAULT false,
    created_at TIMESTAMPTZ DEFAULT now()
);

-- audit_logs: every decision made
CREATE TABLE audit_logs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID REFERENCES users(id),
    raw_query TEXT NOT NULL,
    parsed_operation TEXT,
    target_table TEXT,
    risk_level TEXT,                -- LOW | MEDIUM | HIGH | CRITICAL
    decision TEXT NOT NULL,         -- ALLOW | REWRITE | BLOCK
    reasons JSONB,
    ai_explanation TEXT,            -- nullable, only when AI was invoked
    suggested_rewrite TEXT,         -- nullable
    execution_time_ms INTEGER,      -- nullable
    created_at TIMESTAMPTZ DEFAULT now()
);

-- query_history
CREATE TABLE query_history (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID REFERENCES users(id),
    query_text TEXT NOT NULL,
    created_at TIMESTAMPTZ DEFAULT now()
);
```

---

## 6. Folder Structure

```
sqlshield-ai/
├── backend/
│   ├── src/
│   │   ├── server.js               # Express app entrypoint
│   │   ├── auth/
│   │   │   ├── routes.js           # /register, /login, /refresh
│   │   │   ├── jwt.js
│   │   │   └── middleware.js       # authenticate, requireRole
│   │   ├── engines/
│   │   │   ├── parser.js           # node-sql-parser wrapper
│   │   │   ├── securityEngine.js   # rule-based checks
│   │   │   ├── policyEngine.js     # RBAC + table rules
│   │   │   ├── aiEngine.js         # LLM calls for explanation/suggestion
│   │   │   ├── optimizer.js        # EXPLAIN ANALYZE, index suggestions
│   │   │   └── decisionEngine.js   # combines all of the above
│   │   ├── routes/
│   │   │   ├── query.js            # POST /api/query
│   │   │   ├── audit.js            # GET /api/audit-logs
│   │   │   ├── policies.js         # CRUD for policies
│   │   │   └── dashboard.js        # aggregate stats
│   │   ├── db/
│   │   │   ├── pool.js             # pg Pool setup
│   │   │   └── init.sql
│   │   └── config/
│   │       ├── env.js
│   │       └── redis.js
│   ├── tests/
│   ├── package.json
│   └── Dockerfile
├── frontend/
│   ├── src/
│   │   ├── pages/
│   │   │   ├── Login.jsx
│   │   │   ├── Overview.jsx
│   │   │   ├── QueryPlayground.jsx
│   │   │   ├── SecurityLogs.jsx
│   │   │   ├── PolicyManagement.jsx
│   │   │   └── PerformanceAnalytics.jsx
│   │   ├── components/
│   │   ├── api/
│   │   └── App.jsx
│   ├── package.json
│   └── Dockerfile
├── docker-compose.yml
├── .env.example
├── PLAN.md
└── README.md
```

---

## 7. Build Phases

---

### Phase 0 — Environment Setup

**Checkpoint:** `npm run dev` starts the Express server and `GET /health` returns `{"status": "ok"}`.

**Prompt for Claude Code:**
```
I'm starting SQLShield AI, an Express.js + PostgreSQL project. Set up the
initial backend skeleton per PLAN.md Section 6.

1. Create the backend/ folder structure exactly as shown in PLAN.md Section 6.
2. Initialize a Node project with package.json including: express, pg,
   jsonwebtoken, bcrypt, dotenv, ioredis, node-sql-parser, cors.
3. Create src/server.js with a minimal Express app and GET /health
   returning { status: "ok" }.
4. Create src/config/env.js that loads DATABASE_URL, REDIS_URL,
   JWT_SECRET, LLM_API_KEY from a .env file using dotenv.
5. Create .env.example with placeholder values.
6. Explain what each file does in plain English, since I'm learning
   this as I go.

Do not implement business logic yet — just the skeleton and health check.
```

---

### Phase 1 — Auth, Users, and a Basic Dashboard Shell

**Checkpoint:** You can register a user, log in, get a JWT, hit a protected `/api/me`, and a React page shows "Welcome, {email}" after login.

**Prompt for Claude Code:**
```
Continue building SQLShield AI per PLAN.md. Implement Phase 1: Auth.

Backend:
1. Create the `users` table per PLAN.md Section 5 — write a src/db/init.sql
   with the CREATE TABLE statement and a script to run it against
   DATABASE_URL using the pg client.
2. Implement src/auth/jwt.js: functions to sign and verify JWTs (access +
   refresh tokens) using JWT_SECRET.
3. Implement src/auth/routes.js:
   - POST /auth/register (email, password, role) -> bcrypt-hash password,
     insert user via raw SQL with the pg client, return user info (no
     password hash in response).
   - POST /auth/login -> verify password, return access + refresh tokens.
   - POST /auth/refresh -> exchange refresh token for new access token.
4. Implement src/auth/middleware.js: `authenticate` (reads JWT from
   Authorization header, attaches req.user) and `requireRole(role)`.
5. Add protected GET /api/me using `authenticate`.
6. Write Jest + Supertest tests for register/login/me.

Frontend:
7. Scaffold a React app (Vite) in frontend/ with Tailwind configured.
8. Build Login.jsx that calls POST /auth/login, stores the JWT in React
   state (not localStorage unless I say otherwise), and redirects to an
   Overview page showing "Welcome, {email}".

Explain JWT, password hashing, and RBAC middleware as you introduce them,
and give me exact commands to test locally.
```

---

### Phase 2 — SQL Parsing & the Security Rule Engine

**Checkpoint:** `POST /api/query` with `"DELETE FROM users;"` returns `risk_level: CRITICAL`, reasons including "DELETE without WHERE clause".

**Prompt for Claude Code:**
```
Continue building SQLShield AI per PLAN.md. Implement Phase 2: SQL
Parsing + Security Rule Engine.

1. Implement src/engines/parser.js: `parseQuery(sql)` using node-sql-parser
   to return { operation, tablesReferenced, hasWhereClause,
   columnsReferenced }. Handle parse errors gracefully (invalid SQL ->
   risk_level CRITICAL, reason "unparseable query").

2. Implement src/engines/securityEngine.js: `runSecurityChecks(parsedQuery)`
   returning { riskLevel, reasons: [] } based on deterministic rules:
   - DELETE/UPDATE without WHERE -> CRITICAL
   - DROP TABLE / DROP DATABASE -> CRITICAL
   - query touching more than N tables -> MEDIUM
   - SELECT * (no explicit columns) -> LOW (informational)
   - basic injection heuristics (stacked queries via `;`, suspicious
     inline comments) -> HIGH
   No AI/LLM calls in this file — fully deterministic.

3. Create src/routes/query.js with POST /api/query:
   - requires authentication
   - parses the query, runs security checks
   - saves to query_history
   - returns the parsed result + risk assessment
   (Don't wire up policy engine, AI, or execution yet.)

4. Write tests: safe SELECT, unsafe DELETE without WHERE, DROP TABLE,
   an injection-pattern query.

Explain what node-sql-parser returns for one sample query so I
understand the structure parser.js works with.
```

---

### Phase 3 — Policy Engine (RBAC + Table-Level Rules)

**Checkpoint:** `intern` role BLOCKED on INSERT to any table; `developer` role ALLOWED. Policies live in the DB and are editable via API.

**Prompt for Claude Code:**
```
Continue building SQLShield AI per PLAN.md. Implement Phase 3: Policy
Engine.

1. Add the `policies` table per PLAN.md Section 5 to init.sql. Seed
   default policies on startup:
   - intern: SELECT allowed everywhere; INSERT/UPDATE/DELETE/DROP blocked
   - developer: SELECT/INSERT/UPDATE allowed; DELETE requires_approval=true;
     DROP blocked
   - admin: everything allowed

2. Implement src/engines/policyEngine.js: `checkPolicy(userRole,
   parsedQuery)` — looks up matching policies (role + table_name +
   operation, falling back to table_name='*'), returns
   { allowed, requiresApproval, reasons: [] }.

3. Wire into POST /api/query: after security checks, if not already
   CRITICAL, run checkPolicy and combine into a final decision object
   { decision: ALLOW | BLOCK, riskScore, reasons: [], pendingApproval }.

4. Add policy CRUD in src/routes/policies.js, admin-only via requireRole:
   GET /api/policies, POST /api/policies, DELETE /api/policies/:id

5. Add the audit_logs table per PLAN.md Section 5, and write a row for
   every /api/query call capturing the final decision.

6. Write tests: intern blocked on INSERT, developer allowed on INSERT,
   developer's DELETE flagged pendingApproval, admin allowed on DROP.

Explain the table_name='*' fallback matching with a couple of examples.
```

---

### Phase 4 — Audit Dashboard (Backend + Frontend)

**Checkpoint:** A live, filterable table of past queries in the dashboard, color-coded by risk/decision.

**Prompt for Claude Code:**
```
Continue building SQLShield AI per PLAN.md. Implement Phase 4: Audit
Dashboard.

Backend:
1. src/routes/audit.js:
   - GET /api/audit-logs with filters: decision, risk_level, user_id,
     limit, offset
   - GET /api/audit-logs/stats -> aggregate counts for the Overview page

Frontend:
2. SecurityLogs.jsx: filterable table with color-coded badges
   (green=ALLOW, yellow=pending, red=BLOCK).
3. Overview.jsx: summary cards from /stats, plus a simple chart
   (recharts) by risk level.
4. QueryPlayground.jsx: textarea to submit a raw query to POST
   /api/query, rendering the decision result nicely (not raw JSON).
5. react-router navigation between Login, Overview, SecurityLogs,
   QueryPlayground, with a sidebar.

Keep styling clean and simple with Tailwind.
```

---

### Phase 5 — AI Risk & Explanation Engine

**Checkpoint:** A MEDIUM-risk query triggers an AI call; the audit log shows a human-readable `ai_explanation`.

**Prompt for Claude Code:**
```
Continue building SQLShield AI per PLAN.md. Implement Phase 5: AI Risk &
Explanation Engine.

1. Implement src/engines/aiEngine.js: `getAiRiskExplanation(parsedQuery,
   securityResult, policyResult)` that:
   - builds a prompt describing the query and what the rule/policy
     engines already decided
   - asks the LLM ONLY to (a) explain in 1-2 sentences why the query
     might be risky, and (b) optionally suggest a safer rewrite
   - the system prompt must explicitly state: "A decision has already
     been made by a separate rule engine. Do not change or contradict
     the decision; only explain it and optionally suggest a safer
     alternative query."
   - request structured JSON output ({ explanation, suggestedRewrite })
     and handle malformed responses gracefully
   - use the OpenAI or Anthropic Node SDK, key from config/env.js. Ask
     me which provider before implementing if I haven't said.

2. Implement src/engines/decisionEngine.js as the single place combining
   securityEngine + policyEngine + (conditionally) aiEngine:
   - CRITICAL or policy-blocked -> BLOCK, skip AI entirely
   - LOW risk + policy allows -> ALLOW, skip AI
   - otherwise (MEDIUM/HIGH, or requiresApproval) -> call aiEngine,
     attach explanation + suggestedRewrite to the audit log
   - if AI suggests a rewrite AND it passes security+policy checks
     itself, decision=REWRITE, store both original and rewritten query

3. Update POST /api/query and audit_logs writes to include
   ai_explanation and suggested_rewrite columns.

4. Update QueryPlayground.jsx to display the AI explanation and any
   suggested rewrite when present.

5. Write tests with a mocked LLM client (never call the real API in
   tests): CRITICAL skips AI, LOW skips AI, MEDIUM calls AI and stores
   the explanation.

In your response, explain exactly where AI is and isn't involved in the
flow — I need to be able to say "AI never makes the block/allow
decision" and have that be literally true of the code.
```

---

### Phase 6 — Query Optimization Engine

**Checkpoint:** A query on an unindexed filtered column returns a real `EXPLAIN ANALYZE` output, a suggested `CREATE INDEX`, and a measured before/after time.

**Prompt for Claude Code:**
```
Continue building SQLShield AI per PLAN.md. Implement Phase 6: Query
Optimization Engine.

1. Set up a second PostgreSQL database/schema "target_db" per PLAN.md
   Section 3, seeded with a sample dataset (e.g. an `orders` table with
   50k-100k rows, `customers` with FK relationships). Write a seed
   script.

2. Implement src/engines/optimizer.js:
   - `runExplainAnalyze(sql)`: runs
     `EXPLAIN (ANALYZE, FORMAT JSON) <query>` against target_db, returns
     the parsed plan.
   - `suggestIndexes(explainResult, parsedQuery)`: inspects the plan for
     sequential scans on large tables where a WHERE/JOIN column has no
     index, returns suggested CREATE INDEX statements. Keep the
     heuristic simple, comment it clearly.
   - `benchmarkBeforeAfter(sql, indexStatements)`: runs the query,
     records time, applies the suggested index(es) in a transaction,
     re-runs, records new time, then rolls back so target_db isn't
     permanently mutated. Return real measured numbers.

3. Add this to POST /api/query for ALLOWED SELECT queries, or a separate
   POST /api/optimize — tell me which you'd recommend before
   implementing.

4. Add PerformanceAnalytics.jsx: original query, EXPLAIN plan summary,
   suggested index, before/after bar chart of execution time.

5. Write tests seeding a small table, running a query with a missing
   index, asserting the suggestion + measured improvement.

Explain what a sequential scan is and why it's usually slower than an
index scan.
```

---

### Phase 7 — Production Hardening: Redis, Docker, Tests, Polish

**Checkpoint:** `docker compose up` from a clean clone starts frontend + backend + Postgres (both DBs) + Redis, working end to end with no manual steps.

**Prompt for Claude Code:**
```
Continue building SQLShield AI per PLAN.md. Implement Phase 7:
Production Hardening.

1. Implement Redis-based rate limiting in src/config/redis.js and an
   Express middleware `rateLimit` applied to POST /api/query (e.g. 30
   queries/minute/user, HTTP 429 when exceeded).

2. Write Dockerfiles for backend/ and frontend/ per PLAN.md Section 6.

3. Write docker-compose.yml starting: backend, frontend, postgres
   (core + target — either two containers or one instance with two
   databases, tell me the tradeoff), and redis. Named volumes for
   persistence, .env for secrets (not committed; .env.example stays).

4. Add a healthcheck/wait pattern so backend doesn't crash connecting to
   Postgres before it's ready.

5. Add structured logging (e.g. winston or pino, not console.log) for
   key events: query received, decision made, AI engine called, rate
   limit hit.

6. Write a top-level README.md: description, architecture diagram
   (reuse PLAN.md Section 3), setup instructions (docker compose up),
   example curl commands.

7. Run the full test suite and fix anything broken by later-phase changes.

8. Give me a final manual end-to-end checklist to verify before I
   consider this "done" for a portfolio (register -> login -> submit a
   risky query -> see it blocked with AI explanation -> see it in the
   dashboard -> see optimization suggestions on a SELECT).

Prioritize correctness and clarity over new features this phase.
```

---

## 8. What NOT to do

Do not add, at least until all 7 phases are solid: Kubernetes, Kafka, a microservices split, Prometheus/Grafana (fine as a stretch *after* Phase 7), vector databases, multiple LLM providers/agents. A working, well-tested 7-phase project beats a half-working project with ten buzzwords in an interview every time.

---

## 9. Resume bullets (fill in real numbers once built)

> • Built SQLShield AI, a SQL security and optimization gateway using Express.js, PostgreSQL, and Redis, that parses and analyzes SQL queries in real time via a deterministic rule engine and RBAC policy layer.
>
> • Designed a policy engine supporting role-based and table-level access control, resolving [X]% of test queries to policy-appropriate ALLOW/BLOCK/pending-approval decisions with zero AI involvement in the core security decision.
>
> • Integrated an LLM-based explanation layer generating human-readable risk explanations and safer query rewrites for ambiguous queries, while keeping the LLM strictly out of the allow/block decision path.
>
> • Built a query optimization engine using PostgreSQL EXPLAIN ANALYZE, measuring real before/after execution time improvements of [X]ms -> [Y]ms on a [Z]-row dataset.
>
> • Fully containerized the system (Express, React, PostgreSQL, Redis) with Docker Compose for one-command local deployment.

---

## 10. Quick reference — prerequisite reading

- Express.js official guide (routing, middleware)
- `node-sql-parser` README/examples on GitHub
- `pg` (node-postgres) documentation
- PostgreSQL docs on EXPLAIN ANALYZE and indexes
- JWT.io introduction page
- Redis docs: "Rate limiting patterns"
- Docker Compose "Getting Started" official docs
