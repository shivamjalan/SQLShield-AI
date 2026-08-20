import { useEffect, useState } from "react";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell } from "recharts";
import { useAuth } from "../context/AuthContext";
import { fetchAuditStats } from "../api/audit";
import Card from "../components/ui/Card";

const RISK_COLORS = { LOW: "#78786c", MEDIUM: "#c18c5d", HIGH: "#a8703f", CRITICAL: "#a85448" };

export default function Overview() {
  const { session } = useAuth();
  const [stats, setStats] = useState(null);
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;
    fetchAuditStats(session.accessToken)
      .then((data) => !cancelled && setStats(data))
      .catch((err) => !cancelled && setError(err.message));
    return () => {
      cancelled = true;
    };
  }, [session.accessToken]);

  const chartData = stats
    ? Object.entries(stats.byRiskLevel).map(([riskLevel, count]) => ({ riskLevel, count }))
    : [];

  return (
    <div>
      <p className="font-heading text-2xl font-bold text-foreground">Welcome, {session.user.email}</p>
      <p className="mt-1 mb-8 text-sm text-muted-foreground capitalize">Role: {session.user.role}</p>

      {error && (
        <div className="mb-6 rounded-[1.25rem] border border-destructive/20 bg-destructive/10 px-4 py-2.5 text-sm text-destructive">
          {error}
        </div>
      )}

      {stats && (
        <>
          <div className="mb-8 grid grid-cols-2 gap-4 md:grid-cols-4 md:gap-6">
            <StatCard radiusIndex={0} label="Total queries" value={stats.total} accent="text-foreground" />
            <StatCard radiusIndex={1} label="Allowed" value={stats.byDecision.ALLOW} accent="text-primary" />
            <StatCard radiusIndex={2} label="Blocked" value={stats.byDecision.BLOCK} accent="text-destructive" />
            <StatCard radiusIndex={3} label="Pending approval" value={stats.pendingApproval} accent="text-secondary" />
          </div>

          <Card radiusIndex={4} className="p-6">
            <h3 className="mb-4 text-sm font-bold text-foreground">Queries by risk level</h3>
            <ResponsiveContainer width="100%" height={280}>
              <BarChart data={chartData}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#ded8cf" />
                <XAxis dataKey="riskLevel" tick={{ fontSize: 12, fill: "#78786c" }} />
                <YAxis allowDecimals={false} tick={{ fontSize: 12, fill: "#78786c" }} />
                <Tooltip
                  contentStyle={{ borderRadius: 16, border: "1px solid #ded8cf", fontSize: 13 }}
                />
                <Bar dataKey="count" radius={[10, 10, 0, 0]}>
                  {chartData.map((entry) => (
                    <Cell key={entry.riskLevel} fill={RISK_COLORS[entry.riskLevel] || "#5d7052"} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </Card>
        </>
      )}
    </div>
  );
}

function StatCard({ label, value, accent = "text-foreground", radiusIndex }) {
  return (
    <Card radiusIndex={radiusIndex} hover className="p-5">
      <p className="text-xs font-bold uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className={`mt-1 font-heading text-3xl font-bold ${accent}`}>{value}</p>
    </Card>
  );
}
