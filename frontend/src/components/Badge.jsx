const DECISION_STYLES = {
  ALLOW: "bg-primary/10 text-primary",
  BLOCK: "bg-destructive/10 text-destructive",
  REWRITE: "bg-accent text-accent-foreground",
};

const PENDING_STYLE = "bg-secondary text-secondary-foreground";

const RISK_STYLES = {
  LOW: "bg-muted text-muted-foreground",
  MEDIUM: "bg-accent text-accent-foreground",
  HIGH: "bg-secondary/20 text-[#8a5a2e]",
  CRITICAL: "bg-destructive text-white",
};

export function DecisionBadge({ decision, pendingApproval }) {
  const label = pendingApproval ? "PENDING" : decision;
  const style = pendingApproval ? PENDING_STYLE : DECISION_STYLES[decision] || "bg-muted text-muted-foreground";

  return (
    <span className={`inline-block rounded-full px-3 py-0.5 text-xs font-bold tracking-wide ${style}`}>
      {label}
    </span>
  );
}

export function RiskBadge({ riskLevel }) {
  const style = RISK_STYLES[riskLevel] || "bg-muted text-muted-foreground";

  return (
    <span className={`inline-block rounded-full px-3 py-0.5 text-xs font-bold tracking-wide ${style}`}>
      {riskLevel}
    </span>
  );
}
