const { DEFAULT_POLICIES } = require("../src/db/seedPolicies");

function findPolicy(role, table, operation) {
  return DEFAULT_POLICIES.find(
    (p) => p.role === role && p.table_name === table && p.operation === operation
  );
}

describe("DEFAULT_POLICIES", () => {
  it("denies developer writes to the policies table despite the developer wildcard allowing INSERT/UPDATE", () => {
    expect(findPolicy("developer", "policies", "INSERT")).toMatchObject({ allowed: false });
    expect(findPolicy("developer", "policies", "UPDATE")).toMatchObject({ allowed: false });
    expect(findPolicy("developer", "policies", "DELETE")).toMatchObject({ allowed: false });
  });

  it("denies intern writes to the policies table explicitly (not just via the intern wildcard)", () => {
    expect(findPolicy("intern", "policies", "INSERT")).toMatchObject({ allowed: false });
    expect(findPolicy("intern", "policies", "UPDATE")).toMatchObject({ allowed: false });
    expect(findPolicy("intern", "policies", "DELETE")).toMatchObject({ allowed: false });
  });

  it("denies developer and intern UPDATE/DELETE on audit_logs", () => {
    expect(findPolicy("developer", "audit_logs", "UPDATE")).toMatchObject({ allowed: false });
    expect(findPolicy("developer", "audit_logs", "DELETE")).toMatchObject({ allowed: false });
    expect(findPolicy("intern", "audit_logs", "UPDATE")).toMatchObject({ allowed: false });
    expect(findPolicy("intern", "audit_logs", "DELETE")).toMatchObject({ allowed: false });
  });

  it("does not add a table-specific SELECT row for either table -- reads still fall through to the wildcard", () => {
    expect(findPolicy("developer", "policies", "SELECT")).toBeUndefined();
    expect(findPolicy("developer", "audit_logs", "SELECT")).toBeUndefined();
  });

  it("does not add table-specific rows for admin -- the wildcard already allows everything", () => {
    expect(findPolicy("admin", "policies", "INSERT")).toBeUndefined();
    expect(findPolicy("admin", "audit_logs", "DELETE")).toBeUndefined();
  });
});
