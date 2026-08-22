import { useEffect, useState } from "react";
import { useAuth } from "../context/AuthContext";
import { fetchUsers, updateUserRole } from "../api/users";
import Card from "../components/ui/Card";
import Button from "../components/ui/Button";
import { Select } from "../components/ui/Input";

const ROLES = ["intern", "developer", "admin"];

export default function UserManagement() {
  const { session } = useAuth();
  const isAdmin = session.user.role === "admin";

  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  // Tracks the dropdown's in-progress selection per user, separate from
  // the user's actual saved role, so "Update" only enables once it
  // differs from what's persisted.
  const [pendingRoles, setPendingRoles] = useState({});
  const [savingId, setSavingId] = useState(null);
  const [toast, setToast] = useState(null);

  useEffect(() => {
    if (!isAdmin) return;
    let cancelled = false;
    fetchUsers(session.accessToken)
      .then((data) => !cancelled && setUsers(data.users))
      .catch((err) => !cancelled && setError(err.message))
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, [session.accessToken, isAdmin]);

  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(null), 3500);
    return () => clearTimeout(timer);
  }, [toast]);

  function selectedRoleFor(user) {
    return pendingRoles[user.id] ?? user.role;
  }

  async function handleUpdate(user) {
    const role = selectedRoleFor(user);
    if (role === user.role) return;

    setSavingId(user.id);
    try {
      const { user: updated } = await updateUserRole(session.accessToken, user.id, role);
      setUsers((prev) => prev.map((u) => (u.id === updated.id ? updated : u)));
      setToast({ type: "success", message: `${updated.email} is now ${updated.role}.` });
    } catch (err) {
      setToast({ type: "error", message: err.message });
    } finally {
      setSavingId(null);
    }
  }

  if (!isAdmin) {
    return (
      <div>
        <h2 className="mb-2 font-heading text-2xl font-bold text-foreground">User Management</h2>
        <p className="text-sm text-muted-foreground">Only admins can view or manage user roles.</p>
      </div>
    );
  }

  return (
    <div>
      <h2 className="mb-1 font-heading text-2xl font-bold text-foreground">User Management</h2>
      <p className="mb-6 text-sm text-muted-foreground">
        New accounts always self-register as <code className="font-mono">intern</code> — this is the
        only place a role changes afterward, and every change here is written to an audit log.
      </p>

      {error && (
        <div className="mb-4 rounded-[1.25rem] border border-destructive/20 bg-destructive/10 px-4 py-2.5 text-sm text-destructive">
          {error}
        </div>
      )}

      <Card flat className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-muted text-left text-xs font-bold uppercase tracking-wide text-muted-foreground">
            <tr>
              <th className="px-4 py-3">Email</th>
              <th className="px-4 py-3">Current role</th>
              <th className="px-4 py-3">Created</th>
              <th className="px-4 py-3">New role</th>
              <th className="px-4 py-3" />
            </tr>
          </thead>
          <tbody className="divide-y divide-border/60">
            {loading ? (
              <tr>
                <td colSpan={5} className="px-4 py-6 text-center text-muted-foreground">
                  Loading...
                </td>
              </tr>
            ) : users.length === 0 ? (
              <tr>
                <td colSpan={5} className="px-4 py-6 text-center text-muted-foreground">
                  No users yet
                </td>
              </tr>
            ) : (
              users.map((user) => {
                const selected = selectedRoleFor(user);
                const dirty = selected !== user.role;
                return (
                  <tr key={user.id} className="transition hover:bg-muted/50">
                    <td className="px-4 py-2.5 text-foreground">{user.email}</td>
                    <td className="px-4 py-2.5 capitalize text-muted-foreground">{user.role}</td>
                    <td className="px-4 py-2.5 whitespace-nowrap text-muted-foreground">
                      {new Date(user.created_at).toLocaleString()}
                    </td>
                    <td className="px-4 py-2.5">
                      <Select
                        value={selected}
                        onChange={(e) =>
                          setPendingRoles((prev) => ({ ...prev, [user.id]: e.target.value }))
                        }
                      >
                        {ROLES.map((r) => (
                          <option key={r} value={r}>
                            {r}
                          </option>
                        ))}
                      </Select>
                    </td>
                    <td className="px-4 py-2.5 text-right">
                      <Button
                        variant="outline"
                        size="sm"
                        disabled={!dirty || savingId === user.id}
                        onClick={() => handleUpdate(user)}
                      >
                        {savingId === user.id ? "Saving..." : "Update"}
                      </Button>
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </Card>

      {toast && (
        <div
          className={`fixed bottom-6 right-6 rounded-[1.25rem] border px-5 py-3 text-sm font-bold shadow-float ${
            toast.type === "success"
              ? "border-primary/20 bg-primary/10 text-primary"
              : "border-destructive/20 bg-destructive/10 text-destructive"
          }`}
        >
          {toast.message}
        </div>
      )}
    </div>
  );
}
