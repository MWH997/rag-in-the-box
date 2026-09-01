import type { QuotaState } from "@rag/shared";
import { Clock, Info } from "lucide-react";

import { Progress } from "@/components/ui/progress";
import { cn, formatUntil } from "@/lib/utils";

/**
 * The demo's daily allowance, stated plainly.
 *
 * A visitor who runs out should understand that nothing is broken and that the
 * limit exists so the demo keeps costing nothing to run. The message names the
 * reason and when it lifts.
 */
export function QuotaBanner({ quota, className }: { quota: QuotaState; className?: string }) {
  const exhausted = !quota.allowed;
  const visitorFraction = quota.visitor.limit > 0 ? quota.visitor.used / quota.visitor.limit : 0;
  const running = quota.visitor.limit - quota.visitor.used;

  if (exhausted) {
    return (
      <div
        role="status"
        className={cn(
          "flex flex-col gap-2 border-b border-warning/40 bg-warning/10 px-4 py-3 sm:px-6",
          className,
        )}
      >
        <div className="flex min-w-0 items-start gap-2.5">
          <Clock className="mt-0.5 h-4 w-4 shrink-0 text-warning" aria-hidden />
          <div className="min-w-0 space-y-1">
            <p className="text-sm font-medium text-ink">
              {quota.reason ?? "The demo is resting for today."}
            </p>
            <p className="text-[0.8125rem] leading-relaxed text-muted">
              This demo runs on free allowances so it costs nothing to keep online. It opens again
              in about {formatUntil(quota.resetsAt)}. The full project is open source, and hosting
              your own copy has no limit but your own.
            </p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div
      className={cn(
        "flex flex-wrap items-center gap-x-4 gap-y-2 border-b border-line bg-sunken px-4 py-2.5 sm:px-6",
        className,
      )}
    >
      <div className="flex min-w-0 items-center gap-2">
        <Info className="h-3.5 w-3.5 shrink-0 text-faint" aria-hidden />
        <p className="truncate text-[0.8125rem] text-muted">
          Shared demo.{" "}
          <span className="text-ink">
            {running} {running === 1 ? "question" : "questions"} left today
          </span>
          .
        </p>
      </div>
      <div className="ml-auto flex w-full min-w-0 items-center gap-2 sm:w-40">
        <Progress
          value={visitorFraction}
          tone={visitorFraction > 0.8 ? "warning" : "accent"}
          label="Questions used today"
        />
        <span className="shrink-0 font-mono text-[0.6875rem] text-faint">
          {quota.visitor.used}/{quota.visitor.limit}
        </span>
      </div>
    </div>
  );
}
