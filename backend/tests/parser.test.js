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

  it("detects a missing LIMIT clause", () => {
    expect(parseQuery("SELECT * FROM orders").hasLimitClause).toBe(false);
  });

  it("detects a present LIMIT clause", () => {
    expect(parseQuery("SELECT * FROM orders LIMIT 10").hasLimitClause).toBe(true);
  });

  it("reports subqueryDepth 1 for a query with no subqueries", () => {
    expect(parseQuery("SELECT id FROM users WHERE id = 1").subqueryDepth).toBe(1);
  });

  it("reports subqueryDepth 2 for a single level of subquery nesting", () => {
    const result = parseQuery("SELECT id FROM users WHERE id IN (SELECT id FROM orders)");
    expect(result.subqueryDepth).toBe(2);
  });

  it("reports subqueryDepth 4 for three levels of nested subqueries", () => {
    const result = parseQuery(
      "SELECT * FROM orders WHERE customer_id IN (SELECT id FROM customers WHERE id IN (SELECT id FROM customers WHERE id IN (SELECT id FROM customers)))"
    );
    expect(result.subqueryDepth).toBe(4);
  });

  it("recognizes TRUNCATE, GRANT, REVOKE, and ALTER TABLE as their own operations", () => {
    expect(parseQuery("TRUNCATE TABLE orders").operation).toBe("TRUNCATE");
    expect(parseQuery("GRANT SELECT ON orders TO developer").operation).toBe("GRANT");
    expect(parseQuery("REVOKE SELECT ON orders FROM developer").operation).toBe("REVOKE");
    expect(parseQuery("ALTER TABLE orders ADD COLUMN note TEXT").operation).toBe("ALTER");
  });
});
