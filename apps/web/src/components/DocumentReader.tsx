import type { Citation, DocumentContentResponse } from "@rag/shared";
import { FileText, Loader2 } from "lucide-react";
import { useEffect, useRef } from "react";

import { Markdown } from "@/components/Markdown";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/empty";
import { clearHighlight, highlightPassage } from "@/lib/highlight";
import { cn } from "@/lib/utils";

/**
 * The original document, beside the answer.
 *
 * When a citation is selected the reader finds the passage it refers to,
 * scrolls it into view and paints it. That is the whole point of the pane: an
 * answer is only trustworthy if the sentence behind it is one click away.
 */
export function DocumentReader({
  content,
  loading,
  activeCitation,
  className,
}: {
  content: DocumentContentResponse | null;
  loading: boolean;
  activeCitation: Citation | null;
  className?: string;
}) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const bodyRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    clearHighlight();
    if (!activeCitation || !bodyRef.current || !content) return;
    if (activeCitation.documentId !== content.id) return;

    // Waits a frame so the markdown for a newly loaded document is on screen
    // before the passage is measured.
    const frame = requestAnimationFrame(() => {
      const body = bodyRef.current;
      const scroller = scrollRef.current;
      if (!body || !scroller) return;

      // Where this passage sits in the document, used to break ties when the
      // same words appear in two overlapping passages.
      const lastSegment = content.segments.at(-1);
      const totalChars = lastSegment ? lastSegment.charStart + lastSegment.markdown.length : 0;
      const hint = totalChars > 0 ? activeCitation.charStart / totalChars : null;

      const anchor = highlightPassage(body, activeCitation.snippet, hint);
      const target = anchor ?? body.querySelector(`[data-seq]`);
      if (!target) return;

      const targetTop = target.getBoundingClientRect().top;
      const scrollerTop = scroller.getBoundingClientRect().top;
      scroller.scrollTo({
        top: scroller.scrollTop + targetTop - scrollerTop - 80,
        behavior: "smooth",
      });
    });

    return () => cancelAnimationFrame(frame);
  }, [activeCitation, content]);

  useEffect(() => clearHighlight, []);

  return (
    <section
      className={cn("flex min-h-0 min-w-0 flex-col overflow-hidden bg-raised", className)}
      aria-label="Source document"
    >
      <header className="flex min-w-0 items-center gap-2 border-b border-line px-4 py-3 sm:px-5">
        <FileText className="h-4 w-4 shrink-0 text-faint" aria-hidden />
        <h2 className="min-w-0 flex-1 truncate text-sm font-medium text-ink">
          {content?.filename ?? "Source document"}
        </h2>
        {content && content.pageCount > 0 && (
          <Badge className="shrink-0">
            {content.pageCount} {content.pageCount === 1 ? "page" : "pages"}
          </Badge>
        )}
      </header>

      <div
        ref={scrollRef}
        className="scroll-area min-h-0 flex-1 overflow-y-auto overscroll-contain"
      >
        {loading && (
          <div className="flex items-center justify-center gap-2 py-16 text-sm text-muted">
            <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
            Loading the document
          </div>
        )}

        {!loading && !content && (
          <EmptyState
            icon={FileText}
            title="No document selected"
            description="Pick a document to read it here beside the answers."
          />
        )}

        {!loading && content && (
          <div ref={bodyRef} className="mx-auto max-w-3xl px-4 py-5 sm:px-6 sm:py-7">
            {content.segments.map((segment) => (
              <div key={segment.seq} data-seq={segment.seq} data-char-start={segment.charStart}>
                <Markdown>{segment.markdown}</Markdown>
              </div>
            ))}
          </div>
        )}
      </div>
    </section>
  );
}
