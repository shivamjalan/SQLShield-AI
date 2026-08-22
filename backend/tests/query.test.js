process.env.JWT_SECRET = "test-secret-do-not-use-in-prod";
process.env.DATABASE_URL = "postgresql://unused:unused@localhost:5432/unused";

// Mirrors seedPolicies.js's defaults so the policy engine's DB lookup
// resolves realistically without a live Postgres connection.
const SEEDED_POLICIES = [
  { role: "intern", table_name: "*", operation: "SELECT", allowed: true, requires_approval: false },
  { role: "intern", table_name: "*", operation: "INSERT", allowed: false, requires_approval: false },
  { role: "developer", table_name: "*", operation: "SELECT", allowed: true, requires_approval: false },
  { role: "developer", table_name: "*", operation: "INSERT", allowed: true, requires_approval: false },
  { role: "developer", table_name: "*", operation: "DELETE", allowed: true, requires_approval: true },
  { role: "developer", table_name: "policies", operation: "INSERT", allowed: false, requires_approval: false },
];

// query_history/audit_logs writes and the policies lookup are mocked here
// so this suite runs without a live Postgres connection — it's testing the
// route/engines, not `pg` itself.
jest.mock("../src/db/pool", () => ({
  query: jest.fn(async (text, params = []) => {
    if (text.includes("FROM policies")) {
      const [role, operation] = params;
      const rows = SEEDED_POLICIES.filter((p) => p.role === role && p.operation === operation);
      return { rows };
    }
    return { rows: [] };
  }),
}));

// This suite is about the deterministic route/engine wiring, not the LLM --
// mocking aiEngine here means a MEDIUM-risk or requiresApproval query never
// makes a real network call.
jest.mock("../src/engines/aiEngine", () => ({
  getAiRiskExplanation: jest.fn(async () => ({
    explanation: "mocked AI explanation",
    suggestedRewrite: null,
    error: null,
  })),
}));

// This suite is about routing/wiring (does execution run when and only
// when it should), not the executor's own guardrail logic -- that's
// covered live against real Postgres in tests/executor.test.js. Mocking
// it here lets these tests assert exactly whether it was called, without
// a target_db dependency.
jest.mock("../src/engines/executor", () => ({
  executeQuerySafely: jest.fn(async () => ({
    rows: [{ id: 1 }],
    rowCount: 1,
    truncated: false,
    executionTimeMs: 1,
    error: null,
  })),
}));

// Rate limiting itself is covered by tests/rateLimit.test.js -- this suite
// mocks it out entirely so it runs without a live Redis connection and
// isn't affected by request counts across test cases.
jest.mock("../src/config/redis", () => ({
  redis: { incr: jest.fn(), expire: jest.fn() },
  rateLimit: (req, res, next) => next(),
}));

const request = require("supertest");
const { getAiRiskExplanation } = require("../src/engines/aiEngine");
const { executeQuerySafely } = require("../src/engines/executor");
const app = require("../src/server");
const { signAccessToken } = require("../src/auth/jwt");

const testUser = { id: "test-user-1", email: "dev@example.com", role: "developer" };
const authHeader = `Bearer ${signAccessToken(testUser)}`;

function postQuery(sql) {
  return request(app).post("/api/query").set("Authorization", authHeader).send({ query: sql });
}

function postQueryAs(role, sql) {
  const header = `Bearer ${signAccessToken({ id: `test-${role}`, email: `${role}@example.com`, role })}`;
  return request(app).post("/api/query").set("Authorization", header).send({ query: sql });
}

afterEach(() => jest.clearAllMocks());

describe("POST /api/query", () => {
  it("requires authentication", async () => {
    const res = await request(app).post("/api/query").send({ query: "SELECT 1" });
    expect(res.status).toBe(401);
  });

  it("requires a query in the body", async () => {
    const res = await request(app).post("/api/query").set("Authorization", authHeader).send({});
    expect(res.status).toBe(400);
  });

  it("assesses a safe SELECT as LOW risk", async () => {
    const res = await postQuery("SELECT id, email FROM users WHERE id = 1");

    expect(res.status).toBe(200);
    expect(res.body.riskLevel).toBe("LOW");
    expect(res.body.parsed.operation).toBe("SELECT");
    expect(res.body.parsed.hasWhereClause).toBe(true);
  });

  it("assesses an unsafe DELETE without WHERE as CRITICAL", async () => {
    const res = await postQuery("DELETE FROM users");

    expect(res.status).toBe(200);
    expect(res.body.riskLevel).toBe("CRITICAL");
    expect(res.body.reasons).toEqual(
      expect.arrayContaining([expect.stringContaining("DELETE without WHERE")])
    );
  });

  it("assesses a DROP TABLE as CRITICAL", async () => {
    const res = await postQuery("DROP TABLE users");

    expect(res.status).toBe(200);
    expect(res.body.riskLevel).toBe("CRITICAL");
    expect(res.body.reasons).toEqual(
      expect.arrayContaining([expect.stringContaining("DROP")])
    );
  });

  it("assesses an injection-pattern query (stacked statement + comment) as HIGH or above", async () => {
    const res = await postQuery("SELECT * FROM users WHERE id = 1; DROP TABLE users; --");

    expect(res.status).toBe(200);
    // Stacked queries alone -> HIGH; this sample also drops a table -> CRITICAL.
    expect(["HIGH", "CRITICAL"]).toContain(res.body.riskLevel);
    expect(res.body.reasons.length).toBeGreaterThan(0);
  });

  it("CRITICAL risk blocks regardless of role, before the policy engine runs", async () => {
    const res = await postQueryAs("admin", "DELETE FROM users");

    expect(res.status).toBe(200);
    expect(res.body.decision.decision).toBe("BLOCK");
  });

  it("does not call the AI engine for a CRITICAL or LOW-risk query", async () => {
    await postQueryAs("admin", "DELETE FROM users");
    await postQuery("SELECT id, email FROM users WHERE id = 1");

    expect(getAiRiskExplanation).not.toHaveBeenCalled();
  });
});

describe("Policy engine wired into POST /api/query", () => {
  it("blocks an intern's INSERT", async () => {
    const res = await postQueryAs("intern", "INSERT INTO orders (id) VALUES (1)");

    expect(res.status).toBe(200);
    expect(res.body.decision.decision).toBe("BLOCK");
    expect(res.body.decision.reasons).toEqual(
      expect.arrayContaining([expect.stringContaining("not permitted")])
    );
  });

  it("allows a developer's INSERT", async () => {
    const res = await postQueryAs("developer", "INSERT INTO orders (id) VALUES (1)");

    expect(res.status).toBe(200);
    expect(res.body.decision.decision).toBe("ALLOW");
    expect(res.body.decision.pendingApproval).toBe(false);
  });

  it("flags a developer's DELETE (with WHERE, so not CRITICAL) as pendingApproval, and calls the AI engine for the explanation", async () => {
    const res = await postQueryAs("developer", "DELETE FROM orders WHERE id = 1");

    expect(res.status).toBe(200);
    expect(res.body.decision.decision).toBe("ALLOW");
    expect(res.body.decision.pendingApproval).toBe(true);
    expect(res.body.decision.aiExplanation).toBe("mocked AI explanation");
    expect(getAiRiskExplanation).toHaveBeenCalledTimes(1);
  });

  it("blocks a developer's INSERT into the policies table even though generic INSERT is allowed (table-specific deny overrides the wildcard)", async () => {
    const res = await postQueryAs(
      "developer",
      "INSERT INTO policies (role, table_name, operation, allowed) VALUES ('x', '*', 'SELECT', true)"
    );

    expect(res.status).toBe(200);
    expect(res.body.decision.decision).toBe("BLOCK");
    expect(res.body.decision.reasons).toEqual(
      expect.arrayContaining([expect.stringContaining("not permitted")])
    );
  });
});

describe("Query execution wiring in POST /api/query", () => {
  it("executes a safe, ALLOWed SELECT and includes the execution field in the response", async () => {
    const res = await postQuery("SELECT id, email FROM users WHERE id = 1");

    expect(res.status).toBe(200);
    expect(res.body.decision.decision).toBe("ALLOW");
    expect(executeQuerySafely).toHaveBeenCalledTimes(1);
    expect(res.body.execution).toMatchObject({ rowCount: 1, truncated: false });
  });

  it("never executes a BLOCKed query", async () => {
    const res = await postQueryAs("intern", "INSERT INTO orders (id) VALUES (1)");

    expect(res.status).toBe(200);
    expect(res.body.decision.decision).toBe("BLOCK");
    expect(executeQuerySafely).not.toHaveBeenCalled();
    expect(res.body.execution).toBeNull();
  });

  it("never executes a non-SELECT operation even when policy ALLOWs it for the role", async () => {
    const res = await postQueryAs("developer", "INSERT INTO orders (id) VALUES (1)");

    expect(res.status).toBe(200);
    expect(res.body.decision.decision).toBe("ALLOW");
    expect(executeQuerySafely).not.toHaveBeenCalled();
    expect(res.body.execution).toBeNull();
  });

  it("never executes a query flagged pendingApproval, even though its decision is ALLOW", async () => {
    const res = await postQueryAs("developer", "DELETE FROM orders WHERE id = 1");

    expect(res.status).toBe(200);
    expect(res.body.decision.decision).toBe("ALLOW");
    expect(res.body.decision.pendingApproval).toBe(true);
    expect(executeQuerySafely).not.toHaveBeenCalled();
    expect(res.body.execution).toBeNull();
  });
});
