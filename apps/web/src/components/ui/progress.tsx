import { cn } from "@/lib/utils";

export function Progress({
  value,
  tone = "accent",
  className,
  label,
}: {
  /** 0 to 1. Values outside the range are clamped. */
  value: number;
  tone?: "accent" | "positive" | "warning" | "danger";
  className?: string;
  label?: string;
}) {
  const fraction = Math.max(0, Math.min(1, Number.isFinite(value) ? value : 0));
  const fills = {
    accent: "bg-accent",
    positive: "bg-positive",
    warning: "bg-warning",
    danger: "bg-danger",
  } as const;

  return (
    <div
      role="progressbar"
      aria-valuenow={Math.round(fraction * 100)}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-label={label}
      className={cn("h-1.5 w-full overflow-hidden rounded-full bg-sunken", className)}
    >
      <div
        className={cn("h-full rounded-full transition-[width] duration-500", fills[tone])}
        style={{ width: `${fraction * 100}%` }}
      />
    </div>
  );
}
