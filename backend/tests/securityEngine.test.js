const { runSecurityChecks } = require("../src/engines/securityEngine");

function baseParsed(overrides = {}) {
  return {
    raw: "SELECT id FROM users WHERE id = 1",
    operation: "SELECT",
    tablesReferenced: ["users"],
    hasWhereClause: true,
    hasLimitClause: true,
    subqueryDepth: 1,
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

  it("flags TRUNCATE as CRITICAL", () => {
    const result = runSecurityChecks(
      baseParsed({ raw: "TRUNCATE TABLE orders", operation: "TRUNCATE", tablesReferenced: ["orders"] })
    );
    expect(result.riskLevel).toBe("CRITICAL");
    expect(result.reasons).toEqual(
      expect.arrayContaining([expect.stringContaining("TRUNCATE")])
    );
  });

  it("flags ALTER as CRITICAL", () => {
    const result = runSecurityChecks(
      baseParsed({ raw: "ALTER TABLE orders ADD COLUMN note TEXT", operation: "ALTER", tablesReferenced: ["orders"] })
    );
    expect(result.riskLevel).toBe("CRITICAL");
  });

  it("flags GRANT and REVOKE as CRITICAL", () => {
    const grant = runSecurityChecks(baseParsed({ raw: "GRANT SELECT ON orders TO developer", operation: "GRANT" }));
    const revoke = runSecurityChecks(baseParsed({ raw: "REVOKE SELECT ON orders FROM developer", operation: "REVOKE" }));
    expect(grant.riskLevel).toBe("CRITICAL");
    expect(revoke.riskLevel).toBe("CRITICAL");
  });

  it("flags a numeric OR tautology (OR 1=1) as HIGH", () => {
    const result = runSecurityChecks(baseParsed({ raw: "SELECT * FROM users WHERE id = 1 OR 1=1" }));
    expect(result.riskLevel).toBe("HIGH");
    expect(result.reasons).toEqual(
      expect.arrayContaining([expect.stringContaining("tautology")])
    );
  });

  it("flags a quoted OR tautology (OR '1'='1') as HIGH", () => {
    const result = runSecurityChecks(baseParsed({ raw: "SELECT * FROM users WHERE id = 1 OR '1'='1'" }));
    expect(result.riskLevel).toBe("HIGH");
  });

  it("does not flag a legitimate OR'd comparison as a tautology", () => {
    const result = runSecurityChecks(
      baseParsed({ raw: "SELECT * FROM users WHERE status = 'a' OR status = 'b'" })
    );
    expect(result.reasons).not.toEqual(
      expect.arrayContaining([expect.stringContaining("tautology")])
    );
  });

  it("flags subqueries nested beyond the depth threshold as MEDIUM", () => {
    const result = runSecurityChecks(baseParsed({ subqueryDepth: 4 }));
    expect(result.riskLevel).toBe("MEDIUM");
    expect(result.reasons).toEqual(
      expect.arrayContaining([expect.stringContaining("nests subqueries")])
    );
  });

  it("does not flag a single level of subquery nesting", () => {
    const result = runSecurityChecks(baseParsed({ subqueryDepth: 2 }));
    expect(result.riskLevel).toBe("LOW");
  });

  it("flags a SELECT with no LIMIT on a known-large table as LOW", () => {
    const result = runSecurityChecks(
      baseParsed({
        raw: "SELECT * FROM orders",
        tablesReferenced: ["orders"],
        hasLimitClause: false,
        columnsReferenced: ["*"],
      })
    );
    expect(result.riskLevel).toBe("LOW");
    expect(result.reasons).toEqual(
      expect.arrayContaining([expect.stringContaining("known-large table")])
    );
  });

  it("does not flag a SELECT with a LIMIT on a known-large table", () => {
    const result = runSecurityChecks(
      baseParsed({ raw: "SELECT * FROM orders LIMIT 10", tablesReferenced: ["orders"], hasLimitClause: true })
    );
    expect(result.reasons).not.toEqual(
      expect.arrayContaining([expect.stringContaining("known-large table")])
    );
  });

  it("does not flag a no-LIMIT SELECT on a table that isn't known to be large", () => {
    const result = runSecurityChecks(
      baseParsed({ raw: "SELECT * FROM users", tablesReferenced: ["users"], hasLimitClause: false })
    );
    expect(result.reasons).not.toEqual(
      expect.arrayContaining([expect.stringContaining("known-large table")])
    );
  });
});
