import type { Citation } from "@rag/shared";
import { AlertTriangle, ArrowUp, MessageSquare, Square } from "lucide-react";
import { useEffect, useRef, useState, type FormEvent, type KeyboardEvent } from "react";

import { CitedAnswer } from "@/components/CitedAnswer";
import { PipelineHud, type PipelineStats } from "@/components/PipelineHud";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty";
import { Textarea } from "@/components/ui/field";
import { cn } from "@/lib/utils";

export interface Turn {
  id: string;
  role: "user" | "assistant";
  content: string;
  citations: Citation[];
  stats: PipelineStats | null;
  error: string | null;
}

export function ChatPane({
  turns,
  streaming,
  stage,
  activeCitation,
  suggestions,
  disabled,
  disabledReason,
  onSend,
  onStop,
  onSelectCitation,
  className,
}: {
  turns: Turn[];
  streaming: boolean;
  stage: string | null;
  activeCitation: Citation | null;
  suggestions: string[];
  disabled: boolean;
  disabledReason: string | null;
  onSend: (question: string) => void;
  onStop: () => void;
  onSelectCitation: (citation: Citation) => void;
  className?: string;
}) {
  const [draft, setDraft] = useState("");
  const listRef = useRef<HTMLDivElement>(null);
  const endRef = useRef<HTMLDivElement>(null);

  // Follows the answer as it streams, but only while the reader is already at
  // the bottom, so scrolling up to re-read is never yanked back.
  useEffect(() => {
    const list = listRef.current;
    if (!list) return;
    const distanceFromBottom = list.scrollHeight - list.scrollTop - list.clientHeight;
    if (distanceFromBottom < 160) {
      endRef.current?.scrollIntoView({ behavior: streaming ? "auto" : "smooth" });
    }
  }, [turns, streaming]);

  const submit = (event?: FormEvent) => {
    event?.preventDefault();
    const question = draft.trim();
    if (!question || streaming || disabled) return;
    setDraft("");
    onSend(question);
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      submit();
    }
  };

  return (
    <section
      className={cn("flex min-h-0 min-w-0 flex-col overflow-hidden bg-bg", className)}
      aria-label="Questions and answers"
    >
      <div
        ref={listRef}
        className="scroll-area min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 py-5 sm:px-6"
      >
        <div className="mx-auto flex max-w-2xl flex-col gap-5">
          {turns.length === 0 && (
            <EmptyState
              icon={MessageSquare}
              title="Ask the document a question"
              description="Answers come only from the source document, and every claim links back to the passage it came from."
              action={
                suggestions.length > 0 ? (
                  <div className="flex flex-wrap justify-center gap-2 pt-1">
                    {suggestions.map((suggestion) => (
                      <button
                        key={suggestion}
                        type="button"
                        disabled={disabled}
                        onClick={() => onSend(suggestion)}
                        className={cn(
                          "max-w-full rounded-full border border-line bg-raised px-3 py-1.5",
                          "text-left text-[0.8125rem] text-muted transition-colors",
                          "hover:border-line-strong hover:text-ink",
                          "disabled:cursor-not-allowed disabled:opacity-50",
                        )}
                      >
                        <span className="line-clamp-2">{suggestion}</span>
                      </button>
                    ))}
                  </div>
                ) : undefined
              }
            />
          )}

          {turns.map((turn) =>
            turn.role === "user" ? (
              <div key={turn.id} className="flex justify-end">
                <p
                  className={cn(
                    "wrap-anywhere max-w-[85%] rounded-2xl rounded-br-md bg-accent",
                    "px-3.5 py-2.5 text-sm leading-relaxed text-accent-contrast",
                  )}
                >
                  {turn.content}
                </p>
              </div>
            ) : (
              <article key={turn.id} className="flex min-w-0 flex-col gap-3">
                {turn.error ? (
                  <div className="flex items-start gap-2.5 rounded-[10px] border border-danger/40 bg-danger/10 px-3.5 py-3">
                    <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-danger" aria-hidden />
                    <p className="wrap-anywhere text-sm leading-relaxed text-ink">{turn.error}</p>
                  </div>
                ) : (
                  <div className="wrap-anywhere min-w-0">
                    <CitedAnswer
                      text={turn.content || (streaming ? "" : "No answer was produced.")}
                      citations={turn.citations}
                      activeIndex={activeCitation?.index ?? null}
                      onSelect={onSelectCitation}
                    />
                    {turn.content.length === 0 && streaming && (
                      <span className="inline-block h-4 w-2 animate-pulse rounded-sm bg-accent align-middle" />
                    )}
                  </div>
                )}

                {turn.citations.length > 0 && (
                  <div className="flex min-w-0 flex-wrap gap-1.5">
                    {turn.citations.map((citation) => (
                      <button
                        key={citation.chunkId}
                        type="button"
                        onClick={() => onSelectCitation(citation)}
                        className={cn(
                          "flex min-w-0 max-w-full items-center gap-1.5 rounded-full border px-2.5 py-1",
                          "text-[0.6875rem] transition-colors",
                          activeCitation?.chunkId === citation.chunkId
                            ? "border-accent bg-accent-soft text-accent-text"
                            : "border-line bg-raised text-muted hover:border-line-strong hover:text-ink",
                        )}
                      >
                        <span className="font-mono">{citation.index}</span>
                        <span className="truncate">{citation.filename}</span>
                        {citation.page && (
                          <span className="shrink-0 text-faint">p{citation.page}</span>
                        )}
                      </button>
                    ))}
                  </div>
                )}

                {turn.stats && <PipelineHud stats={turn.stats} />}
              </article>
            ),
          )}

          {streaming && stage && (
            <p className="font-mono text-[0.75rem] text-faint" aria-live="polite">
              {stage === "retrieving" ? "Searching the documents" : "Writing the answer"}
              <span className="animate-pulse">...</span>
            </p>
          )}

          <div ref={endRef} />
        </div>
      </div>

      <form
        onSubmit={submit}
        className="border-t border-line bg-raised px-4 py-3 sm:px-6"
        style={{ paddingBottom: "max(0.75rem, env(safe-area-inset-bottom))" }}
      >
        <div className="mx-auto max-w-2xl">
          {disabled && disabledReason && (
            <p className="mb-2 text-[0.75rem] leading-relaxed text-warning">{disabledReason}</p>
          )}
          <div className="flex items-end gap-2">
            <Textarea
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              onKeyDown={handleKeyDown}
              disabled={disabled}
              rows={1}
              placeholder={disabled ? "Unavailable right now" : "Ask about the document"}
              aria-label="Your question"
              className="max-h-40 min-h-10 flex-1 resize-y"
            />
            {streaming ? (
              <Button variant="secondary" size="icon" onClick={onStop} aria-label="Stop generating">
                <Square className="h-3.5 w-3.5" aria-hidden />
              </Button>
            ) : (
              <Button
                type="submit"
                size="icon"
                disabled={disabled || draft.trim().length === 0}
                aria-label="Send question"
              >
                <ArrowUp className="h-4 w-4" aria-hidden />
              </Button>
            )}
          </div>
        </div>
      </form>
    </section>
  );
}
