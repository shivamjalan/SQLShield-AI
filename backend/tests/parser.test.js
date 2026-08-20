const { parseQuery } = require("../src/engines/parser");

describe("parseQuery", () => {
  it("parses a safe SELECT with explicit columns and a WHERE clause", () => {
    const result = parseQuery("SELECT id, email FROM users WHERE id = 1");

    expect(result.operation).toBe("SELECT");
    expect(result.tablesReferenced).toEqual(["users"]);
    expect(result.hasWhereClause).toBe(true);
    expect(result.columnsReferenced).toEqual(expect.arrayContaining(["id", "email"]));
    expect(result.statementCount).toBe(1);
    expect(result.parseError).toBeNull();
  });

  it("flags SELECT * via columnsReferenced containing '*'", () => {
    const result = parseQuery("SELECT * FROM users");
    expect(result.columnsReferenced).toContain("*");
  });

  it("detects a DELETE with no WHERE clause", () => {
    const result = parseQuery("DELETE FROM users");
    expect(result.operation).toBe("DELETE");
    expect(result.hasWhereClause).toBe(false);
  });

  it("detects a DROP TABLE statement", () => {
    const result = parseQuery("DROP TABLE users");
    expect(result.operation).toBe("DROP");
    expect(result.tablesReferenced).toEqual(["users"]);
  });

  it("detects multiple stacked statements", () => {
    const result = parseQuery("SELECT * FROM users; DROP TABLE users;");
    expect(result.statementCount).toBe(2);
  });

  it("returns a graceful parse-error result for invalid SQL", () => {
    const result = parseQuery("SELEKT * FRUM users");
    expect(result.operation).toBe("UNKNOWN");
    expect(result.parseError).toEqual(expect.any(String));
  });

  it("returns a graceful parse-error result for SQL this dialect doesn't support (DROP DATABASE)", () => {
    const result = parseQuery("DROP DATABASE sqlshield_core");
    expect(result.operation).toBe("UNKNOWN");
    expect(result.parseError).toEqual(expect.any(String));
  });
});
