export function Input({ className = "", ...props }) {
  return (
    <input
      className={`h-12 w-full rounded-full border border-border bg-white/50 px-5 text-sm text-foreground placeholder:text-muted-foreground transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/30 focus-visible:ring-offset-2 ${className}`}
      {...props}
    />
  );
}

export function Textarea({ className = "", mono = true, ...props }) {
  return (
    <textarea
      className={`w-full rounded-[1.5rem] border border-border bg-white/50 px-5 py-4 text-sm text-foreground placeholder:text-muted-foreground transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/30 focus-visible:ring-offset-2 ${mono ? "font-mono" : ""} ${className}`}
      {...props}
    />
  );
}

// Compact, not full pill — sits inline with other filters in dense toolbars.
export function Select({ className = "", ...props }) {
  return (
    <select
      className={`h-10 rounded-full border border-border bg-white/50 px-4 text-sm text-foreground transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/30 focus-visible:ring-offset-2 ${className}`}
      {...props}
    />
  );
}
