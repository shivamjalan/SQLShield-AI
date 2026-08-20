import { useEffect, useState } from "react";
import { useAuth } from "../context/AuthContext";
import { fetchAuditLogs } from "../api/audit";
import { DecisionBadge, RiskBadge } from "../components/Badge";
import Card from "../components/ui/Card";
import Button from "../components/ui/Button";
import { Select } from "../components/ui/Input";

const PAGE_SIZE = 25;

export default function SecurityLogs() {
  const { session } = useAuth();
  const [logs, setLogs] = useState([]);
  const [total, setTotal] = useState(0);
  const [offset, setOffset] = useState(0);
  const [decision, setDecision] = useState("");
  const [riskLevel, setRiskLevel] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError("");

    fetchAuditLogs(session.accessToken, { decision, risk_level: riskLevel, limit: PAGE_SIZE, offset })
      .then((data) => {
        if (cancelled) return;
        setLogs(data.logs);
        setTotal(data.total);
      })
      .catch((err) => !cancelled && setError(err.message))
      .finally(() => !cancelled && setLoading(false));

    return () => {
      cancelled = true;
    };
  }, [session.accessToken, decision, riskLevel, offset]);

  function handleFilterChange(setter) {
    return (e) => {
      setter(e.target.value);
      setOffset(0);
    };
  }

  return (
    <div>
      <h2 className="mb-6 font-heading text-2xl font-bold text-foreground">Security Logs</h2>

      <div className="mb-4 flex gap-3">
        <Select value={decision} onChange={handleFilterChange(setDecision)}>
          <option value="">All decisions</option>
          <option value="ALLOW">Allow</option>
          <option value="BLOCK">Block</option>
        </Select>

        <Select value={riskLevel} onChange={handleFilterChange(setRiskLevel)}>
          <option value="">All risk levels</option>
          <option value="LOW">Low</option>
          <option value="MEDIUM">Medium</option>
          <option value="HIGH">High</option>
          <option value="CRITICAL">Critical</option>
        </Select>
      </div>

      {error && (
        <div className="mb-4 rounded-[1.25rem] border border-destructive/20 bg-destructive/10 px-4 py-2.5 text-sm text-destructive">
          {error}
        </div>
      )}

      <Card flat className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-muted text-left text-xs font-bold uppercase tracking-wide text-muted-foreground">
            <tr>
              <th className="px-4 py-3">Time</th>
              <th className="px-4 py-3">User</th>
              <th className="px-4 py-3">Query</th>
              <th className="px-4 py-3">Table</th>
              <th className="px-4 py-3">Risk</th>
              <th className="px-4 py-3">Decision</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border/60">
            {loading ? (
              <tr>
                <td colSpan={6} className="px-4 py-6 text-center text-muted-foreground">
                  Loading...
                </td>
              </tr>
            ) : logs.length === 0 ? (
              <tr>
                <td colSpan={6} className="px-4 py-6 text-center text-muted-foreground">
                  No matching logs
                </td>
              </tr>
            ) : (
              logs.map((log) => (
                <tr key={log.id} className="transition hover:bg-muted/50">
                  <td className="px-4 py-2.5 whitespace-nowrap text-muted-foreground">
                    {new Date(log.created_at).toLocaleString()}
                  </td>
                  <td className="px-4 py-2.5 text-foreground">{log.user_email || "—"}</td>
                  <td
                    className="max-w-md truncate px-4 py-2.5 font-mono text-xs text-foreground/80"
                    title={log.raw_query}
                  >
                    {log.raw_query}
                  </td>
                  <td className="px-4 py-2.5 text-muted-foreground">{log.target_table || "—"}</td>
                  <td className="px-4 py-2.5">
                    <RiskBadge riskLevel={log.risk_level} />
                  </td>
                  <td className="px-4 py-2.5">
                    <DecisionBadge decision={log.decision} pendingApproval={log.pending_approval} />
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </Card>

      <div className="mt-4 flex items-center justify-between text-sm text-muted-foreground">
        <span>
          {total === 0 ? "0 results" : `${offset + 1}-${Math.min(offset + PAGE_SIZE, total)} of ${total}`}
        </span>
        <div className="flex gap-2">
          <Button
            variant="outline"
            size="sm"
            disabled={offset === 0}
            onClick={() => setOffset(Math.max(0, offset - PAGE_SIZE))}
          >
            Prev
          </Button>
          <Button
            variant="outline"
            size="sm"
            disabled={offset + PAGE_SIZE >= total}
            onClick={() => setOffset(offset + PAGE_SIZE)}
          >
            Next
          </Button>
        </div>
      </div>
    </div>
  );
}
