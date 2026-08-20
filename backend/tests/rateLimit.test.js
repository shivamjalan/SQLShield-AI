process.env.REDIS_URL = "redis://unused:6379";

const mockIncr = jest.fn();
const mockExpire = jest.fn();

// Mirrors how aiEngine.test.js mocks the `openai` package -- ioredis's
// constructor is mocked so this suite exercises the rateLimit middleware's
// own logic without opening a real socket.
jest.mock("ioredis", () => {
  return jest.fn().mockImplementation(() => ({
    incr: mockIncr,
    expire: mockExpire,
    on: jest.fn(),
  }));
});

const { rateLimit } = require("../src/config/redis");

function mockReqRes(userId = "user-1") {
  const req = { user: { id: userId } };
  const res = { status: jest.fn().mockReturnThis(), json: jest.fn() };
  const next = jest.fn();
  return { req, res, next };
}

afterEach(() => jest.clearAllMocks());

describe("rateLimit middleware", () => {
  it("allows a request under the limit and sets an expiry on the first request in the window", async () => {
    mockIncr.mockResolvedValueOnce(1);
    mockExpire.mockResolvedValueOnce(1);
    const { req, res, next } = mockReqRes();

    await rateLimit(req, res, next);

    expect(next).toHaveBeenCalled();
    expect(mockExpire).toHaveBeenCalledWith(expect.stringContaining("user-1"), 60);
    expect(res.status).not.toHaveBeenCalled();
  });

  it("does not reset the expiry on subsequent requests in the same window", async () => {
    mockIncr.mockResolvedValueOnce(5);
    const { req, res, next } = mockReqRes();

    await rateLimit(req, res, next);

    expect(mockExpire).not.toHaveBeenCalled();
    expect(next).toHaveBeenCalled();
  });

  it("returns 429 once the per-minute limit is exceeded", async () => {
    mockIncr.mockResolvedValueOnce(31);
    const { req, res, next } = mockReqRes();

    await rateLimit(req, res, next);

    expect(res.status).toHaveBeenCalledWith(429);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ error: expect.stringContaining("Rate limit") }));
    expect(next).not.toHaveBeenCalled();
  });

  it("scopes the rate limit key per user", async () => {
    mockIncr.mockResolvedValueOnce(1);
    mockExpire.mockResolvedValueOnce(1);
    const { req, res, next } = mockReqRes("user-2");

    await rateLimit(req, res, next);

    expect(mockIncr).toHaveBeenCalledWith(expect.stringContaining("user-2"));
    expect(next).toHaveBeenCalled();
  });

  it("fails open (allows the request through) if Redis errors", async () => {
    mockIncr.mockRejectedValueOnce(new Error("connection refused"));
    const { req, res, next } = mockReqRes();

    await rateLimit(req, res, next);

    expect(next).toHaveBeenCalled();
    expect(res.status).not.toHaveBeenCalled();
  });
});
