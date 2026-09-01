import type { Tier } from "@rag/shared";
import { AlertTriangle, Check, Loader2, RefreshCw } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardBody, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Label, Select, Textarea } from "@/components/ui/field";
import { TierSwitch } from "@/components/ui/tier-switch";
import { api, ApiError, type SettingsResponse } from "@/lib/api";
import { announceTierChange } from "@/lib/events";
import { formatBytes } from "@/lib/utils";

const PROVIDER_LABEL: Record<string, string> = {
  "workers-ai": "Cloudflare Workers AI",
  openai: "OpenAI",
  deepseek: "DeepSeek",
};

export function Settings() {
  const [data, setData] = useState<SettingsResponse | null>(null);
  const [saving, setSaving] = useState(false);
  const [reindexing, setReindexing] = useState(false);
  const [prompt, setPrompt] = useState("");

  useEffect(() => {
    api
      .settings()
      .then((response) => {
        setData(response);
        setPrompt(response.settings.systemPrompt);
      })
      .catch(() => toast.error("Settings could not be loaded."));
  }, []);

  const save = async (patch: Parameters<typeof api.updateSettings>[0]) => {
    setSaving(true);
    try {
      const response = await api.updateSettings(patch);
      setData(response);
      setPrompt(response.settings.systemPrompt);
      announceTierChange(response.settings.tier);
      toast.success("Saved.");
    } catch (error) {
      toast.error(error instanceof ApiError ? error.message : "That could not be saved.");
    } finally {
      setSaving(false);
    }
  };

  const reindex = async () => {
    setReindexing(true);
    try {
      const result = await api.reindex();
      toast.success(`Re-indexed ${result.reindexed} documents.`);
      setData(await api.settings());
    } catch (error) {
      toast.error(error instanceof ApiError ? error.message : "Re-indexing did not finish.");
    } finally {
      setReindexing(false);
    }
  };

  if (!data) {
    return (
      <div className="scroll-area min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto w-full max-w-3xl px-4 py-6 sm:px-6 sm:py-8">
          <div className="h-56 animate-pulse rounded-card bg-sunken" />
        </div>
      </div>
    );
  }

  const { settings, catalogue, readOnly } = data;
  const embeddingGroup = catalogue.embedding.find(
    (group) => group.provider === settings.embeddingProvider,
  );
  const chatGroup = catalogue.chat.find((group) => group.provider === settings.chatProvider);

  return (
    <div className="scroll-area min-h-0 flex-1 overflow-y-auto">
      <div className="mx-auto w-full max-w-3xl space-y-4 px-4 py-6 sm:px-6 sm:py-8">
        <div>
          <h1 className="text-xl font-semibold tracking-[-0.02em] text-ink">Settings</h1>
          <p className="mt-1 text-sm text-muted">
            One switch changes the limits, the models and where parsing happens.
          </p>
        </div>

        {readOnly && (
          <div className="flex items-start gap-2.5 rounded-[10px] border border-warning/40 bg-warning/10 px-3.5 py-3">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-warning" aria-hidden />
            <p className="text-[0.8125rem] leading-relaxed text-ink">
              This deployment is the public demo, so its configuration is fixed.
            </p>
          </div>
        )}

        {/* Tier */}
        <Card>
          <CardHeader className="border-b border-line">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="min-w-0">
                <CardTitle>Cloudflare plan</CardTitle>
                <CardDescription>
                  Free keeps every request inside the 10 ms budget of the Workers free plan. Paid
                  lifts the limits and lets the server parse files itself.
                </CardDescription>
              </div>
              <TierSwitch
                value={settings.tier}
                disabled={readOnly || saving}
                onChange={(tier: Tier) => void save({ tier })}
              />
            </div>
          </CardHeader>
          <CardBody className="pt-4 sm:pt-5">
            <dl className="grid gap-3 sm:grid-cols-2">
              {[
                { term: "Largest upload", value: formatBytes(settings.limits.maxUploadBytes) },
                { term: "Documents", value: settings.limits.maxDocuments.toLocaleString() },
                {
                  term: "Questions a day",
                  value: settings.limits.chatMessagesPerDay.toLocaleString(),
                },
                { term: "Passages retrieved", value: String(settings.limits.retrievalTopK) },
                {
                  term: "Passages per request",
                  value: String(settings.limits.ingestBatchSize),
                },
                {
                  term: "Parsing",
                  value: settings.limits.serverSideParsing ? "Server" : "Browser",
                },
                {
                  term: "Scanned documents",
                  value: settings.limits.ocrFallback ? "Yes" : "No",
                },
                {
                  term: "Vector store",
                  value: settings.vectorBackend === "vectorize" ? "Vectorize" : "D1",
                },
              ].map((item) => (
                <div key={item.term} className="flex min-w-0 items-baseline justify-between gap-3">
                  <dt className="truncate text-[0.8125rem] text-muted">{item.term}</dt>
                  <dd className="shrink-0 font-mono text-[0.8125rem] text-ink">{item.value}</dd>
                </div>
              ))}
            </dl>
            {settings.vectorSearchQuestionsPerDay !== null && (
              <p className="mt-4 text-[0.75rem] leading-relaxed text-faint">
                This deployment searches by scanning vectors in D1, which Cloudflare has metered
                since 1 September 2026. That caps it at about{" "}
                {settings.vectorSearchQuestionsPerDay.toLocaleString()} questions a day before the
                daily row allowance runs out. Vectorize searches without reading rows and has no
                such ceiling. It is the default for anything deployed; this store exists so the
                project runs locally, where Cloudflare provides no Vectorize emulation.
              </p>
            )}
          </CardBody>
        </Card>

        {/* Models */}
        <Card>
          <CardHeader className="border-b border-line">
            <CardTitle>Models</CardTitle>
            <CardDescription>
              The index holds {catalogue.indexDimensions}-dimension vectors, so only models that can
              fill that shape are offered.
            </CardDescription>
          </CardHeader>
          <CardBody className="space-y-5 pt-4 sm:pt-5">
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="min-w-0 space-y-1.5">
                <Label htmlFor="chat-provider">Answers from</Label>
                <Select
                  id="chat-provider"
                  value={settings.chatProvider}
                  disabled={readOnly || saving}
                  onChange={(event) => void save({ chatProvider: event.target.value as never })}
                >
                  {catalogue.chat.map((group) => (
                    <option key={group.provider} value={group.provider} disabled={!group.available}>
                      {PROVIDER_LABEL[group.provider] ?? group.provider}
                      {group.available ? "" : ` (needs ${group.requires})`}
                    </option>
                  ))}
                </Select>
              </div>

              <div className="min-w-0 space-y-1.5">
                <Label htmlFor="chat-model">Model</Label>
                <Select
                  id="chat-model"
                  value={settings.chatModel}
                  disabled={readOnly || saving}
                  onChange={(event) => void save({ chatModel: event.target.value })}
                >
                  {chatGroup?.models.map((model) => (
                    <option key={model.id} value={model.id}>
                      {model.label}
                      {model.freeTier ? "" : " (paid)"}
                    </option>
                  ))}
                </Select>
                <p className="text-[0.75rem] leading-relaxed text-faint">
                  {chatGroup?.models.find((model) => model.id === settings.chatModel)?.note}
                </p>
              </div>

              <div className="min-w-0 space-y-1.5">
                <Label htmlFor="embedding-provider">Embeddings from</Label>
                <Select
                  id="embedding-provider"
                  value={settings.embeddingProvider}
                  disabled={readOnly || saving}
                  onChange={(event) =>
                    void save({ embeddingProvider: event.target.value as never })
                  }
                >
                  {catalogue.embedding.map((group) => (
                    <option key={group.provider} value={group.provider} disabled={!group.available}>
                      {PROVIDER_LABEL[group.provider] ?? group.provider}
                      {group.available ? "" : ` (needs ${group.requires})`}
                    </option>
                  ))}
                </Select>
              </div>

              <div className="min-w-0 space-y-1.5">
                <Label htmlFor="embedding-model">Model</Label>
                <Select
                  id="embedding-model"
                  value={settings.embeddingModel}
                  disabled={readOnly || saving}
                  onChange={(event) => void save({ embeddingModel: event.target.value })}
                >
                  {embeddingGroup?.models.map((model) => (
                    <option key={model.id} value={model.id} disabled={!model.fitsIndex}>
                      {model.label} ({model.nativeDimensions}d)
                      {model.fitsIndex ? "" : " does not fit this index"}
                    </option>
                  ))}
                </Select>
              </div>
            </div>

            {settings.reindexRequired && (
              <div className="flex flex-wrap items-center gap-3 rounded-[10px] border border-warning/40 bg-warning/10 px-3.5 py-3">
                <AlertTriangle className="h-4 w-4 shrink-0 text-warning" aria-hidden />
                <p className="min-w-0 flex-1 text-[0.8125rem] leading-relaxed text-ink">
                  Some documents were embedded with a different model. Until they are re-indexed,
                  their passages sit in a different vector space and will not be retrieved reliably.
                </p>
                <Button
                  size="sm"
                  variant="secondary"
                  disabled={reindexing}
                  onClick={() => void reindex()}
                >
                  {reindexing ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
                  ) : (
                    <RefreshCw className="h-3.5 w-3.5" aria-hidden />
                  )}
                  Re-index now
                </Button>
              </div>
            )}
          </CardBody>
        </Card>

        {/* Available providers */}
        <Card>
          <CardHeader className="border-b border-line">
            <CardTitle>Configured on this deployment</CardTitle>
            <CardDescription>
              A provider appears here once its key is set as a Worker secret.
            </CardDescription>
          </CardHeader>
          <CardBody className="pt-4 sm:pt-5">
            <div className="flex flex-wrap gap-2">
              {(
                [
                  ["Workers AI", settings.available.workersAi],
                  ["OpenAI", settings.available.openai],
                  ["DeepSeek", settings.available.deepseek],
                  ["LlamaParse", settings.available.llamaparse],
                  ["R2 storage", settings.available.r2],
                ] as const
              ).map(([label, available]) => (
                <Badge key={label} tone={available ? "positive" : "neutral"}>
                  {available ? <Check className="h-3 w-3" aria-hidden /> : null}
                  {label}
                </Badge>
              ))}
            </div>
          </CardBody>
        </Card>

        {/* Prompt */}
        <Card>
          <CardHeader className="border-b border-line">
            <CardTitle>Answering instructions</CardTitle>
            <CardDescription>
              Sent with every question. Keep the part that tells the model to answer only from the
              passages and to cite them.
            </CardDescription>
          </CardHeader>
          <CardBody className="space-y-3 pt-4 sm:pt-5">
            <Textarea
              value={prompt}
              rows={5}
              disabled={readOnly || saving}
              onChange={(event) => setPrompt(event.target.value)}
              aria-label="Answering instructions"
            />
            <Button
              size="sm"
              disabled={readOnly || saving || prompt === settings.systemPrompt}
              onClick={() => void save({ systemPrompt: prompt })}
            >
              {saving && <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />}
              Save instructions
            </Button>
          </CardBody>
        </Card>
      </div>
    </div>
  );
}
