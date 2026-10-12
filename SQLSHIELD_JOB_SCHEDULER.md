# SQLShield — Distributed Job Scheduler & Task Execution Engine

## What we are building

A scheduler that runs approved SQL work **later** — on a cron, or asynchronously
because it takes too long for an HTTP request — with multiple gateway instances
cooperating so a job runs exactly where and when it should, and no more than
once per scheduled slot.

**Why it belongs in SQLShield specifically:**

Your executor sets `statement_timeout` on every query. Anything slower than that
budget simply fails — there is currently **no path** through the gateway for a
legitimately long analytical query. That is a real limitation, and a job engine
removes it rather than decorating around it. Same for `/optimize`, which runs
EXPLAIN ANALYZE plus index creation and rollback synchronously inside a request.

**The four things it unlocks:**

| Use case | Why it needs a scheduler |
|---|---|
| Async long queries | Exceeds `statement_timeout`; needs a longer budget off the request path |
| Scheduled reports | "Run this export every weekday at 6am" |
| Optimizer benchmarks | EXPLAIN ANALYZE + index create/rollback is too slow to hold a request open |
| Retention housekeeping | Prune and roll up `audit_logs` / `query_history` nightly |

**The pieces:**

| Piece | What it does |
|---|---|
| `scheduled_jobs` table | Job definitions: cron, timezone, payload, misfire policy |
| `job_runs` table | The queue and the execution log |
| `scheduler.js` | Ticks, materializes due jobs into runs, advances `next_run_at` |
| `worker.js` | Claims runs with `SKIP LOCKED`, executes, heartbeats |
| `taskRegistry.js` | Maps task type → handler, with per-type concurrency limits |
| `tasks/runQuery.js` | Re-decides the query, then executes it |
| `routes/jobs.js` | CRUD, manual trigger, cancel, run history |

**What it demonstrates:** distributed coordination without a coordinator
(advisory locks + unique constraints), the canonical Postgres queue pattern
(`FOR UPDATE SKIP LOCKED`), heartbeat-based liveness for long tasks, cooperative
cancellation, cron scheduling with timezone and misfire handling, and
concurrency control.

**Scope:** larger than the rate limiter — realistically two to three focused
days, not an afternoon.

---

## ⚠ Read this before starting: don't build the same thing twice

If you are also building the Vistaar outbox, you need to be able to say clearly
why these are different systems, or an interviewer will hear "he built one
background worker and put it in two repos."

They genuinely are different, and here is the distinction to have ready:

| | Vistaar outbox | SQLShield scheduler |
|---|---|---|
| **Purpose** | React to something that happened | Run something at a time |
| **Trigger** | A domain event (stock changed) | A clock (cron) or an explicit submit |
| **Store** | MongoDB | PostgreSQL |
| **Claiming** | `findOneAndUpdate`, one doc at a time | `SELECT … FOR UPDATE SKIP LOCKED`, batched |
| **Coordination** | Static partition assignment | Advisory lock + unique constraint |
| **Liveness** | Fixed 30s lease | Heartbeats (tasks legitimately run for minutes) |
| **Time handling** | None | Cron parsing, timezones, DST, misfire policy |
| **Ordering** | Guaranteed per partition key | Not guaranteed; concurrency-limited instead |

Different storage engine, different claiming primitive, different coordination
mechanism, different liveness model. That is a real distinction and worth
stating in exactly those terms.

**If you only have time for one:** build this one. SQLShield is your stronger
project, the use case is more defensible, and `SKIP LOCKED` is a better story
than a Mongo claim loop.

---

# PART 1 — How it works

## 1.1 Two tables, and why they're separate

A common mistake is one table holding both "what should run" and "what did run."
It falls apart the moment you need run history, or a job that is currently
running twice.

**`scheduled_jobs`** — the *definition*. One row per job. Changes rarely.

```
id, name, task_type, payload (jsonb), cron_expr, timezone,
enabled, next_run_at, misfire_policy, max_concurrent, created_by
```

**`job_runs`** — the *queue and the log*. One row per execution attempt. Created
by the scheduler, consumed by workers, kept forever.

```
id, job_id, task_type, payload, scheduled_for, status,
attempt, locked_by, locked_at, heartbeat_at, started_at,
finished_at, result (jsonb), error, cancel_requested, backend_pid
```

The separation gives you three things for free: a job can be disabled without
losing its history, an ad-hoc async query is just a `job_runs` row with a null
`job_id`, and "show me every failed run of this job" is one query.

## 1.2 The scheduler tick, and the duplicate-run problem

Every N seconds, each instance asks: which jobs are due?

```sql
SELECT * FROM scheduled_jobs
WHERE enabled AND next_run_at <= now()
```

...then inserts a `job_runs` row for each and advances `next_run_at`.

**With three gateway instances, all three do this simultaneously.** A daily
report gets scheduled three times and three workers run it. That is the core
problem the scheduler half has to solve.

There are two defenses, and you want both.

### Defense 1 — a Postgres advisory lock

```sql
SELECT pg_try_advisory_lock(4815162342);
```

An advisory lock is a named lock Postgres tracks but attaches no meaning to. Only
one session can hold a given key. `pg_try_advisory_lock` returns immediately with
true or false rather than blocking.

So each tick: try to grab the lock. If false, another instance is already
scheduling — return and try again next tick. If true, do the work and release.

This is **leader election without a coordinator**. No ZooKeeper, no etcd, no
Raft. The leadership lasts one tick, which is all you need, and it dissolves
automatically if the holder's connection drops — Postgres releases session-level
advisory locks when the session ends, including on a crash.

**The honest caveat:** this makes the scheduling tick single-threaded across the
fleet. Fine when the tick is a fast metadata operation. It would not be fine if
the tick did heavy work — which is exactly why the tick only *inserts rows* and
the actual execution happens in workers.

### Defense 2 — a unique constraint

```sql
CREATE UNIQUE INDEX ON job_runs (job_id, scheduled_for)
WHERE job_id IS NOT NULL;
```

`scheduled_for` is the *slot* the run belongs to — the exact timestamp the cron
expression fired for, not `now()`. So even if two schedulers somehow both act
(lock released early, clock skew, a bug you introduce in six months), the second
insert violates the constraint and is discarded.

Use `ON CONFLICT DO NOTHING` and the race becomes invisible.

**Why both?** The advisory lock is the mechanism; the constraint is the
guarantee. Locks are held by processes and processes are unreliable. Constraints
are held by the database and cannot be wrong. Depending on a lock alone means
your correctness rests on nothing ever going strange with a connection.

This layering — an optimistic mechanism plus a database-level invariant that
makes violation impossible — is worth being able to articulate. It is the same
shape as the partial unique index on Vistaar's StockAlert.

## 1.3 Claiming work: FOR UPDATE SKIP LOCKED

This is the canonical Postgres queue pattern and the single best thing to
understand in this build.

```sql
UPDATE job_runs
SET status = 'RUNNING', locked_by = $1, locked_at = now(),
    heartbeat_at = now(), started_at = now()
WHERE id IN (
  SELECT id FROM job_runs
  WHERE status = 'PENDING' AND run_after <= now()
  ORDER BY scheduled_for
  FOR UPDATE SKIP LOCKED
  LIMIT $2
)
RETURNING *;
```

**What `FOR UPDATE` does:** locks the selected rows for the duration of the
transaction, so no other transaction can modify them.

**What `SKIP LOCKED` adds — and this is the whole point:** rows already locked by
another transaction are *skipped over* rather than waited on.

Without it, five workers polling simultaneously all try to lock the same oldest
row. One wins; four block. When the winner commits, the four wake, re-evaluate,
find the row is no longer PENDING, and go back for the next one. Your queue
throughput is now effectively single-threaded, and it gets worse as you add
workers.

With `SKIP LOCKED`, worker 1 takes rows 1–5, worker 2 sees those locked and
immediately takes 6–10, worker 3 takes 11–15. No contention, no coordination, no
partitioning scheme needed. Linear scaling.

This is what Postgres-backed queues are built on, and it is why "just use your
database as a queue" became reasonable advice.

**Why order by `scheduled_for` and not `created_at`:** a run that was supposed to
fire at 06:00 but got created at 06:05 after an outage should still be treated as
the 06:00 run. Ordering by intended time is more correct than ordering by
insertion time.

## 1.4 Heartbeats, not leases

The Vistaar outbox uses a fixed 30-second lease: any event held longer than that
is assumed abandoned.

That model breaks here, because **these tasks legitimately run for minutes.** A
30-minute analytical query is the entire reason this system exists. A fixed lease
would reclaim it repeatedly and run it again and again while the original is
still going.

The fix is a **heartbeat**: the worker updates `heartbeat_at = now()` every 10
seconds while working, in a separate short transaction. A reaper then reclaims
runs whose heartbeat is stale:

```sql
UPDATE job_runs
SET status = 'PENDING', locked_by = NULL, attempt = attempt + 1
WHERE status = 'RUNNING' AND heartbeat_at < now() - interval '60 seconds';
```

The difference in one sentence: **a lease asks "how long could this take?" and a
heartbeat asks "is this worker still alive?"** The second question has a
knowable answer. The first does not.

The heartbeat must run in its own transaction, not the task's. If it shared the
task's long-running transaction the update would not be visible to the reaper
until commit — which is exactly when you no longer need it.

## 1.5 Cancellation — the SQLShield-specific part

A user submits a 40-minute query by mistake and wants it stopped. Two layers,
because neither alone is enough.

**Layer 1 — cooperative.** Set `cancel_requested = true`. The task checks it
between steps and exits cleanly.

This is the only *safe* way to stop application code. Forcibly killing a task
mid-write leaves partial state, which is why `Thread.stop()` was deprecated in
Java and why Go has no goroutine kill.

**Layer 2 — `pg_cancel_backend`.** Cooperative cancellation does nothing if the
worker is blocked inside a single 40-minute `SELECT`. There is no "between
steps."

So when the query starts, capture the connection's backend PID:

```sql
SELECT pg_backend_pid();
```

Store it on the run row. To cancel:

```sql
SELECT pg_cancel_backend($1);
```

Postgres sends a cancel signal to that specific backend, the query aborts with an
error, control returns to your code, and the cooperative check then handles the
cleanup.

**`pg_cancel_backend` vs `pg_terminate_backend`:** cancel stops the current query
and leaves the connection alive. Terminate kills the whole connection. Always
try cancel first — terminate is for a backend that ignores cancellation, and it
poisons the connection so your pool has to discard it.

This layer is genuinely specific to a SQL gateway. Most job schedulers cannot do
it because they are not sitting on a database connection to the thing doing the
work. Yours is. Use it.

## 1.6 Re-deciding at execution time

**This is the design decision that makes the scheduler belong in SQLShield rather
than being a generic queue bolted onto an unrelated project. Do not skip it.**

A query scheduled on Monday runs on Friday. In between:

- the policy for that table changed from ALLOW to DENY
- the user's role was downgraded from analyst to viewer
- the user was deactivated entirely

If the scheduler stores "this query was approved" and executes it on that basis,
you have built a **policy bypass with a delay fuse**. Every scheduled job becomes
a way to hold a permission you no longer have.

So the task handler calls `makeDecision` again, at execution time, with the job
owner's *current* role, and blocks if the answer is now BLOCK. The decision is
re-derived, never cached.

**The follow-up question to be ready for:** what if the user is deleted? Then the
job has no valid actor and must fail rather than run with elevated or default
permissions. Jobs are owned by users, and an ownerless job does not execute.

This also means the audit log stays honest: every scheduled execution produces
its own audit row with its own decision, not a reference to a decision made days
earlier.

## 1.7 Cron, timezones, and the parts that are genuinely hard

**Use a library** (`cron-parser`). Do not hand-roll cron parsing — the syntax has
enough edge cases (step values, ranges, `L`, `W`, day-of-month vs day-of-week
OR semantics) that a hand-rolled parser is a source of bugs, not a display of
skill.

What you *do* need to handle yourself:

**Timezones.** `0 6 * * *` means 6am — but where? Store an IANA timezone per job
(`Asia/Kolkata`) and compute `next_run_at` in that zone. A job created by a user
in Bengaluru and one created in New York should not fire at the same instant.

**DST.** On spring-forward day, 2:30am does not exist. On fall-back day it
happens twice. A daily 2:30am job will either be skipped or run twice unless the
library is told the timezone explicitly. India has no DST, so this will not bite
you locally — which is exactly why it is worth knowing about rather than
discovering in production.

**Misfire policy.** The scheduler was down from 01:00 to 04:00. An hourly job has
three missed slots. What should happen?

Three defensible answers, and the right one depends on the job:

- `RUN_ALL` — fire all three. Correct for anything that must not skip a period,
  like an hourly aggregation.
- `RUN_ONCE` — fire one and move on. Correct for a refresh where only the latest
  state matters.
- `SKIP` — fire nothing, resume at the next scheduled slot. Correct for
  notifications, where three stale alerts at 4am is worse than none.

Make it a column on `scheduled_jobs`, not a global constant. Having the taxonomy
and being able to say *when* each applies is a much better answer than picking
one.

## 1.8 Concurrency limits

A job that takes 10 minutes and is scheduled every 5 will overlap itself. Left
alone, runs pile up until they saturate the worker pool and starve everything
else.

Two separate controls:

**Per-job** (`max_concurrent` on `scheduled_jobs`) — usually 1. Before claiming,
check whether this job already has a RUNNING row; skip if it does.

**Per-task-type** (in the registry) — a global cap on how many
`OPTIMIZER_BENCHMARK` tasks can run fleet-wide, regardless of which job they came
from. Because that task creates indexes on the target database, and ten of them
at once is a denial of service against the thing you are supposed to be
protecting.

The second is the one people forget, and it is the one that matters here.

## 1.9 Delivery semantics, again

Same as the outbox: **at-least-once**. A worker can finish a task and die before
recording success; the reaper reclaims it and runs it again.

But here it lands more gently, because **read-only queries are naturally
idempotent.** Running a `SELECT` twice produces the same rows and no side
effects. That is not luck — it is a consequence of the executor already enforcing
`READ ONLY` transactions.

Worth stating explicitly in an interview: the reason at-least-once is cheap in
this system is that the underlying operations are side-effect-free. If you added
a task type that sent email or wrote to an external system, you would need
per-task idempotency keys, and the design would get meaningfully harder. Knowing
where the property comes from — rather than assuming it holds generally — is the
answer.

## 1.10 Full lifecycle trace

A daily report job, `0 6 * * *`, `Asia/Kolkata`, three gateway instances.

```
05:59:50  Instance A tick -> pg_try_advisory_lock -> TRUE
          Instance B tick -> pg_try_advisory_lock -> FALSE, returns
          Instance C tick -> pg_try_advisory_lock -> FALSE, returns
          A: no jobs due yet (next_run_at = 06:00). Releases lock.

06:00:03  Instance B wins the lock this time.
          SELECT ... WHERE enabled AND next_run_at <= now()  -> the report job
          INSERT job_runs (job_id, scheduled_for = 06:00:00, status = PENDING)
            ON CONFLICT (job_id, scheduled_for) DO NOTHING
          UPDATE scheduled_jobs SET next_run_at = <tomorrow 06:00 Asia/Kolkata>
          Releases lock.

06:00:04  All three worker pools poll:
            UPDATE ... WHERE id IN (
              SELECT id ... FOR UPDATE SKIP LOCKED LIMIT 5)
          Instance C's worker wins the row. A and B skip it and find nothing.

06:00:04  Worker starts heartbeat interval (every 10s).
          Task RUN_QUERY:
            - load job owner, check still active
            - makeDecision(sql, owner.role)  <- re-decided NOW, not at schedule time
            - ALLOW -> SELECT pg_backend_pid(), store on the run row
            - execute inside READ ONLY txn with an extended statement_timeout
            - write an audit_logs row for this execution

06:04:12  Query completes. status = SUCCEEDED, result summary stored,
          heartbeat interval cleared.
```

**Failure branches:**

- **Instance C is `kill -9`'d at 06:02.** Run stays RUNNING with a frozen
  `heartbeat_at`. At 06:03 the reaper sees it is >60s stale, resets it to PENDING
  and increments `attempt`. Another worker picks it up. The abandoned Postgres
  backend is cleaned up when the dead connection is detected.
- **Policy changed to DENY overnight.** `makeDecision` returns BLOCK. The run is
  marked FAILED with the block reason, and an audit row records it. The job stays
  scheduled — tomorrow's run will be re-decided again, and will succeed if the
  policy is reverted.
- **User cancels at 06:02.** `cancel_requested = true` and
  `pg_cancel_backend(pid)`. The `SELECT` aborts, the driver throws, the task sees
  the cancel flag and marks the run CANCELLED rather than retrying.
- **Query exceeds even the job timeout.** `statement_timeout` fires, task throws,
  run marked FAILED. Retried per the job's retry policy, then given up on.
- **All three instances tick simultaneously and the lock somehow releases early.**
  Two schedulers both insert for `scheduled_for = 06:00:00`. The unique index
  rejects the second. One run.

---

# PART 2 — Claude Code prompts

Run in order from the SQLShield repo root. Verify after each.

Note: `src/db/init.sql` is applied idempotently by `src/db/migrate.js` using
`CREATE TABLE IF NOT EXISTS`, so new tables get appended there. Be aware that
`IF NOT EXISTS` will not add columns to an existing table — the file already has
a comment noting this.

## Prompt 1 — schema

> Add two tables to `backend/src/db/init.sql`, following the existing style
> (`CREATE TABLE IF NOT EXISTS`, snake_case, explanatory SQL comments).
>
> **`scheduled_jobs`** — job definitions:
> `id` (bigserial pk), `name` (text, unique, not null), `task_type` (text, not
> null), `payload` (jsonb, not null, default '{}'), `cron_expr` (text, null for
> one-off jobs), `timezone` (text, not null, default 'UTC'), `enabled` (boolean,
> default true), `next_run_at` (timestamptz), `misfire_policy` (text, check in
> ('RUN_ALL','RUN_ONCE','SKIP'), default 'RUN_ONCE'), `max_concurrent` (int,
> default 1), `retry_limit` (int, default 3), `created_by` (bigint references
> users), `created_at`, `updated_at`.
>
> **`job_runs`** — the queue and the execution log:
> `id` (bigserial pk), `job_id` (bigint references scheduled_jobs on delete
> cascade, **nullable** — ad-hoc async submissions have no parent job),
> `task_type` (text, not null), `payload` (jsonb, not null), `scheduled_for`
> (timestamptz, not null — the slot this run belongs to, not when it was
> inserted), `run_after` (timestamptz, not null, default now() — retry backoff
> target), `status` (text, check in
> ('PENDING','RUNNING','SUCCEEDED','FAILED','CANCELLED'), default 'PENDING'),
> `attempt` (int, default 0), `locked_by` (text), `locked_at` (timestamptz),
> `heartbeat_at` (timestamptz), `started_at`, `finished_at`, `result` (jsonb),
> `error` (text), `cancel_requested` (boolean, default false), `backend_pid`
> (int), `requested_by` (bigint references users), `created_at`.
>
> Indexes:
> - `CREATE UNIQUE INDEX ... ON job_runs (job_id, scheduled_for) WHERE job_id IS
>   NOT NULL` — the duplicate-scheduling guard. Comment it as such: the advisory
>   lock in the scheduler is the mechanism, this constraint is the guarantee, and
>   the reason for both is that locks are held by processes (unreliable) while
>   constraints are held by the database (cannot be wrong).
> - `(status, run_after, scheduled_for)` — covers the worker's claim query.
> - `(status, heartbeat_at)` — for the reaper.
> - `(job_id, created_at DESC)` — run history lookups.
> - `(enabled, next_run_at)` on scheduled_jobs — the scheduler tick.

**Verify:** `npm run migrate`, then `\d job_runs` in psql — confirm the partial
unique index shows its `WHERE` clause.

---

## Prompt 2 — task registry

> Create `backend/src/jobs/taskRegistry.js` (CommonJS, matching the rest of the
> backend).
>
> A registry mapping `task_type` → `{ handler, maxGlobalConcurrent,
> timeoutMs }`. Export `getTask(type)` and `listTaskTypes()`.
>
> Register four types with placeholder handlers for now:
> - `RUN_QUERY` — maxGlobalConcurrent 5, timeout 300000
> - `OPTIMIZER_BENCHMARK` — maxGlobalConcurrent 1, timeout 120000
> - `RETENTION_PRUNE` — maxGlobalConcurrent 1, timeout 60000
> - `HEALTH_PROBE` — maxGlobalConcurrent 1, timeout 10000
>
> Comment why per-task-type concurrency is separate from the per-job
> `max_concurrent` column: per-job stops a slow job overlapping itself,
> per-task-type is a fleet-wide cap that exists because `OPTIMIZER_BENCHMARK`
> creates indexes on the target database and ten concurrent benchmarks would be a
> denial of service against the database the gateway is supposed to be
> protecting.
>
> A handler receives `(payload, ctx)` where ctx exposes `{ runId, signal,
> heartbeat(), isCancelled(), logger }`, and either resolves with a
> JSON-serialisable result or throws.

---

## Prompt 3 — the scheduler

> Create `backend/src/jobs/scheduler.js`.
>
> `startScheduler()` runs a tick every `SCHEDULER_TICK_MS` (default 10000).
>
> Each tick:
> 1. `SELECT pg_try_advisory_lock($1)` with a fixed key from env
>    (`SCHEDULER_LOCK_KEY`, default 4815162342). If false, return immediately —
>    another instance is scheduling this tick.
> 2. Select enabled jobs where `next_run_at <= now()`.
> 3. For each: insert a `job_runs` row with `scheduled_for = next_run_at` (the
>    intended slot, **not** `now()`) using `ON CONFLICT (job_id, scheduled_for)
>    DO NOTHING`.
> 4. Compute the next `next_run_at` with `cron-parser`, passing the job's
>    `timezone`, and update the job.
> 5. Release the lock in a `finally`.
>
> Use one transaction per job so a single malformed cron expression can't stall
> every other job. Log and skip jobs whose cron fails to parse.
>
> **Misfire handling.** If `next_run_at` is more than one interval in the past —
> the scheduler was down — apply the job's `misfire_policy`:
> - `RUN_ALL`: insert a run for every missed slot (cap at 50 to avoid a
>   thundering herd after a long outage).
> - `RUN_ONCE`: insert one run and jump `next_run_at` forward to the next future
>   slot.
> - `SKIP`: insert nothing, jump to the next future slot.
>
> Comment the advisory lock properly: this is leader election without a
> coordinator; `pg_try_advisory_lock` doesn't block, leadership lasts one tick,
> and Postgres releases session-level advisory locks automatically when the
> session ends including on a crash. Also note the honest limitation — the tick
> is single-threaded fleet-wide, which is acceptable only because the tick does
> metadata work and never executes tasks.
>
> Install `cron-parser`. Do not hand-roll cron parsing.

**Verify:** create a job with `*/1 * * * *`. Start three backend instances. Watch
`job_runs` — exactly one row per minute, not three. Check the logs: two instances
should report failing to acquire the lock each tick.

---

## Prompt 4 — the worker pool

> Create `backend/src/jobs/worker.js`.
>
> `startWorkerPool()` polls every `WORKER_POLL_MS` (default 2000) and claims up
> to `WORKER_BATCH_SIZE` (default 5) runs with:
>
> ```sql
> UPDATE job_runs
> SET status = 'RUNNING', locked_by = $1, locked_at = now(),
>     heartbeat_at = now(), started_at = now(), attempt = attempt + 1
> WHERE id IN (
>   SELECT id FROM job_runs
>   WHERE status = 'PENDING' AND run_after <= now()
>   ORDER BY scheduled_for
>   FOR UPDATE SKIP LOCKED
>   LIMIT $2
> )
> RETURNING *;
> ```
>
> `locked_by` = `${os.hostname()}:${process.pid}`.
>
> Comment `SKIP LOCKED` thoroughly — it is the most important line in the file.
> Without it, N workers polling simultaneously all block on the same oldest row;
> one wins and the rest wait, re-evaluate, and find it already taken, so queue
> throughput is effectively single-threaded and degrades as workers are added.
> With it, each worker skips rows another transaction holds and immediately takes
> the next available ones — linear scaling with no partitioning scheme.
>
> Also comment why the ordering is `scheduled_for` and not `created_at`: a run
> that should have fired at 06:00 but was created at 06:05 after an outage is
> still the 06:00 run, and intended time is more correct than insertion time.
>
> For each claimed run:
> - Start a heartbeat `setInterval` at `HEARTBEAT_MS` (default 10000) updating
>   `heartbeat_at = now()`. It must run in **its own short transaction**, not
>   inside the task's — inside a long-running transaction the update wouldn't be
>   visible to the reaper until commit, which is exactly when it's no longer
>   needed.
> - Check per-task-type global concurrency before starting; if at the cap, reset
>   the run to PENDING with a short `run_after` delay and move on.
> - Check the job's `max_concurrent` (skip if that job already has a RUNNING run).
> - Look up the handler, run it with the ctx object.
> - On success: SUCCEEDED, `finished_at`, store the result.
> - On throw: if `attempt >= retry_limit` mark FAILED, else back to PENDING with
>   `run_after = now() + random(0, 2000 * 2^attempt)` — **full jitter**, so a
>   provider outage that fails many runs at once doesn't schedule them all to
>   retry at the same instant.
> - Always clear the heartbeat interval in a `finally`.
>
> Also export `startReaper()` — every 30s, reset RUNNING runs whose
> `heartbeat_at` is older than `LEASE_TIMEOUT_MS` (default 60000) back to
> PENDING, logging each reclaim.
>
> Comment why heartbeats rather than the fixed lease used elsewhere: these tasks
> legitimately run for minutes, so a fixed lease would reclaim a healthy
> long-running query and run it again. A lease asks "how long could this take?",
> which has no knowable answer; a heartbeat asks "is this worker still alive?",
> which does.

**Verify:** queue 20 runs, start two instances, confirm they split the work with
no run executing twice. Then `kill -9` a worker mid-run and confirm the reaper
reclaims it after ~60s.

---

## Prompt 5 — the RUN_QUERY task

> Create `backend/src/jobs/tasks/runQuery.js`.
>
> Payload: `{ sql, ownerId, timeoutMs }`.
>
> Steps:
> 1. Load the owner from `users`. If missing or inactive, **fail the run** — a
>    job with no valid actor must not execute with default or elevated
>    permissions.
> 2. Call the existing `makeDecision` from `engines/decisionEngine.js` with the
>    SQL and the owner's **current** role.
> 3. If the decision is BLOCK, mark the run FAILED with the reason and write an
>    `audit_logs` row. Do not retry — a policy block is not a transient failure.
> 4. If ALLOW, capture `SELECT pg_backend_pid()` on the connection and store it
>    on the run row before executing.
> 5. Execute through the existing executor, but with the job's `timeoutMs` rather
>    than the interactive default.
> 6. Write an `audit_logs` row for this execution, and store a result summary
>    (row count, duration, truncation flag) — **not** the full rows, which could
>    be large and may contain sensitive data.
> 7. Check `ctx.isCancelled()` between steps and exit cleanly if set.
>
> Step 2 needs a prominent comment, because it is the design decision that makes
> this scheduler belong in SQLShield rather than being a generic queue: a query
> scheduled Monday runs Friday, and in between the policy may have flipped to
> DENY or the user's role may have been downgraded. Caching "this was approved"
> would turn every scheduled job into a policy bypass with a delay fuse. The
> decision is re-derived at execution time, never stored.
>
> Register it in the task registry.

**Verify:** schedule a query, then flip its table's policy to DENY before it
runs. The run should fail with the block reason and produce an audit row.

---

## Prompt 6 — cancellation

> Add cancellation support.
>
> `POST /api/jobs/runs/:id/cancel`:
> 1. Set `cancel_requested = true` on the run.
> 2. If it is RUNNING and has a `backend_pid`, call
>    `SELECT pg_cancel_backend($1)` on a **separate** pool connection.
>
> In the worker's ctx, `isCancelled()` re-reads `cancel_requested` from the run
> row (cached for ~1s to avoid hammering the DB). Tasks check it between steps.
>
> When a task exits due to cancellation, mark the run CANCELLED — not FAILED —
> and do not retry.
>
> Comment the two-layer design:
> - Cooperative cancellation is the only *safe* way to stop application code;
>   forcibly killing a task mid-write leaves partial state, which is why
>   `Thread.stop()` was deprecated and Go has no goroutine kill.
> - But cooperative checking does nothing when the worker is blocked inside a
>   single 40-minute `SELECT` — there is no "between steps." `pg_cancel_backend`
>   is what unblocks it, aborting the query so control returns to your code, at
>   which point the cooperative check handles cleanup.
> - Use `pg_cancel_backend`, not `pg_terminate_backend`: cancel stops the current
>   query and leaves the connection usable, terminate kills the connection and
>   poisons the pooled client.
>
> Authorization: a user can cancel their own runs; a superadmin can cancel any.

**Verify:** submit `SELECT pg_sleep(300)` as an async job, cancel it, confirm the
run goes to CANCELLED within a second or two rather than after 300s.

---

## Prompt 7 — API routes

> Create `backend/src/routes/jobs.js`, mounted at `/api/jobs` in `server.js`.
> Use the existing `authenticate` and `requireRole` middleware, and apply
> `rateLimit`.
>
> - `POST /api/jobs` — create a scheduled job. Validate the cron expression with
>   `cron-parser` and the timezone with `Intl.supportedValuesOf('timeZone')`,
>   returning 400 on either failure. Run `makeDecision` on the SQL **at creation
>   time too** and reject outright if it's already CRITICAL — no point scheduling
>   something that can never run. Compute the initial `next_run_at`.
> - `GET /api/jobs` — list, scoped to the caller unless superadmin.
> - `PATCH /api/jobs/:id` — enable/disable, change cron (recompute
>   `next_run_at`).
> - `DELETE /api/jobs/:id`.
> - `POST /api/jobs/:id/trigger` — insert an immediate `job_runs` row with
>   `scheduled_for = now()`. Note in a comment that this deliberately bypasses the
>   unique constraint's dedup by using `now()` rather than a cron slot, so a
>   manual trigger can coexist with a scheduled run.
> - `POST /api/jobs/runs` — submit a one-off async query (`job_id` null). This is
>   the escape hatch for queries that exceed the interactive `statement_timeout`.
> - `GET /api/jobs/:id/runs` — paginated run history.
> - `GET /api/jobs/runs/:id` — one run, **scoped to the requester** unless
>   superadmin.
>
> That last scoping matters: run rows contain query text and result summaries, so
> an unscoped lookup would be an IDOR.

---

## Prompt 8 — wire it up and add the remaining tasks

> **1.** In `server.js`, start the scheduler, worker pool, and reaper after the
> server is listening, each gated on an env flag (`RUN_SCHEDULER`,
> `RUN_WORKERS`, default true). Comment that this lets you run scheduler-only or
> worker-only processes in production even though the demo runs both in one.
>
> **2.** Add graceful shutdown: on SIGTERM, stop claiming new runs, wait up to 30s
> for in-flight runs to finish, then reset any still-RUNNING rows owned by this
> worker back to PENDING so they're picked up immediately rather than waiting for
> the reaper's 60s timeout.
>
> **3.** Implement the remaining task handlers:
> - `RETENTION_PRUNE` — delete `audit_logs` and `query_history` rows older than a
>   configurable window, in batches with a `LIMIT` so a large delete doesn't hold
>   locks or bloat WAL. Return the number deleted.
> - `OPTIMIZER_BENCHMARK` — run the existing optimizer's `benchmarkBeforeAfter`
>   for a saved query and store the comparison. This is precisely the workload
>   that shouldn't sit in an HTTP request.
> - `HEALTH_PROBE` — check target DB reachability and record latency.
>
> **4.** Add tests in `backend/tests/scheduler.test.js`:
> - Advisory lock: two concurrent tick calls, only one schedules.
> - Unique constraint: two inserts for the same `(job_id, scheduled_for)` yield
>   one row.
> - `SKIP LOCKED`: two concurrent claims return disjoint sets.
> - Reaper: a run with a stale heartbeat is reset to PENDING with `attempt`
>   incremented.
> - Misfire: each of the three policies produces the expected number of runs
>   after a simulated outage.
> - Re-decision: a run whose policy flipped to DENY fails with the block reason.
>
> Match the existing test style. The claim and lock tests need a live Postgres —
> mark them so they can be skipped when one isn't available, consistent with how
> `executor.test.js` behaves today.

---

# Demonstrating it

Record these. Each one is a claim an interviewer would otherwise have to take on
faith.

1. **No duplicate scheduling.** Three instances, a `*/1 * * * *` job, ten
   minutes. Exactly ten runs. Logs show two instances losing the advisory lock
   each tick.
2. **`SKIP LOCKED` scaling.** Queue 100 runs. One worker, time it. Three workers,
   time it. Should be roughly 3× faster, with zero double-execution.
3. **Crash recovery.** `kill -9` a worker mid-run. Show the frozen
   `heartbeat_at`, then the reaper reclaiming it and another worker finishing it.
4. **Cancellation.** `SELECT pg_sleep(300)` cancelled in two seconds via
   `pg_cancel_backend`.
5. **Re-decision.** Schedule a query, flip the policy to DENY, watch the run fail
   with the block reason and produce an audit row. **This is the demo to lead
   with** — it is the one that shows the scheduler understands what project it
   lives in.
6. **Misfire.** Stop the scheduler for 3 minutes with a `*/1` job, restart it
   under each of the three policies, show 3 runs / 1 run / 0 runs.

---

# Interview questions to have answers ready for

**Coordination**
- Three instances, one cron job — how do you stop it running three times?
- What is a Postgres advisory lock and when is it released?
- You have the advisory lock — why also a unique constraint?
- Why is `scheduled_for` the cron slot rather than `now()`?

**Queueing**
- What does `SKIP LOCKED` do, and what happens without it?
- Why order by `scheduled_for` rather than `created_at`?
- Why is a database-backed queue reasonable here rather than a broker?

**Liveness**
- Why heartbeats instead of a fixed lease? (You used a lease in your other
  project — why the difference?)
- Why must the heartbeat run in its own transaction?
- What happens to the orphaned Postgres backend when a worker is `kill -9`'d?

**Cancellation**
- How do you cancel a query already blocked inside a 40-minute `SELECT`?
- `pg_cancel_backend` vs `pg_terminate_backend`?
- Why not just kill the worker thread?

**The design question**
- A query is approved on Monday and runs on Friday. What could go wrong?
- What if the job's owner is deleted?

**Time**
- What happens to a 2:30am daily job on DST spring-forward day?
- The scheduler was down for three hours — what should an hourly job do?

---

# Resume bullet, after this ships

- Built a distributed job scheduler and task execution engine on PostgreSQL,
  coordinating multiple gateway instances with advisory-lock leader election and
  a slot-uniqueness constraint to guarantee one execution per scheduled window,
  and claiming work via `SELECT … FOR UPDATE SKIP LOCKED` for contention-free
  horizontal scaling.
- Supported long-running and recurring queries with heartbeat-based crash
  recovery, cooperative cancellation backed by `pg_cancel_backend`, per-job and
  per-task-type concurrency limits, and re-evaluation of security and RBAC policy
  at execution time so a scheduled query cannot outlive the permissions that
  authorised it.
