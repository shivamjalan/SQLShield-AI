import { useState } from "react";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell } from "recharts";
import { useAuth } from "../context/AuthContext";
import { optimizeQuery } from "../api/optimize";
import Card from "../components/ui/Card";
import Button from "../components/ui/Button";
import { Textarea } from "../components/ui/Input";

const DEFAULT_QUERY = "SELECT * FROM orders WHERE customer_id = 42";

export default function PerformanceAnalytics() {
  const { session } = useAuth();
  const [query, setQuery] = useState(DEFAULT_QUERY);
  const [result, setResult] = useState(null);
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(e) {
    e.preventDefault();
    setError("");
    setSubmitting(true);
    setResult(null);
    try {
      const data = await optimizeQuery(session.accessToken, query);
      setResult(data);
    } catch (err) {
      setError(err.message);
    } finally {
      setSubmitting(false);
    }
  }

  const chartData = result
    ? [
        { label: "Before index", ms: result.benchmark.beforeMs },
        { label: "After index", ms: result.benchmark.afterMs },
      ]
    : [];

  return (
    <div>
      <h2 className="mb-1 font-heading text-2xl font-bold text-foreground">Performance Analytics</h2>
      <p className="mb-6 text-sm text-muted-foreground">
        Runs EXPLAIN ANALYZE against the sample target database, suggests missing indexes, and
        measures a real before/after improvement (the index is applied inside a transaction and
        rolled back, so target_db is never permanently changed).
      </p>

      <form onSubmit={handleSubmit}>
        <Card radiusIndex={1} className="mb-6 p-4">
          <Textarea
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="SELECT * FROM orders WHERE customer_id = 42"
            rows={4}
          />
          <div className="mt-3 flex justify-end">
            <Button type="submit" disabled={submitting || !query.trim()}>
              {submitting ? "Analyzing..." : "Analyze query"}
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
        <div className="space-y-6">
          <Card radiusIndex={2} className="p-6">
            <h3 className="mb-3 text-sm font-bold text-foreground">EXPLAIN ANALYZE summary</h3>
            <dl className="grid grid-cols-2 gap-4 text-sm md:grid-cols-4">
              <SummaryStat label="Top node" value={result.plan.Plan["Node Type"]} />
              <SummaryStat label="Table" value={result.plan.Plan["Relation Name"] || "—"} />
              <SummaryStat
                label="Planning time"
                value={`${result.plan["Planning Time"]?.toFixed(2) ?? "—"} ms`}
              />
              <SummaryStat
                label="Execution time"
                value={`${result.plan["Execution Time"]?.toFixed(2) ?? "—"} ms`}
              />
            </dl>
          </Card>

          <Card radiusIndex={3} className="p-6">
            <h3 className="mb-3 text-sm font-bold text-foreground">Suggested indexes</h3>
            {result.suggestions.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                No missing-index suggestions — the planner didn't need a sequential scan on a
                large, unindexed filter column.
              </p>
            ) : (
              <div className="space-y-3">
                {result.suggestions.map((s, i) => (
                  <div key={i} className="rounded-[1.25rem] border border-border bg-muted/50 px-4 py-3">
                    <p className="mb-1 text-xs text-muted-foreground">{s.reason}</p>
                    <pre className="whitespace-pre-wrap font-mono text-sm text-foreground">{s.sql}</pre>
                  </div>
                ))}
              </div>
            )}
          </Card>

          <Card radiusIndex={4} className="p-6">
            <h3 className="mb-1 text-sm font-bold text-foreground">Execution time: before vs. after</h3>
            <p className="mb-4 text-xs text-muted-foreground">
              {result.benchmark.indexesApplied.length > 0
                ? "Suggested index applied in a transaction, re-measured, then rolled back."
                : "No index was suggested, so before and after are the same measured run."}
            </p>
            <ResponsiveContainer width="100%" height={240}>
              <BarChart data={chartData}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#ded8cf" />
                <XAxis dataKey="label" tick={{ fontSize: 12, fill: "#78786c" }} />
                <YAxis tick={{ fontSize: 12, fill: "#78786c" }} unit="ms" />
                <Tooltip
                  formatter={(value) => `${value.toFixed(3)} ms`}
                  contentStyle={{ borderRadius: 16, border: "1px solid #ded8cf", fontSize: 13 }}
                />
                <Bar dataKey="ms" radius={[10, 10, 0, 0]}>
                  {chartData.map((entry) => (
                    <Cell key={entry.label} fill={entry.label === "Before index" ? "#a85448" : "#5d7052"} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </Card>
        </div>
      )}
    </div>
  );
}

function SummaryStat({ label, value }) {
  return (
    <div>
      <dt className="text-xs font-bold uppercase tracking-wide text-muted-foreground">{label}</dt>
      <dd className="mt-0.5 text-sm font-bold text-foreground">{value}</dd>
    </div>
  );
}
