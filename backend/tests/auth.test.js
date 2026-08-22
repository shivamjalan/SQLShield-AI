process.env.JWT_SECRET = "test-secret-do-not-use-in-prod";
process.env.DATABASE_URL = "postgresql://unused:unused@localhost:5432/unused";

// The DB layer is mocked here so this suite runs without a live Postgres
// connection — it's testing the auth routes/middleware, not `pg` itself.
jest.mock("../src/db/pool", () => {
  const users = [];
  let idCounter = 1;

  return {
    query: jest.fn(async (text, params = []) => {
      if (text.includes("INSERT INTO users")) {
        // /auth/register hardcodes 'intern' in the SQL text itself (not a
        // bound param) — mirror that here so this mock matches the real
        // query shape: only email/password_hash are ever passed in.
        const [email, password_hash] = params;
        if (users.some((u) => u.email === email)) {
          const err = new Error("duplicate key value violates unique constraint");
          err.code = "23505";
          throw err;
        }
        const user = {
          id: `test-id-${idCounter++}`,
          email,
          password_hash,
          role: "intern",
          created_at: new Date().toISOString(),
        };
        users.push(user);
        return {
          rows: [{ id: user.id, email: user.email, role: user.role, created_at: user.created_at }],
        };
      }

      if (text.includes("SELECT id, email, password_hash, role FROM users WHERE email")) {
        const [email] = params;
        const user = users.find((u) => u.email === email);
        return { rows: user ? [user] : [] };
      }

      if (text.includes("SELECT id, email, role FROM users WHERE id")) {
        const [id] = params;
        const user = users.find((u) => u.id === id);
        return { rows: user ? [{ id: user.id, email: user.email, role: user.role }] : [] };
      }

      return { rows: [] };
    }),
  };
});

const request = require("supertest");
const app = require("../src/server");

describe("POST /auth/register", () => {
  it("creates a user and never returns the password hash", async () => {
    const res = await request(app)
      .post("/auth/register")
      .send({ email: "alice@example.com", password: "hunter2" });

    expect(res.status).toBe(201);
    expect(res.body.user).toMatchObject({ email: "alice@example.com", role: "intern" });
    expect(res.body.user.password_hash).toBeUndefined();
  });

  it("ignores a role field sent in the body — every self-registered user is 'intern'", async () => {
    const res = await request(app)
      .post("/auth/register")
      .send({ email: "eve@example.com", password: "hunter2", role: "admin" });

    expect(res.status).toBe(201);
    expect(res.body.user.role).toBe("intern");
  });

  it("rejects a duplicate email with 409", async () => {
    await request(app)
      .post("/auth/register")
      .send({ email: "bob@example.com", password: "hunter2" });

    const res = await request(app)
      .post("/auth/register")
      .send({ email: "bob@example.com", password: "different" });

    expect(res.status).toBe(409);
  });

  it("rejects a missing password with 400", async () => {
    const res = await request(app).post("/auth/register").send({ email: "no-pw@example.com" });
    expect(res.status).toBe(400);
  });
});

describe("POST /auth/login and GET /api/me", () => {
  beforeAll(async () => {
    await request(app)
      .post("/auth/register")
      .send({ email: "carol@example.com", password: "correct-horse", role: "intern" });
  });

  it("logs in with correct credentials and returns tokens", async () => {
    const res = await request(app)
      .post("/auth/login")
      .send({ email: "carol@example.com", password: "correct-horse" });

    expect(res.status).toBe(200);
    expect(res.body.accessToken).toEqual(expect.any(String));
    expect(res.body.refreshToken).toEqual(expect.any(String));
    expect(res.body.user).toMatchObject({ email: "carol@example.com", role: "intern" });
  });

  it("rejects an incorrect password", async () => {
    const res = await request(app)
      .post("/auth/login")
      .send({ email: "carol@example.com", password: "wrong" });

    expect(res.status).toBe(401);
  });

  it("allows access to /api/me with a valid access token", async () => {
    const loginRes = await request(app)
      .post("/auth/login")
      .send({ email: "carol@example.com", password: "correct-horse" });

    const meRes = await request(app)
      .get("/api/me")
      .set("Authorization", `Bearer ${loginRes.body.accessToken}`);

    expect(meRes.status).toBe(200);
    expect(meRes.body.user).toMatchObject({ email: "carol@example.com", role: "intern" });
  });

  it("rejects /api/me with no token", async () => {
    const res = await request(app).get("/api/me");
    expect(res.status).toBe(401);
  });

  it("rejects /api/me with a garbage token", async () => {
    const res = await request(app).get("/api/me").set("Authorization", "Bearer not-a-real-token");
    expect(res.status).toBe(401);
  });
});

describe("POST /auth/refresh", () => {
  it("exchanges a valid refresh token for a new access token", async () => {
    await request(app)
      .post("/auth/register")
      .send({ email: "dave@example.com", password: "swordfish", role: "admin" });

    const loginRes = await request(app)
      .post("/auth/login")
      .send({ email: "dave@example.com", password: "swordfish" });

    const refreshRes = await request(app)
      .post("/auth/refresh")
      .send({ refreshToken: loginRes.body.refreshToken });

    expect(refreshRes.status).toBe(200);
    expect(refreshRes.body.accessToken).toEqual(expect.any(String));

    const meRes = await request(app)
      .get("/api/me")
      .set("Authorization", `Bearer ${refreshRes.body.accessToken}`);
    expect(meRes.status).toBe(200);
    expect(meRes.body.user.email).toBe("dave@example.com");
  });

  it("rejects an access token used as a refresh token", async () => {
    const loginRes = await request(app)
      .post("/auth/login")
      .send({ email: "dave@example.com", password: "swordfish" });

    const res = await request(app)
      .post("/auth/refresh")
      .send({ refreshToken: loginRes.body.accessToken });

    expect(res.status).toBe(401);
  });
});
