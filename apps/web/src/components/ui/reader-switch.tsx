import { motion } from "framer-motion";
import type { DemoReader } from "@rag/shared";

import { cn } from "@/lib/utils";

/**
 * Chooses which platform reads an uploaded file.
 *
 * A radio group rather than a checkbox, for the same reason as the tier switch:
 * a screen reader announces both platforms and which one is in effect, and the
 * arrow keys move between them the way a segmented control should.
 *
 * Both options are free. Cloudflare reads the file in the page and costs
 * nothing at all; LlamaIndex spends LlamaCloud credits from a monthly grant the
 * demo stays inside. Neither is the "upgrade", which is why the labels name the
 * platform rather than ranking them.
 */
export function ReaderSwitch({
  value,
  onChange,
  disabled = false,
}: {
  value: DemoReader;
  onChange: (reader: DemoReader) => void;
  disabled?: boolean;
}) {
  const options: { id: DemoReader; label: string; hint: string }[] = [
    {
      id: "cloudflare",
      label: "Cloudflare",
      hint: "Reads the file in your browser. Keeps page numbers. Cannot read a scan.",
    },
    {
      id: "llamaindex",
      label: "LlamaIndex",
      hint: "Sends the file to LlamaParse. Reads scans and complex layouts.",
    },
  ];

  return (
    <div
      role="radiogroup"
      aria-label="Which platform reads the file"
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
            title={option.hint}
            onClick={() => onChange(option.id)}
            className={cn(
              "relative z-10 rounded-full px-3 py-1 text-[0.75rem] font-medium transition-colors",
              active ? "text-accent-contrast" : "text-muted hover:text-ink",
              disabled && "cursor-not-allowed",
            )}
          >
            {active && (
              <motion.span
                layoutId="reader-switch-thumb"
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
