const { runSecurityChecks } = require("../src/engines/securityEngine");

function baseParsed(overrides = {}) {
  return {
    raw: "SELECT id FROM users WHERE id = 1",
    operation: "SELECT",
    tablesReferenced: ["users"],
    hasWhereClause: true,
    columnsReferenced: ["id"],
    statementCount: 1,
    parseError: null,
    ...overrides,
  };
}

describe("runSecurityChecks", () => {
  it("treats a safe, explicit-column SELECT with a WHERE clause as LOW risk", () => {
    const result = runSecurityChecks(baseParsed());
    expect(result.riskLevel).toBe("LOW");
    expect(result.reasons).toEqual([]);
  });

  it("flags DELETE without WHERE as CRITICAL", () => {
    const result = runSecurityChecks(
      baseParsed({ raw: "DELETE FROM users", operation: "DELETE", hasWhereClause: false })
    );
    expect(result.riskLevel).toBe("CRITICAL");
    expect(result.reasons).toEqual(
      expect.arrayContaining([expect.stringContaining("DELETE without WHERE")])
    );
  });

  it("flags UPDATE without WHERE as CRITICAL", () => {
    const result = runSecurityChecks(
      baseParsed({ raw: "UPDATE users SET role = 'admin'", operation: "UPDATE", hasWhereClause: false })
    );
    expect(result.riskLevel).toBe("CRITICAL");
  });

  it("flags DROP TABLE as CRITICAL", () => {
    const result = runSecurityChecks(
      baseParsed({ raw: "DROP TABLE users", operation: "DROP", hasWhereClause: false })
    );
    expect(result.riskLevel).toBe("CRITICAL");
    expect(result.reasons).toEqual(
      expect.arrayContaining([expect.stringContaining("DROP")])
    );
  });

  it("flags a parse error as CRITICAL with 'unparseable query'", () => {
    const result = runSecurityChecks(
      baseParsed({ operation: "UNKNOWN", parseError: "Expected ... but found ..." })
    );
    expect(result.riskLevel).toBe("CRITICAL");
    expect(result.reasons).toEqual(["unparseable query"]);
  });

  it("flags queries touching more than 3 tables as MEDIUM", () => {
    const result = runSecurityChecks(
      baseParsed({ tablesReferenced: ["a", "b", "c", "d"] })
    );
    expect(result.riskLevel).toBe("MEDIUM");
  });

  it("flags SELECT * as LOW (informational)", () => {
    const result = runSecurityChecks(
      baseParsed({ raw: "SELECT * FROM users WHERE id = 1", columnsReferenced: ["*"] })
    );
    expect(result.riskLevel).toBe("LOW");
    expect(result.reasons).toEqual(
      expect.arrayContaining([expect.stringContaining("SELECT *")])
    );
  });

  it("flags stacked queries (multiple statements) as HIGH", () => {
    const result = runSecurityChecks(
      baseParsed({ raw: "SELECT * FROM users; DROP TABLE users;", statementCount: 2 })
    );
    expect(result.riskLevel).toBe("HIGH");
  });

  it("flags suspicious inline comments as HIGH", () => {
    const result = runSecurityChecks(
      baseParsed({ raw: "SELECT * FROM users WHERE id = 1 -- OR '1'='1'" })
    );
    expect(result.riskLevel).toBe("HIGH");
    expect(result.reasons).toEqual(
      expect.arrayContaining([expect.stringContaining("comment")])
    );
  });

  it("takes the highest severity when multiple rules trigger", () => {
    const result = runSecurityChecks(
      baseParsed({ raw: "DELETE FROM users; -- oops", operation: "DELETE", hasWhereClause: false, statementCount: 2 })
    );
    expect(result.riskLevel).toBe("CRITICAL");
    expect(result.reasons.length).toBeGreaterThan(1);
  });
});
