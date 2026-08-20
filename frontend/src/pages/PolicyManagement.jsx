import { useEffect, useState } from "react";
import { useAuth } from "../context/AuthContext";
import { fetchPolicies, upsertPolicy, deletePolicy } from "../api/policies";
import Card from "../components/ui/Card";
import Button from "../components/ui/Button";
import { Select } from "../components/ui/Input";

const ROLES = ["intern", "developer", "admin"];
const OPERATIONS = ["SELECT", "INSERT", "UPDATE", "DELETE", "DROP"];

const EMPTY_FORM = { role: "intern", table_name: "*", operation: "SELECT", allowed: true, requires_approval: false };

export default function PolicyManagement() {
  const { session } = useAuth();
  const isAdmin = session.user.role === "admin";

  const [policies, setPolicies] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [form, setForm] = useState(EMPTY_FORM);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!isAdmin) return;
    let cancelled = false;
    fetchPolicies(session.accessToken)
      .then((data) => !cancelled && setPolicies(data.policies))
      .catch((err) => !cancelled && setError(err.message))
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, [session.accessToken, isAdmin]);

  function replacePolicy(saved) {
    setPolicies((prev) => {
      const idx = prev.findIndex((p) => p.id === saved.id);
      if (idx === -1) return [...prev, saved].sort(sortPolicies);
      const next = [...prev];
      next[idx] = saved;
      return next;
    });
  }

  async function handleToggle(policy, field) {
    setError("");
    try {
      const saved = await upsertPolicy(session.accessToken, {
        role: policy.role,
        table_name: policy.table_name,
        operation: policy.operation,
        allowed: field === "allowed" ? !policy.allowed : policy.allowed,
        requires_approval: field === "requires_approval" ? !policy.requires_approval : policy.requires_approval,
      });
      replacePolicy(saved.policy);
    } catch (err) {
      setError(err.message);
    }
  }

  async function handleDelete(id) {
    setError("");
    try {
      await deletePolicy(session.accessToken, id);
      setPolicies((prev) => prev.filter((p) => p.id !== id));
    } catch (err) {
      setError(err.message);
    }
  }

  async function handleCreate(e) {
    e.preventDefault();
    setError("");
    setSaving(true);
    try {
      const saved = await upsertPolicy(session.accessToken, form);
      replacePolicy(saved.policy);
      setForm(EMPTY_FORM);
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  if (!isAdmin) {
    return (
      <div>
        <h2 className="mb-2 font-heading text-2xl font-bold text-foreground">Policy Management</h2>
        <p className="text-sm text-muted-foreground">Only admins can view or edit access policies.</p>
      </div>
    );
  }

  return (
    <div>
      <h2 className="mb-1 font-heading text-2xl font-bold text-foreground">Policy Management</h2>
      <p className="mb-6 text-sm text-muted-foreground">
        Per-role, per-table rules the policy engine checks on every query. An exact table match wins
        over the <code className="font-mono">*</code> wildcard for the same role and operation.
      </p>

      <form onSubmit={handleCreate}>
        <Card radiusIndex={1} className="mb-6 flex flex-wrap items-end gap-3 p-4">
          <Field label="Role">
            <Select value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value })}>
              {ROLES.map((r) => (
                <option key={r} value={r}>
                  {r}
                </option>
              ))}
            </Select>
          </Field>

          <Field label="Table">
            <input
              value={form.table_name}
              onChange={(e) => setForm({ ...form, table_name: e.target.value })}
              placeholder="* or a table name"
              className="h-10 w-40 rounded-full border border-border bg-white/50 px-4 text-sm text-foreground placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/30"
            />
          </Field>

          <Field label="Operation">
            <Select value={form.operation} onChange={(e) => setForm({ ...form, operation: e.target.value })}>
              {OPERATIONS.map((op) => (
                <option key={op} value={op}>
                  {op}
                </option>
              ))}
            </Select>
          </Field>

          <label className="flex items-center gap-2 pb-2 text-sm font-bold text-foreground">
            <input
              type="checkbox"
              checked={form.allowed}
              onChange={(e) => setForm({ ...form, allowed: e.target.checked })}
              className="h-4 w-4 accent-primary"
            />
            Allowed
          </label>

          <label className="flex items-center gap-2 pb-2 text-sm font-bold text-foreground">
            <input
              type="checkbox"
              checked={form.requires_approval}
              onChange={(e) => setForm({ ...form, requires_approval: e.target.checked })}
              className="h-4 w-4 accent-primary"
            />
            Requires approval
          </label>

          <Button type="submit" size="sm" disabled={saving} className="ml-auto">
            {saving ? "Saving..." : "Add / update rule"}
          </Button>
        </Card>
      </form>

      {error && (
        <div className="mb-4 rounded-[1.25rem] border border-destructive/20 bg-destructive/10 px-4 py-2.5 text-sm text-destructive">
          {error}
        </div>
      )}

      <Card flat className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-muted text-left text-xs font-bold uppercase tracking-wide text-muted-foreground">
            <tr>
              <th className="px-4 py-3">Role</th>
              <th className="px-4 py-3">Table</th>
              <th className="px-4 py-3">Operation</th>
              <th className="px-4 py-3">Allowed</th>
              <th className="px-4 py-3">Requires approval</th>
              <th className="px-4 py-3" />
            </tr>
          </thead>
          <tbody className="divide-y divide-border/60">
            {loading ? (
              <tr>
                <td colSpan={6} className="px-4 py-6 text-center text-muted-foreground">
                  Loading...
                </td>
              </tr>
            ) : policies.length === 0 ? (
              <tr>
                <td colSpan={6} className="px-4 py-6 text-center text-muted-foreground">
                  No policies yet
                </td>
              </tr>
            ) : (
              policies.map((policy) => (
                <tr key={policy.id} className="transition hover:bg-muted/50">
                  <td className="px-4 py-2.5 capitalize text-foreground">{policy.role}</td>
                  <td className="px-4 py-2.5 font-mono text-xs text-foreground/80">{policy.table_name}</td>
                  <td className="px-4 py-2.5 text-foreground">{policy.operation}</td>
                  <td className="px-4 py-2.5">
                    <input
                      type="checkbox"
                      checked={policy.allowed}
                      onChange={() => handleToggle(policy, "allowed")}
                      className="h-4 w-4 accent-primary"
                    />
                  </td>
                  <td className="px-4 py-2.5">
                    <input
                      type="checkbox"
                      checked={policy.requires_approval}
                      onChange={() => handleToggle(policy, "requires_approval")}
                      className="h-4 w-4 accent-primary"
                    />
                  </td>
                  <td className="px-4 py-2.5 text-right">
                    <Button variant="ghost" size="sm" onClick={() => handleDelete(policy.id)}>
                      Delete
                    </Button>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </Card>
    </div>
  );
}

function sortPolicies(a, b) {
  return (
    a.role.localeCompare(b.role) ||
    a.table_name.localeCompare(b.table_name) ||
    a.operation.localeCompare(b.operation)
  );
}

function Field({ label, children }) {
  return (
    <div className="flex flex-col gap-1">
      <span className="text-xs font-bold uppercase tracking-wide text-muted-foreground">{label}</span>
      {children}
    </div>
  );
}
