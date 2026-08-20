# SQLShield AI

A SQL security, policy enforcement, and query optimization gateway. Every query passed to it is parsed, checked against deterministic security rules and role-based policies, optionally explained by an LLM, and logged — before ever touching a database.

**The one sentence to remember:** *rules decide, AI explains.* The allow/block/rewrite decision is always made by deterministic code (`securityEngine.js` + `policyEngine.js`). The LLM (`aiEngine.js`) only runs afterward, only for ambiguous cases, and its output is never trusted directly — a suggested rewrite is re-validated through the same deterministic engines before it's ever applied.

## Architecture

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

Core and target run as two databases on **one** Postgres instance (see "Postgres: one instance vs. two containers" below).

## Features

- **Deterministic security rule engine** — flags `DELETE`/`UPDATE` without `WHERE`, `DROP`, stacked statements, injection-pattern comments, and more, with zero AI involvement.
- **Role-based policy engine** — per-role, per-table `SELECT`/`INSERT`/`UPDATE`/`DELETE`/`DROP` rules, backed by the `policies` table, editable via API, fail-closed by default.
- **AI explanation layer** — an LLM (OpenAI-compatible, defaults to OpenRouter + Gemini 2.0 Flash) explains *why* a query is risky and can suggest a safer rewrite — but never makes the decision. Any suggested rewrite is re-parsed and re-run through the real security/policy engines before it's ever applied.
- **Query optimization engine** — runs real `EXPLAIN (ANALYZE, FORMAT JSON)` against a sample "protected" database, detects sequential scans on large unindexed columns, suggests `CREATE INDEX` statements, and measures a real before/after execution-time improvement (applied in a transaction, then rolled back).
- **Audit dashboard** — every decision is logged; the frontend has a filterable security log, an overview with charts, and a query playground.
- **Redis-backed rate limiting** — 30 queries/minute/user, fails open (not closed) if Redis itself is unavailable.
- **Structured logging** — pino, JSON in production, pretty-printed in dev, covering query received / decision made / AI engine called / rate limit hit.

## Running it: `docker compose up`

This is the zero-manual-steps path — a clean clone, one command, everything wired together (Postgres with both databases, Redis, backend, frontend).

```bash
cp .env.example .env
# edit .env: at minimum set POSTGRES_PASSWORD and JWT_SECRET.
# LLM_API_KEY can stay a placeholder -- the AI explanation layer degrades
# gracefully (ai_explanation stays null) if it's not a real key.

docker compose up --build
```

Then:
- Frontend: http://localhost:5173
- Backend API: http://localhost:4000

The backend container runs the schema migration and seeds `target_db` (5,000 customers / 100,000 orders) automatically on first boot — both steps are idempotent, so restarting the stack doesn't reseed or lose data. The backend also retries its database connection with backoff on startup, so it tolerates Postgres taking a moment longer to finish initializing than the container itself.

### Postgres: one instance vs. two containers

`docker-compose.yml` runs Postgres as a single container holding two databases (`sqlshield_core`, `target_db`), the same layout used in local native development. The tradeoff:

- **One instance, two databases (chosen here):** fewer containers/volumes/credentials to manage, mirrors local dev exactly, simpler compose file — the right call for a project whose focus is the gateway logic, not database topology.
- **Two separate containers:** fully isolated failure domains, and arguably more true-to-life for a security gateway (a real "protected" database is a different physical system you don't control) — but doubles the containers, volumes, and connection config for no benefit in a single-node demo/portfolio deployment.

## Running it natively (no Docker)

Useful for active development (hot reload via `nodemon`/Vite). Requires your own local Postgres and Redis.

```bash
# Backend
cd backend
cp .env.example .env   # edit with your local Postgres/Redis connection info
npm install
npm run db:migrate       # creates schema in sqlshield_core
npm run db:seed-target   # creates + seeds target_db
npm run dev               # http://localhost:4000

# Frontend (separate terminal)
cd frontend
npm install
npm run dev               # http://localhost:5173
```

Run the backend test suite with `npm test` (74 tests; one suite, `tests/optimizer.test.js`, needs a real Postgres connection since it exercises real `EXPLAIN ANALYZE`/`CREATE INDEX` behavior — everything else is fully mocked).

## Example requests

```bash
# Register + log in
curl -X POST http://localhost:4000/auth/register \
  -H "Content-Type: application/json" \
  -d '{"email":"dev@example.com","password":"testpass123","role":"developer"}'

TOKEN=$(curl -s -X POST http://localhost:4000/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"dev@example.com","password":"testpass123"}' | jq -r .accessToken)

# A CRITICAL query -- blocked before the policy engine or AI ever run
curl -X POST http://localhost:4000/api/query \
  -H "Content-Type: application/json" -H "Authorization: Bearer $TOKEN" \
  -d '{"query":"DELETE FROM orders"}'

# Optimize a SELECT against the sample target database
curl -X POST http://localhost:4000/api/optimize \
  -H "Content-Type: application/json" -H "Authorization: Bearer $TOKEN" \
  -d '{"query":"SELECT * FROM orders WHERE customer_id = 42"}'

# Audit log stats for the dashboard
curl http://localhost:4000/api/audit-logs/stats -H "Authorization: Bearer $TOKEN"
```

## Project layout

See `PLAN.md` for the full phase-by-phase build plan this project followed, including the architecture rationale and what NOT to add.
