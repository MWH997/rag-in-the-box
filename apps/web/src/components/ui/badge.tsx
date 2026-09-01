import type { HTMLAttributes } from "react";

import { cn } from "@/lib/utils";

type Tone = "neutral" | "accent" | "positive" | "warning" | "danger";

const TONES: Record<Tone, string> = {
  neutral: "border-line bg-sunken text-muted",
  accent: "border-accent/40 bg-accent-soft text-accent-text",
  positive: "border-positive/40 bg-positive/10 text-positive",
  warning: "border-warning/40 bg-warning/10 text-warning",
  danger: "border-danger/40 bg-danger/10 text-danger",
};

export function Badge({
  tone = "neutral",
  className,
  ...props
}: HTMLAttributes<HTMLSpanElement> & { tone?: Tone }) {
  return (
    <span
      className={cn(
        "inline-flex max-w-full items-center gap-1 truncate rounded-full border",
        "px-2 py-0.5 text-[0.6875rem] font-medium leading-5 tracking-[0.01em]",
        TONES[tone],
        className,
      )}
      {...props}
    />
  );
}
