import { useEffect, useState } from "react";
import { useAuth } from "../context/AuthContext";
import { fetchPendingApprovals, reviewApproval, executeApprovedQuery } from "../api/audit";
import { RiskBadge } from "../components/Badge";
import Card from "../components/ui/Card";
import Button from "../components/ui/Button";
import ResultsTable from "../components/ResultsTable";

export default function ApprovalQueue() {
  const { session } = useAuth();
  const isAdmin = session.user.role === "admin";

  const [logs, setLogs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [reviewingId, setReviewingId] = useState(null);
  const [executingId, setExecutingId] = useState(null);
  const [toast, setToast] = useState(null);

  useEffect(() => {
    if (!isAdmin) return;
    let cancelled = false;
    fetchPendingApprovals(session.accessToken)
      .then((data) => !cancelled && setLogs(data.logs))
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

  async function handleReview(log, decision) {
    setReviewingId(log.id);
    try {
      await reviewApproval(session.accessToken, log.id, decision);
      if (decision === "rejected") {
        // A rejected query has nothing further to do -- drop it. (It also
        // falls out of GET /pending on its own, since approval_status is
        // no longer NULL; this just mirrors that locally without a refetch.)
        setLogs((prev) => prev.filter((l) => l.id !== log.id));
        setToast({ type: "error", message: "Query rejected." });
      } else {
        // Keep an approved row visible so its Execute button is reachable
        // right here -- executing is a separate, explicit action, not an
        // automatic side effect of approval.
        setLogs((prev) => prev.map((l) => (l.id === log.id ? { ...l, reviewStatus: "approved" } : l)));
        setToast({ type: "success", message: "Query approved — ready to execute." });
      }
    } catch (err) {
      setToast({ type: "error", message: err.message });
    } finally {
      setReviewingId(null);
    }
  }

  async function handleExecute(log) {
    setExecutingId(log.id);
    try {
      const result = await executeApprovedQuery(session.accessToken, log.id);
      setLogs((prev) =>
        prev.map((l) => (l.id === log.id ? { ...l, reviewStatus: "executed", executionResult: result } : l))
      );
      setToast(
        result.error
          ? { type: "error", message: `Execution failed: ${result.error}` }
          : { type: "success", message: `Executed — ${result.rowCount} row(s) returned.` }
      );
    } catch (err) {
      setToast({ type: "error", message: err.message });
    } finally {
      setExecutingId(null);
    }
  }

  if (!isAdmin) {
    return (
      <div>
        <h2 className="mb-2 font-heading text-2xl font-bold text-foreground">Approval Queue</h2>
        <p className="text-sm text-muted-foreground">Only admins can review pending queries.</p>
      </div>
    );
  }

  return (
    <div>
      <h2 className="mb-1 font-heading text-2xl font-bold text-foreground">Approval Queue</h2>
      <p className="mb-6 text-sm text-muted-foreground">
        Queries that passed the security and policy engines but are flagged as requiring approval
        (e.g. a developer's DELETE). Approving only records the review decision — it does not run
        the query. Execution is a separate step, only offered for <code className="font-mono">SELECT</code>{" "}
        statements, and re-checks the query against current policy immediately before running it.
      </p>

      {error && (
        <div className="mb-4 rounded-[1.25rem] border border-destructive/20 bg-destructive/10 px-4 py-2.5 text-sm text-destructive">
          {error}
        </div>
      )}

      {loading ? (
        <p className="text-sm text-muted-foreground">Loading...</p>
      ) : logs.length === 0 ? (
        <Card flat className="p-6 text-center text-sm text-muted-foreground">
          Nothing pending — every query is either allowed outright, blocked, or already reviewed.
        </Card>
      ) : (
        <div className="space-y-4">
          {logs.map((log, i) => (
            <Card key={log.id} radiusIndex={i} className="p-5">
              <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
                <div className="flex items-center gap-3">
                  <RiskBadge riskLevel={log.risk_level} />
                  {log.reviewStatus && (
                    <span className="rounded-full bg-primary/10 px-2.5 py-0.5 text-[11px] font-bold text-primary">
                      {log.reviewStatus === "executed" ? "Executed" : "Approved"}
                    </span>
                  )}
                  <span className="text-sm font-bold text-foreground">{log.user_email || "—"}</span>
                  <span className="text-xs text-muted-foreground">
                    {new Date(log.created_at).toLocaleString()}
                  </span>
                </div>
                <div className="flex gap-2">
                  {!log.reviewStatus && (
                    <>
                      <Button
                        variant="primary"
                        size="sm"
                        disabled={reviewingId === log.id}
                        onClick={() => handleReview(log, "approved")}
                      >
                        Approve
                      </Button>
                      <Button
                        variant="destructive"
                        size="sm"
                        disabled={reviewingId === log.id}
                        onClick={() => handleReview(log, "rejected")}
                      >
                        Reject
                      </Button>
                    </>
                  )}
                  {log.reviewStatus === "approved" &&
                    (log.parsed_operation === "SELECT" ? (
                      <Button
                        variant="primary"
                        size="sm"
                        disabled={executingId === log.id}
                        onClick={() => handleExecute(log)}
                      >
                        {executingId === log.id ? "Running..." : "Execute"}
                      </Button>
                    ) : (
                      <span className="text-xs italic text-muted-foreground">
                        Not eligible for in-app execution (not a SELECT)
                      </span>
                    ))}
                </div>
              </div>

              <pre className="mb-3 whitespace-pre-wrap rounded-[1.25rem] border border-border bg-muted/50 px-4 py-3 font-mono text-sm text-foreground">
                {log.raw_query}
              </pre>

              {log.reasons && log.reasons.length > 0 && (
                <ul className="mb-3 list-inside list-disc space-y-0.5 text-sm text-foreground/90">
                  {log.reasons.map((reason, idx) => (
                    <li key={idx}>{reason}</li>
                  ))}
                </ul>
              )}

              {log.reviewStatus === "executed" && (
                <div>
                  <p className="mb-1 text-xs font-bold uppercase tracking-wide text-muted-foreground">
                    Execution result
                  </p>
                  <ResultsTable execution={log.executionResult} />
                </div>
              )}
            </Card>
          ))}
        </div>
      )}

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
