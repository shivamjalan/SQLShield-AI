import { NavLink } from "react-router-dom";
import { ShieldCheck, LayoutDashboard, ScrollText, Terminal, Gauge, LogOut, Settings } from "lucide-react";
import { useAuth } from "../context/AuthContext";

const LINKS = [
  { to: "/", label: "Overview", icon: LayoutDashboard },
  { to: "/logs", label: "Security Logs", icon: ScrollText },
  { to: "/playground", label: "Query Playground", icon: Terminal },
  { to: "/performance", label: "Performance Analytics", icon: Gauge },
];

const ADMIN_LINKS = [{ to: "/policies", label: "Policy Management", icon: Settings }];

export default function Sidebar() {
  const { session, logout } = useAuth();
  const links = session?.user.role === "admin" ? [...LINKS, ...ADMIN_LINKS] : LINKS;

  return (
    <aside className="sticky top-4 m-4 flex h-[calc(100vh-2rem)] w-64 shrink-0 flex-col rounded-[2rem] border border-border/50 bg-white/70 shadow-soft backdrop-blur-md">
      <div className="flex items-center gap-3 px-6 py-6">
        <span className="flex h-10 w-10 items-center justify-center rounded-full bg-primary text-primary-foreground shadow-soft">
          <ShieldCheck size={20} strokeWidth={2.25} />
        </span>
        <h1 className="font-heading text-lg font-bold text-foreground">SQLShield AI</h1>
      </div>

      <nav className="flex-1 space-y-1.5 px-4">
        {links.map(({ to, label, icon: Icon }) => (
          <NavLink
            key={to}
            to={to}
            end={to === "/"}
            className={({ isActive }) =>
              `flex items-center gap-3 rounded-full px-4 py-2.5 text-sm font-bold transition-all duration-300 ${
                isActive
                  ? "bg-primary text-primary-foreground shadow-soft"
                  : "text-muted-foreground hover:bg-primary/10 hover:text-primary"
              }`
            }
          >
            <Icon size={18} strokeWidth={2.25} />
            {label}
          </NavLink>
        ))}
      </nav>

      <div className="mx-4 mb-4 rounded-[1.5rem] border border-border/50 bg-muted/40 px-4 py-3">
        <p className="truncate text-xs font-bold text-foreground">{session?.user.email}</p>
        <span className="mt-1 inline-block rounded-full bg-accent px-2.5 py-0.5 text-[11px] font-bold capitalize text-accent-foreground">
          {session?.user.role}
        </span>
        <button
          onClick={logout}
          className="mt-3 flex w-full items-center gap-2 rounded-full px-3 py-2 text-left text-sm font-bold text-muted-foreground transition hover:bg-destructive/10 hover:text-destructive"
        >
          <LogOut size={16} strokeWidth={2.25} />
          Log out
        </button>
      </div>
    </aside>
  );
}
