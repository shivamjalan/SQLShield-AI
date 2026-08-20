jest.mock("../src/db/pool", () => ({ query: jest.fn() }));

const pool = require("../src/db/pool");
const { checkPolicy } = require("../src/engines/policyEngine");

function baseParsed(overrides = {}) {
  return { operation: "SELECT", tablesReferenced: ["orders"], ...overrides };
}

function mockPolicyRows(rows) {
  pool.query.mockResolvedValueOnce({ rows });
}

afterEach(() => jest.clearAllMocks());

describe("checkPolicy", () => {
  it("blocks an intern's INSERT", async () => {
    mockPolicyRows([{ table_name: "*", allowed: false, requires_approval: false }]);

    const result = await checkPolicy("intern", baseParsed({ operation: "INSERT" }));

    expect(result.allowed).toBe(false);
    expect(result.reasons[0]).toMatch(/not permitted/);
  });

  it("allows a developer's INSERT", async () => {
    mockPolicyRows([{ table_name: "*", allowed: true, requires_approval: false }]);

    const result = await checkPolicy("developer", baseParsed({ operation: "INSERT" }));

    expect(result.allowed).toBe(true);
    expect(result.requiresApproval).toBe(false);
  });

  it("flags a developer's DELETE as requiring approval", async () => {
    mockPolicyRows([{ table_name: "*", allowed: true, requires_approval: true }]);

    const result = await checkPolicy("developer", baseParsed({ operation: "DELETE" }));

    expect(result.allowed).toBe(true);
    expect(result.requiresApproval).toBe(true);
  });

  it("allows an admin's DROP", async () => {
    mockPolicyRows([{ table_name: "*", allowed: true, requires_approval: false }]);

    const result = await checkPolicy("admin", baseParsed({ operation: "DROP" }));

    expect(result.allowed).toBe(true);
  });

  it("prefers an exact table_name match over the '*' wildcard", async () => {
    // developer has a blanket SELECT allow ('*'), but a specific deny for
    // finance_reports -- the exact row must win.
    mockPolicyRows([
      { table_name: "*", allowed: true, requires_approval: false },
      { table_name: "finance_reports", allowed: false, requires_approval: false },
    ]);

    const result = await checkPolicy(
      "developer",
      baseParsed({ operation: "SELECT", tablesReferenced: ["finance_reports"] })
    );

    expect(result.allowed).toBe(false);
  });

  it("falls back to the '*' wildcard when no exact table row exists", async () => {
    // Only a wildcard row exists for (intern, SELECT) -- a query against
    // 'orders', which has no row of its own, resolves against it.
    mockPolicyRows([{ table_name: "*", allowed: true, requires_approval: false }]);

    const result = await checkPolicy(
      "intern",
      baseParsed({ operation: "SELECT", tablesReferenced: ["orders"] })
    );

    expect(result.allowed).toBe(true);
  });

  it("defaults to deny when no policy row matches at all", async () => {
    mockPolicyRows([]);

    const result = await checkPolicy("intern", baseParsed({ operation: "SELECT" }));

    expect(result.allowed).toBe(false);
    expect(result.reasons[0]).toMatch(/default/i);
  });
});
