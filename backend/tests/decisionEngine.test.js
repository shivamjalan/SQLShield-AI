jest.mock("../src/db/pool", () => ({ query: jest.fn() }));
jest.mock("../src/engines/aiEngine", () => ({ getAiRiskExplanation: jest.fn() }));

const pool = require("../src/db/pool");
const { getAiRiskExplanation } = require("../src/engines/aiEngine");
const { makeDecision } = require("../src/engines/decisionEngine");

function baseParsed(overrides = {}) {
  return {
    raw: "SELECT id FROM orders WHERE id = 1",
    operation: "SELECT",
    tablesReferenced: ["orders"],
    hasWhereClause: true,
    columnsReferenced: ["id"],
    statementCount: 1,
    parseError: null,
    ...overrides,
  };
}

function mockPolicyRows(rows) {
  pool.query.mockResolvedValueOnce({ rows });
}

afterEach(() => jest.clearAllMocks());

describe("makeDecision", () => {
  it("BLOCKs CRITICAL risk without ever calling the policy DB or the AI engine", async () => {
    const parsed = baseParsed({ operation: "DELETE", hasWhereClause: false });

    const result = await makeDecision(parsed, "admin");

    expect(result.decision).toBe("BLOCK");
    expect(result.riskLevel).toBe("CRITICAL");
    expect(pool.query).not.toHaveBeenCalled();
    expect(getAiRiskExplanation).not.toHaveBeenCalled();
    expect(result.aiExplanation).toBeNull();
  });

  it("BLOCKs a policy-denied query without calling the AI engine", async () => {
    mockPolicyRows([{ table_name: "*", allowed: false, requires_approval: false }]);

    const result = await makeDecision(baseParsed({ operation: "INSERT" }), "intern");

    expect(result.decision).toBe("BLOCK");
    expect(getAiRiskExplanation).not.toHaveBeenCalled();
  });

  it("ALLOWs LOW risk with no approval needed without calling the AI engine", async () => {
    mockPolicyRows([{ table_name: "*", allowed: true, requires_approval: false }]);

    const result = await makeDecision(baseParsed(), "developer");

    expect(result.decision).toBe("ALLOW");
    expect(result.riskLevel).toBe("LOW");
    expect(getAiRiskExplanation).not.toHaveBeenCalled();
    expect(result.aiExplanation).toBeNull();
  });

  it("calls the AI engine and stores its explanation for MEDIUM risk", async () => {
    mockPolicyRows([{ table_name: "*", allowed: true, requires_approval: false }]);
    getAiRiskExplanation.mockResolvedValueOnce({
      explanation: "This touches many tables at once.",
      suggestedRewrite: null,
      error: null,
    });

    const parsed = baseParsed({ tablesReferenced: ["a", "b", "c", "d"] });
    const result = await makeDecision(parsed, "developer");

    expect(getAiRiskExplanation).toHaveBeenCalledTimes(1);
    expect(result.riskLevel).toBe("MEDIUM");
    expect(result.decision).toBe("ALLOW");
    expect(result.aiExplanation).toBe("This touches many tables at once.");
    expect(result.suggestedRewrite).toBeNull();
  });

  it("calls the AI engine for LOW risk that requires approval, and AI does not decide the outcome", async () => {
    mockPolicyRows([{ table_name: "*", allowed: true, requires_approval: true }]);
    getAiRiskExplanation.mockResolvedValueOnce({
      explanation: "Deletes are sensitive even with a WHERE clause.",
      suggestedRewrite: null,
      error: null,
    });

    const result = await makeDecision(baseParsed({ operation: "DELETE" }), "developer");

    expect(getAiRiskExplanation).toHaveBeenCalledTimes(1);
    expect(result.decision).toBe("ALLOW");
    expect(result.pendingApproval).toBe(true);
    expect(result.aiExplanation).toMatch(/Deletes are sensitive/);
  });

  it("promotes to REWRITE when the AI's suggested rewrite independently passes security+policy", async () => {
    // First pool.query call resolves the original query's policy lookup,
    // second resolves the rewrite's own re-validation.
    mockPolicyRows([{ table_name: "*", allowed: true, requires_approval: false }]);
    mockPolicyRows([{ table_name: "*", allowed: true, requires_approval: false }]);
    getAiRiskExplanation.mockResolvedValueOnce({
      explanation: "Unfiltered SELECT * is wasteful.",
      suggestedRewrite: "SELECT id, status FROM orders WHERE status = 'open'",
      error: null,
    });

    const parsed = baseParsed({ tablesReferenced: ["a", "b", "c", "d"] });
    const result = await makeDecision(parsed, "developer");

    expect(result.decision).toBe("REWRITE");
    expect(result.rewrittenQuery).toBe("SELECT id, status FROM orders WHERE status = 'open'");
    expect(result.suggestedRewrite).toBe(result.rewrittenQuery);
  });

  it("does NOT promote to REWRITE when the AI's suggested rewrite fails its own security check", async () => {
    mockPolicyRows([{ table_name: "*", allowed: true, requires_approval: false }]);
    getAiRiskExplanation.mockResolvedValueOnce({
      explanation: "Unfiltered SELECT * is wasteful.",
      suggestedRewrite: "DELETE FROM orders",
      error: null,
    });

    const parsed = baseParsed({ tablesReferenced: ["a", "b", "c", "d"] });
    const result = await makeDecision(parsed, "developer");

    expect(result.decision).toBe("ALLOW");
    expect(result.rewrittenQuery).toBeNull();
    expect(result.suggestedRewrite).toBe("DELETE FROM orders");
  });

  it("does NOT promote to REWRITE when the AI's suggested rewrite is policy-denied for this role", async () => {
    mockPolicyRows([{ table_name: "*", allowed: true, requires_approval: false }]);
    mockPolicyRows([{ table_name: "*", allowed: false, requires_approval: false }]);
    getAiRiskExplanation.mockResolvedValueOnce({
      explanation: "Unfiltered SELECT * is wasteful.",
      suggestedRewrite: "INSERT INTO orders (id) VALUES (1)",
      error: null,
    });

    const parsed = baseParsed({ tablesReferenced: ["a", "b", "c", "d"] });
    const result = await makeDecision(parsed, "intern");

    expect(result.decision).toBe("ALLOW");
    expect(result.rewrittenQuery).toBeNull();
  });
});
