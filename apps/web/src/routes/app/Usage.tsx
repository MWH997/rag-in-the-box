import { FREE_NEURONS_PER_DAY, type UsageResponse } from "@rag/shared";
import { useEffect, useState } from "react";

import { Card, CardBody, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { api } from "@/lib/api";
import { cn, formatCount } from "@/lib/utils";

/** A small column chart, drawn inline rather than pulled from a chart library. */
function Sparkbars({ values, labels }: { values: number[]; labels: string[] }) {
  const peak = Math.max(1, ...values);
  return (
    <div className="flex h-24 items-end gap-1" role="img" aria-label="Daily activity, last 14 days">
      {values.map((value, index) => (
        <div
          key={labels[index] ?? index}
          className="group relative flex min-w-0 flex-1 flex-col justify-end"
        >
          <div
            className={cn(
              "w-full rounded-t-[3px] transition-colors",
              value > 0 ? "bg-accent/70 group-hover:bg-accent" : "bg-line",
            )}
            style={{ height: `${Math.max(value > 0 ? 6 : 2, (value / peak) * 100)}%` }}
            title={`${labels[index]}: ${value}`}
          />
        </div>
      ))}
    </div>
  );
}

function BudgetRow({
  label,
  used,
  limit,
  unit,
  note,
}: {
  label: string;
  used: number;
  limit: number;
  unit: string;
  note: string;
}) {
  const fraction = limit > 0 ? used / limit : 0;
  const tone = fraction > 0.9 ? "danger" : fraction > 0.7 ? "warning" : "positive";

  return (
    <div className="min-w-0 space-y-1.5">
      <div className="flex min-w-0 flex-wrap items-baseline justify-between gap-x-3">
        <p className="truncate text-sm text-ink">{label}</p>
        <p className="shrink-0 font-mono text-[0.75rem] text-muted">
          {formatCount(used)} / {formatCount(limit)} {unit}
        </p>
      </div>
      <Progress value={fraction} tone={tone} label={label} />
      <p className="text-[0.75rem] leading-relaxed text-faint">{note}</p>
    </div>
  );
}

export function Usage() {
  const [data, setData] = useState<UsageResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api
      .usage()
      .then(setData)
      .catch(() => setError("Usage could not be loaded."));
  }, []);

  return (
    <div className="scroll-area min-h-0 flex-1 overflow-y-auto">
      <div className="mx-auto w-full max-w-4xl px-4 py-6 sm:px-6 sm:py-8">
        <h1 className="text-xl font-semibold tracking-[-0.02em] text-ink">Usage</h1>
        <p className="mt-1 text-sm text-muted">
          What this workspace has spent today, against the free daily allowances.
        </p>

        {error && <p className="mt-6 text-sm text-danger">{error}</p>}

        {!data && !error && (
          <div className="mt-6 space-y-4">
            {[0, 1].map((row) => (
              <div key={row} className="h-40 animate-pulse rounded-card bg-sunken" />
            ))}
          </div>
        )}

        {data && (
          <div className="mt-6 space-y-4">
            <div className="grid gap-4 sm:grid-cols-3">
              {[
                { label: "Questions today", value: data.today.chatMessages },
                { label: "Documents today", value: data.today.documentsIngested },
                { label: "Neurons today", value: Math.round(data.today.neurons) },
              ].map((stat) => (
                <Card key={stat.label}>
                  <CardBody className="p-4 pt-4 sm:p-5 sm:pt-5">
                    <p className="truncate text-[0.75rem] uppercase tracking-wide text-faint">
                      {stat.label}
                    </p>
                    <p className="mt-1 font-mono text-2xl text-ink">{stat.value}</p>
                  </CardBody>
                </Card>
              ))}
            </div>

            <Card>
              <CardHeader className="border-b border-line">
                <CardTitle>Against the free allowances</CardTitle>
              </CardHeader>
              <CardBody className="space-y-5 pt-4 sm:pt-5">
                <BudgetRow
                  label="Workers AI neurons"
                  used={data.today.neurons}
                  limit={FREE_NEURONS_PER_DAY}
                  unit="today"
                  note="Cloudflare grants 10,000 neurons a day on every plan. Embedding is cheap; the answer is what costs."
                />
                <BudgetRow
                  label="Questions"
                  used={data.today.chatMessages}
                  limit={data.budget.chatMessagesPerDay}
                  unit="today"
                  note="A limit this project sets, not Cloudflare. Raise it in settings once you know your own volume."
                />
                <BudgetRow
                  label="Stored vector dimensions"
                  used={data.budget.vectorDimensionsStored}
                  limit={data.budget.vectorDimensionsStoredLimit}
                  unit="stored"
                  note="Vectorize bills on stored dimensions. Five million is the free ceiling, which is about 13,000 passages at 384 dimensions."
                />
                <BudgetRow
                  label="Database rows read"
                  used={data.today.d1RowsRead}
                  limit={data.budget.d1RowsReadPerDay}
                  unit="today"
                  note="Measured, not estimated. Since 1 September 2026 Cloudflare fails every D1 query once this is crossed, until midnight UTC."
                />
                <BudgetRow
                  label="Database rows written"
                  used={data.today.d1RowsWritten}
                  limit={data.budget.d1RowsWrittenPerDay}
                  unit="today"
                  note="Counted for questions and ingestion only, so treat it as a floor. Ingesting a document is what moves this number."
                />
              </CardBody>
            </Card>

            <Card>
              <CardHeader className="border-b border-line">
                <CardTitle>Last fourteen days</CardTitle>
              </CardHeader>
              <CardBody className="pt-4 sm:pt-5">
                <Sparkbars
                  values={data.history.map((day) => day.chatMessages)}
                  labels={data.history.map((day) => day.day)}
                />
                <div className="mt-2 flex justify-between font-mono text-[0.6875rem] text-faint">
                  <span>{data.history[0]?.day}</span>
                  <span>{data.history.at(-1)?.day}</span>
                </div>
                {data.today.externalCostUsd > 0 && (
                  <p className="mt-4 text-[0.8125rem] text-muted">
                    Spent outside Cloudflare today: ${data.today.externalCostUsd.toFixed(4)}
                  </p>
                )}
              </CardBody>
            </Card>
          </div>
        )}
      </div>
    </div>
  );
}
