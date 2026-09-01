import { Cpu, Search, Sparkles, Zap } from "lucide-react";

import { cn } from "@/lib/utils";
import { formatDuration } from "@/lib/utils";

export interface PipelineStats {
  retrievalMs: number;
  totalMs: number;
  promptTokens: number;
  completionTokens: number;
  neurons: number;
  model: string;
  passages: number;
}

/**
 * What the last answer actually cost.
 *
 * Retrieval time, generation time, tokens and neurons, from the numbers the
 * server reported rather than an estimate. It is the clearest way to show that
 * a question runs inside a free daily allowance.
 */
export function PipelineHud({ stats, className }: { stats: PipelineStats; className?: string }) {
  const generationMs = Math.max(0, stats.totalMs - stats.retrievalMs);

  const items = [
    { icon: Search, label: "Retrieval", value: formatDuration(stats.retrievalMs) },
    { icon: Sparkles, label: "Generation", value: formatDuration(generationMs) },
    { icon: Cpu, label: "Tokens", value: `${stats.promptTokens} in / ${stats.completionTokens} out` },
    { icon: Zap, label: "Neurons", value: stats.neurons.toFixed(1) },
  ];

  return (
    <div
      className={cn(
        "grid grid-cols-2 gap-x-4 gap-y-2 rounded-[10px] border border-line bg-sunken",
        "px-3 py-2.5 sm:grid-cols-4",
        className,
      )}
    >
      {items.map((item) => (
        <div key={item.label} className="flex min-w-0 items-center gap-2">
          <item.icon className="h-3.5 w-3.5 shrink-0 text-faint" aria-hidden />
          <div className="min-w-0">
            <p className="text-[0.6875rem] uppercase tracking-wide text-faint">{item.label}</p>
            <p className="truncate font-mono text-[0.75rem] text-ink">{item.value}</p>
          </div>
        </div>
      ))}
      <p className="col-span-2 truncate border-t border-line pt-2 font-mono text-[0.6875rem] text-faint sm:col-span-4">
        {stats.passages} passages retrieved, answered by {stats.model}
      </p>
    </div>
  );
}
