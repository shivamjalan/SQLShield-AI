process.env.JWT_SECRET = "test-secret-do-not-use-in-prod";
process.env.DATABASE_URL = "postgresql://unused:unused@localhost:5432/unused";

jest.mock("../src/db/pool", () => ({ query: jest.fn() }));

const request = require("supertest");
const pool = require("../src/db/pool");
const app = require("../src/server");
const { signAccessToken } = require("../src/auth/jwt");

const authHeader = `Bearer ${signAccessToken({ id: "u1", email: "dev@example.com", role: "developer" })}`;

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
