function formatCell(value) {
  if (value === null || value === undefined) return "—";
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}

// Shared by QueryPlayground.jsx (inline ALLOWed SELECT execution) and
// ApprovalQueue.jsx (execute-after-approval) -- same { rows, rowCount,
// truncated, executionTimeMs, error } shape from executor.js either way.
export default function ResultsTable({ execution }) {
  if (!execution) return null;

  if (execution.error) {
    return (
      <div className="rounded-[1.25rem] border border-destructive/20 bg-destructive/10 px-4 py-2.5 text-sm text-destructive">
        Execution failed: {execution.error}
      </div>
    );
  }

  if (execution.rows.length === 0) {
    return <p className="text-sm text-muted-foreground">Query executed successfully — 0 rows returned.</p>;
  }

  const columns = Object.keys(execution.rows[0]);

  return (
    <div>
      <div className="overflow-x-auto rounded-[1.25rem] border border-border">
        <table className="w-full text-sm">
          <thead className="bg-muted text-left text-xs font-bold uppercase tracking-wide text-muted-foreground">
            <tr>
              {columns.map((col) => (
                <th key={col} className="whitespace-nowrap px-4 py-2.5">
                  {col}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-border/60">
            {execution.rows.map((row, i) => (
              <tr key={i}>
                {columns.map((col) => (
                  <td key={col} className="whitespace-nowrap px-4 py-2 font-mono text-xs text-foreground/90">
                    {formatCell(row[col])}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="mt-2 text-xs text-muted-foreground">
        {execution.truncated
          ? `Showing first ${execution.rowCount} rows (truncated — the query returned more) · ${execution.executionTimeMs}ms`
          : `${execution.rowCount} row${execution.rowCount === 1 ? "" : "s"} · ${execution.executionTimeMs}ms`}
      </p>
    </div>
  );
}
