process.env.JWT_SECRET = "test-secret-do-not-use-in-prod";
process.env.DATABASE_URL = "postgresql://unused:unused@localhost:5432/unused";

jest.mock("../src/db/pool", () => ({ query: jest.fn() }));

const request = require("supertest");
const pool = require("../src/db/pool");
const app = require("../src/server");
const { signAccessToken } = require("../src/auth/jwt");

const adminHeader = `Bearer ${signAccessToken({ id: "admin-1", email: "admin@example.com", role: "admin" })}`;
const devHeader = `Bearer ${signAccessToken({ id: "dev-1", email: "dev@example.com", role: "developer" })}`;

afterEach(() => jest.clearAllMocks());

describe("GET /api/users", () => {
  it("requires admin role", async () => {
    const res = await request(app).get("/api/users").set("Authorization", devHeader);
    expect(res.status).toBe(403);
  });

  it("lists users for an admin", async () => {
    pool.query.mockResolvedValueOnce({
      rows: [{ id: "u1", email: "a@example.com", role: "intern", created_at: new Date().toISOString() }],
    });

    const res = await request(app).get("/api/users").set("Authorization", adminHeader);

    expect(res.status).toBe(200);
    expect(res.body.users).toHaveLength(1);
    expect(res.body.users[0]).toMatchObject({ email: "a@example.com", role: "intern" });
  });
});

describe("PATCH /api/users/:id/role", () => {
  it("rejects a non-admin with 403", async () => {
    const res = await request(app)
      .patch("/api/users/u1/role")
      .set("Authorization", devHeader)
      .send({ role: "admin" });

    expect(res.status).toBe(403);
    expect(pool.query).not.toHaveBeenCalled();
  });

  it("rejects a role outside the allowed set", async () => {
    const res = await request(app)
      .patch("/api/users/u1/role")
      .set("Authorization", adminHeader)
      .send({ role: "superuser" });

    expect(res.status).toBe(400);
  });

  it("returns 404 for a user that doesn't exist", async () => {
    pool.query.mockResolvedValueOnce({ rows: [] });

    const res = await request(app)
      .patch("/api/users/nope/role")
      .set("Authorization", adminHeader)
      .send({ role: "developer" });

    expect(res.status).toBe(404);
  });

  it("promotes a user and writes an audit record to role_change_logs", async () => {
    pool.query
      .mockResolvedValueOnce({ rows: [{ id: "u1", role: "intern" }] }) // SELECT current role
      .mockResolvedValueOnce({
        rows: [{ id: "u1", email: "u1@example.com", role: "developer", created_at: new Date().toISOString() }],
      }) // UPDATE ... RETURNING
      .mockResolvedValueOnce({ rows: [] }); // INSERT INTO role_change_logs

    const res = await request(app)
      .patch("/api/users/u1/role")
      .set("Authorization", adminHeader)
      .send({ role: "developer" });

    expect(res.status).toBe(200);
    expect(res.body.user).toMatchObject({ id: "u1", role: "developer" });

    const [auditSql, auditParams] = pool.query.mock.calls[2];
    expect(auditSql).toContain("INSERT INTO role_change_logs");
    expect(auditParams).toEqual(["admin-1", "u1", "intern", "developer"]);
  });
});
