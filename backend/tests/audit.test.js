process.env.JWT_SECRET = "test-secret-do-not-use-in-prod";
process.env.DATABASE_URL = "postgresql://unused:unused@localhost:5432/unused";

jest.mock("../src/db/pool", () => ({ query: jest.fn() }));

// Only the executor is mocked here -- parser.js/decisionEngine.js run for
// real so the re-validation-on-execute path is exercised genuinely (the
// pool mock below stands in for the policy lookup decisionEngine makes
// along the way). No test in this file drives a MEDIUM/HIGH-risk or
// requiresApproval query through /execute, so aiEngine is never reached
// and doesn't need mocking.
jest.mock("../src/engines/executor", () => ({
  executeQuerySafely: jest.fn(async () => ({
    rows: [{ id: 1, email: "a@example.com" }],
    rowCount: 1,
    truncated: false,
    executionTimeMs: 5,
    error: null,
  })),
}));

const request = require("supertest");
const pool = require("../src/db/pool");
const { executeQuerySafely } = require("../src/engines/executor");
const app = require("../src/server");
const { signAccessToken } = require("../src/auth/jwt");

const authHeader = `Bearer ${signAccessToken({ id: "u1", email: "dev@example.com", role: "developer" })}`;
const adminHeader = `Bearer ${signAccessToken({ id: "admin-1", email: "admin@example.com", role: "admin" })}`;

afterEach(() => jest.clearAllMocks());

describe("GET /api/audit-logs", () => {
  it("requires authentication", async () => {
    const res = await request(app).get("/api/audit-logs");
    expect(res.status).toBe(401);
  });

  it("rejects an invalid decision filter", async () => {
    const res = await request(app)
      .get("/api/audit-logs?decision=NOPE")
      .set("Authorization", authHeader);
    expect(res.status).toBe(400);
  });

  it("rejects an invalid risk_level filter", async () => {
    const res = await request(app)
      .get("/api/audit-logs?risk_level=NOPE")
      .set("Authorization", authHeader);
    expect(res.status).toBe(400);
  });

  it("returns logs and total count", async () => {
    pool.query
      .mockResolvedValueOnce({ rows: [{ count: "2" }] })
      .mockResolvedValueOnce({
        rows: [
          { id: "1", decision: "BLOCK", risk_level: "CRITICAL", pending_approval: false },
          { id: "2", decision: "ALLOW", risk_level: "LOW", pending_approval: false },
        ],
      });

    const res = await request(app)
      .get("/api/audit-logs?limit=10&offset=0")
      .set("Authorization", authHeader);

    expect(res.status).toBe(200);
    expect(res.body.total).toBe(2);
    expect(res.body.logs).toHaveLength(2);
  });

  it("scopes the query and count by the decision filter", async () => {
    pool.query
      .mockResolvedValueOnce({ rows: [{ count: "1" }] })
      .mockResolvedValueOnce({ rows: [{ id: "1", decision: "BLOCK", risk_level: "CRITICAL" }] });

    const res = await request(app)
      .get("/api/audit-logs?decision=BLOCK")
      .set("Authorization", authHeader);

    expect(res.status).toBe(200);
    const [countSql, countParams] = pool.query.mock.calls[0];
    expect(countSql).toContain("WHERE a.decision = $1");
    expect(countParams).toEqual(["BLOCK"]);
  });
});

describe("GET /api/audit-logs/stats", () => {
  it("requires authentication", async () => {
    const res = await request(app).get("/api/audit-logs/stats");
    expect(res.status).toBe(401);
  });

  it("returns aggregate counts with every decision/risk-level key present", async () => {
    pool.query
      .mockResolvedValueOnce({ rows: [{ count: "5" }] })
      .mockResolvedValueOnce({
        rows: [
          { decision: "ALLOW", count: "3" },
          { decision: "BLOCK", count: "2" },
        ],
      })
      .mockResolvedValueOnce({
        rows: [
          { risk_level: "LOW", count: "3" },
          { risk_level: "CRITICAL", count: "2" },
        ],
      })
      .mockResolvedValueOnce({ rows: [{ count: "1" }] });

    const res = await request(app).get("/api/audit-logs/stats").set("Authorization", authHeader);

    expect(res.status).toBe(200);
    expect(res.body.total).toBe(5);
    expect(res.body.byDecision).toEqual({ ALLOW: 3, BLOCK: 2, REWRITE: 0 });
    expect(res.body.byRiskLevel).toEqual({ LOW: 3, MEDIUM: 0, HIGH: 0, CRITICAL: 2 });
    expect(res.body.pendingApproval).toBe(1);
  });
});

describe("GET /api/audit-logs/pending", () => {
  it("requires admin role", async () => {
    const res = await request(app).get("/api/audit-logs/pending").set("Authorization", authHeader);
    expect(res.status).toBe(403);
  });

  it("queries only for pending_approval=true AND approval_status IS NULL rows", async () => {
    pool.query.mockResolvedValueOnce({
      rows: [{ id: "1", raw_query: "DELETE FROM orders WHERE id = 1", risk_level: "LOW", decision: "ALLOW" }],
    });

    const res = await request(app).get("/api/audit-logs/pending").set("Authorization", adminHeader);

    expect(res.status).toBe(200);
    expect(res.body.logs).toHaveLength(1);
    const [sql] = pool.query.mock.calls[0];
    expect(sql).toContain("a.pending_approval = true");
    expect(sql).toContain("a.approval_status IS NULL");
  });
});

describe("PATCH /api/audit-logs/:id/review", () => {
  it("requires admin role", async () => {
    const res = await request(app)
      .patch("/api/audit-logs/log1/review")
      .set("Authorization", authHeader)
      .send({ decision: "approved" });
    expect(res.status).toBe(403);
  });

  it("rejects a decision value outside approved/rejected", async () => {
    const res = await request(app)
      .patch("/api/audit-logs/log1/review")
      .set("Authorization", adminHeader)
      .send({ decision: "maybe" });
    expect(res.status).toBe(400);
    expect(pool.query).not.toHaveBeenCalled();
  });

  it("returns 404 when the audit log entry doesn't exist", async () => {
    pool.query.mockResolvedValueOnce({ rows: [] });

    const res = await request(app)
      .patch("/api/audit-logs/nope/review")
      .set("Authorization", adminHeader)
      .send({ decision: "approved" });

    expect(res.status).toBe(404);
  });

  it("rejects reviewing a row that was never pending", async () => {
    pool.query.mockResolvedValueOnce({ rows: [{ id: "log1", pending_approval: false, approval_status: null }] });

    const res = await request(app)
      .patch("/api/audit-logs/log1/review")
      .set("Authorization", adminHeader)
      .send({ decision: "approved" });

    expect(res.status).toBe(400);
  });

  it("rejects a double-review attempt on an already-reviewed row", async () => {
    pool.query.mockResolvedValueOnce({
      rows: [{ id: "log1", pending_approval: true, approval_status: "approved" }],
    });

    const res = await request(app)
      .patch("/api/audit-logs/log1/review")
      .set("Authorization", adminHeader)
      .send({ decision: "rejected" });

    expect(res.status).toBe(400);
  });

  it("approves a pending row and records who reviewed it", async () => {
    pool.query
      .mockResolvedValueOnce({ rows: [{ id: "log1", pending_approval: true, approval_status: null }] })
      .mockResolvedValueOnce({
        rows: [
          {
            id: "log1",
            decision: "ALLOW",
            pending_approval: true,
            approval_status: "approved",
            reviewed_by: "admin-1",
            reviewed_at: new Date().toISOString(),
          },
        ],
      });

    const res = await request(app)
      .patch("/api/audit-logs/log1/review")
      .set("Authorization", adminHeader)
      .send({ decision: "approved" });

    expect(res.status).toBe(200);
    expect(res.body.log).toMatchObject({ approval_status: "approved", reviewed_by: "admin-1" });

    const [updateSql, updateParams] = pool.query.mock.calls[1];
    expect(updateSql).toContain("UPDATE audit_logs");
    expect(updateParams).toEqual(["approved", "admin-1", "log1"]);
  });

  it("rejects a pending row", async () => {
    pool.query
      .mockResolvedValueOnce({ rows: [{ id: "log2", pending_approval: true, approval_status: null }] })
      .mockResolvedValueOnce({
        rows: [
          {
            id: "log2",
            decision: "ALLOW",
            pending_approval: true,
            approval_status: "rejected",
            reviewed_by: "admin-1",
            reviewed_at: new Date().toISOString(),
          },
        ],
      });

    const res = await request(app)
      .patch("/api/audit-logs/log2/review")
      .set("Authorization", adminHeader)
      .send({ decision: "rejected" });

    expect(res.status).toBe(200);
    expect(res.body.log.approval_status).toBe("rejected");
  });
});

describe("POST /api/audit-logs/:id/execute", () => {
  it("requires admin role", async () => {
    const res = await request(app).post("/api/audit-logs/log1/execute").set("Authorization", authHeader);
    expect(res.status).toBe(403);
    expect(executeQuerySafely).not.toHaveBeenCalled();
  });

  it("returns 404 when the audit log entry doesn't exist", async () => {
    pool.query.mockResolvedValueOnce({ rows: [] });

    const res = await request(app).post("/api/audit-logs/nope/execute").set("Authorization", adminHeader);

    expect(res.status).toBe(404);
    expect(executeQuerySafely).not.toHaveBeenCalled();
  });

  it("refuses to execute an entry that hasn't been approved", async () => {
    pool.query.mockResolvedValueOnce({
      rows: [{ id: "log1", user_id: "u1", raw_query: "SELECT 1", approval_status: null }],
    });

    const res = await request(app).post("/api/audit-logs/log1/execute").set("Authorization", adminHeader);

    expect(res.status).toBe(400);
    expect(executeQuerySafely).not.toHaveBeenCalled();
  });

  it("refuses a non-SELECT even though it was approved (e.g. a developer's DELETE)", async () => {
    pool.query
      .mockResolvedValueOnce({
        rows: [
          {
            id: "log1",
            user_id: "u1",
            raw_query: "DELETE FROM orders WHERE id = 1",
            approval_status: "approved",
          },
        ],
      }) // SELECT the audit log row
      .mockResolvedValueOnce({ rows: [{ role: "developer" }] }); // submitter's current role

    const res = await request(app).post("/api/audit-logs/log1/execute").set("Authorization", adminHeader);

    expect(res.status).toBe(400);
    expect(res.body.operation).toBe("DELETE");
    expect(executeQuerySafely).not.toHaveBeenCalled();
  });

  it("refuses a SELECT whose policy now denies it for the submitter's current role, even though it was approved", async () => {
    pool.query
      .mockResolvedValueOnce({
        rows: [
          {
            id: "log1",
            user_id: "u1",
            raw_query: "SELECT id FROM customers WHERE id = 1",
            approval_status: "approved",
          },
        ],
      })
      .mockResolvedValueOnce({ rows: [{ role: "developer" }] })
      .mockResolvedValueOnce({ rows: [{ table_name: "customers", allowed: false, requires_approval: false }] });

    const res = await request(app).post("/api/audit-logs/log1/execute").set("Authorization", adminHeader);

    expect(res.status).toBe(400);
    expect(executeQuerySafely).not.toHaveBeenCalled();
  });

  it("does NOT re-block on requires_approval alone -- an approved SELECT under a requires_approval policy still executes", async () => {
    // This is exactly the case a naive re-validation-via-makeDecision would
    // get wrong: the policy that originally required approval still says
    // requires_approval=true on every fresh check, forever. What must
    // matter here is that it's already approval_status='approved' (checked
    // above) and still policy.allowed=true -- not whether a fresh check
    // would, in the abstract, ask for approval again.
    pool.query
      .mockResolvedValueOnce({
        rows: [
          {
            id: "log1",
            user_id: "u1",
            raw_query: "SELECT id FROM customers WHERE id = 1",
            approval_status: "approved",
          },
        ],
      })
      .mockResolvedValueOnce({ rows: [{ role: "developer" }] })
      .mockResolvedValueOnce({ rows: [{ table_name: "customers", allowed: true, requires_approval: true }] })
      .mockResolvedValueOnce({ rows: [] }); // UPDATE execution_time_ms

    const res = await request(app).post("/api/audit-logs/log1/execute").set("Authorization", adminHeader);

    expect(res.status).toBe(200);
    expect(executeQuerySafely).toHaveBeenCalledWith("SELECT id FROM customers WHERE id = 1");
  });

  it("executes an approved, still-eligible SELECT and records execution_time_ms on the audit log row", async () => {
    pool.query
      .mockResolvedValueOnce({
        rows: [
          {
            id: "log1",
            user_id: "u1",
            raw_query: "SELECT id FROM users WHERE id = 1",
            approval_status: "approved",
          },
        ],
      })
      .mockResolvedValueOnce({ rows: [{ role: "intern" }] })
      .mockResolvedValueOnce({ rows: [{ table_name: "*", allowed: true, requires_approval: false }] })
      .mockResolvedValueOnce({ rows: [] }); // UPDATE execution_time_ms

    const res = await request(app).post("/api/audit-logs/log1/execute").set("Authorization", adminHeader);

    expect(res.status).toBe(200);
    expect(executeQuerySafely).toHaveBeenCalledWith("SELECT id FROM users WHERE id = 1");
    expect(res.body).toMatchObject({ rowCount: 1, truncated: false });

    const [updateSql, updateParams] = pool.query.mock.calls[3];
    expect(updateSql).toContain("UPDATE audit_logs");
    expect(updateParams).toEqual([5, "log1"]);
  });
});
