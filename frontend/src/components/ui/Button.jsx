const VARIANTS = {
  primary:
    "bg-primary text-primary-foreground shadow-soft hover:shadow-[0_6px_24px_-4px_rgba(93,112,82,0.25)]",
  outline:
    "border-2 border-secondary text-secondary bg-transparent hover:bg-secondary/10",
  ghost: "text-primary bg-transparent hover:bg-primary/10",
  destructive:
    "bg-destructive text-white shadow-soft hover:shadow-[0_6px_24px_-4px_rgba(168,84,72,0.25)]",
};

const SIZES = {
  sm: "h-10 px-6 text-sm",
  default: "h-12 px-8 text-base",
  lg: "h-14 px-10 text-lg",
};

export default function Button({
  variant = "primary",
  size = "default",
  className = "",
  ...props
}) {
  return (
    <button
      className={`inline-flex items-center justify-center gap-2 rounded-full font-bold whitespace-nowrap transition-all duration-300 hover:scale-105 active:scale-95 disabled:opacity-50 disabled:hover:scale-100 disabled:cursor-not-allowed focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/30 focus-visible:ring-offset-2 ${VARIANTS[variant]} ${SIZES[size]} ${className}`}
      {...props}
    />
  );
}
