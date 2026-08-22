import { useState } from "react";
import { useAuth } from "../context/AuthContext";
import { submitQuery } from "../api/query";
import { DecisionBadge, RiskBadge } from "../components/Badge";
import Card from "../components/ui/Card";
import Button from "../components/ui/Button";
import { Textarea } from "../components/ui/Input";
import ResultsTable from "../components/ResultsTable";

export default function QueryPlayground() {
  const { session } = useAuth();
  const [query, setQuery] = useState("");
  const [result, setResult] = useState(null);
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(e) {
    e.preventDefault();
    setError("");
    setSubmitting(true);
    setResult(null);
    try {
      const data = await submitQuery(session.accessToken, query);
      setResult(data);
    } catch (err) {
      setError(err.message);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div>
      <h2 className="mb-6 font-heading text-2xl font-bold text-foreground">Query Playground</h2>

      <form onSubmit={handleSubmit}>
        <Card radiusIndex={1} className="mb-6 p-4">
          <Textarea
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="SELECT * FROM users WHERE id = 1"
            rows={6}
          />
          <div className="mt-3 flex justify-end">
            <Button type="submit" disabled={submitting || !query.trim()}>
              {submitting ? "Analyzing..." : "Submit query"}
            </Button>
          </div>
        </Card>
      </form>

      {error && (
        <div className="mb-6 rounded-[1.25rem] border border-destructive/20 bg-destructive/10 px-4 py-2.5 text-sm text-destructive">
          {error}
        </div>
      )}

      {result && (
        <Card radiusIndex={2} className="space-y-4 p-6">
          <div className="flex items-center gap-3">
            <DecisionBadge
              decision={result.decision.decision}
              pendingApproval={result.decision.pendingApproval}
            />
            <RiskBadge riskLevel={result.riskLevel} />
            {result.decision.pendingApproval && (
              <span className="text-xs font-bold text-secondary">Awaiting approval</span>
            )}
          </div>

          <div>
            <p className="mb-1 text-xs font-bold uppercase tracking-wide text-muted-foreground">Operation</p>
            <p className="text-sm text-foreground">
              {result.parsed.operation} on {result.parsed.tablesReferenced.join(", ") || "—"}
            </p>
          </div>

          {result.reasons.length > 0 && (
            <div>
              <p className="mb-1 text-xs font-bold uppercase tracking-wide text-muted-foreground">Reasons</p>
              <ul className="list-inside list-disc space-y-0.5 text-sm text-foreground/90">
                {result.reasons.map((reason, i) => (
                  <li key={i}>{reason}</li>
                ))}
              </ul>
            </div>
          )}

          {result.decision.aiExplanation && (
            <div className="rounded-[1.25rem] border border-primary/20 bg-primary/8 px-4 py-3">
              <p className="mb-1 text-xs font-bold uppercase tracking-wide text-primary">AI explanation</p>
              <p className="text-sm text-foreground">{result.decision.aiExplanation}</p>
              <p className="mt-1 text-[11px] text-muted-foreground">
                Explanation only — the AI did not make the allow/block decision above.
              </p>
            </div>
          )}

          {result.decision.suggestedRewrite && (
            <div>
              <p className="mb-1 text-xs font-bold uppercase tracking-wide text-muted-foreground">
                {result.decision.decision === "REWRITE" ? "Applied rewrite" : "Suggested rewrite (not applied)"}
              </p>
              <pre className="whitespace-pre-wrap rounded-[1.25rem] border border-border bg-muted/50 px-4 py-3 font-mono text-sm text-foreground">
                {result.decision.suggestedRewrite}
              </pre>
              {result.decision.decision !== "REWRITE" && (
                <p className="mt-1 text-[11px] text-muted-foreground">
                  This rewrite did not pass the security/policy engines on its own, so it was not applied.
                </p>
              )}
            </div>
          )}

          {result.execution && (
            <div>
              <p className="mb-1 text-xs font-bold uppercase tracking-wide text-muted-foreground">
                Execution result
              </p>
              <ResultsTable execution={result.execution} />
            </div>
          )}
        </Card>
      )}
    </div>
  );
}
