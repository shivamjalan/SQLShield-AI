// Cycled asymmetric radii keep a grid of cards from feeling mechanically uniform,
// per the design system's "no two corners alike" rule.
const RADII = [
  "rounded-[2rem]",
  "rounded-[2rem_2rem_2rem_4rem]",
  "rounded-[2rem_4rem_2rem_2rem]",
  "rounded-[4rem_2rem_2rem_2rem]",
  "rounded-[2rem_2rem_4rem_2rem]",
];

export default function Card({
  children,
  className = "",
  radiusIndex = 0,
  flat = false,
  hover = false,
  ...props
}) {
  const radius = flat ? "rounded-[1.75rem]" : RADII[radiusIndex % RADII.length];
  const hoverStyles = hover
    ? "transition-all duration-300 hover:-translate-y-1 hover:shadow-[0_20px_40px_-10px_rgba(93,112,82,0.15)]"
    : "";

  return (
    <div
      className={`bg-card border border-border/50 shadow-soft ${radius} ${hoverStyles} ${className}`}
      {...props}
    >
      {children}
    </div>
  );
}
