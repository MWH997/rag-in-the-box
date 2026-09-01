import { motion } from "framer-motion";
import type { Tier } from "@rag/shared";

import { cn } from "@/lib/utils";

/**
 * The free and paid tier switch.
 *
 * Implemented as a radio group rather than a checkbox so a screen reader
 * announces both options and the one in effect, and so keyboard arrows move
 * between them the way a segmented control should behave.
 */
export function TierSwitch({
  value,
  onChange,
  disabled = false,
  size = "md",
}: {
  value: Tier;
  onChange: (tier: Tier) => void;
  disabled?: boolean;
  size?: "sm" | "md";
}) {
  const options: { id: Tier; label: string }[] = [
    { id: "free", label: "Free" },
    { id: "paid", label: "Paid" },
  ];

  return (
    <div
      role="radiogroup"
      aria-label="Cloudflare plan tier"
      className={cn(
        "relative inline-flex shrink-0 items-center rounded-full border border-line bg-sunken p-1",
        disabled && "opacity-60",
      )}
    >
      {options.map((option) => {
        const active = option.id === value;
        return (
          <button
            key={option.id}
            type="button"
            role="radio"
            aria-checked={active}
            disabled={disabled}
            onClick={() => onChange(option.id)}
            className={cn(
              "relative z-10 rounded-full font-medium transition-colors",
              size === "sm" ? "px-3 py-1 text-[0.75rem]" : "px-4 py-1.5 text-[0.8125rem]",
              active ? "text-accent-contrast" : "text-muted hover:text-ink",
              disabled && "cursor-not-allowed",
            )}
          >
            {active && (
              <motion.span
                layoutId="tier-switch-thumb"
                transition={{ type: "spring", stiffness: 420, damping: 34 }}
                className="absolute inset-0 -z-10 rounded-full bg-accent"
              />
            )}
            {option.label}
          </button>
        );
      })}
    </div>
  );
}
