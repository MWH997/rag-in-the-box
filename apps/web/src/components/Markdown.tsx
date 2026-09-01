import { memo } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

import { cn } from "@/lib/utils";

/**
 * Rendered markdown.
 *
 * Tables are wrapped in their own scroll container. A wide table is the most
 * common reason a document pane starts scrolling sideways, and the page itself
 * must never do that.
 */
export const Markdown = memo(function Markdown({
  children,
  className,
}: {
  children: string;
  className?: string;
}) {
  return (
    <div className={cn("prose-doc", className)}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          table: ({ children: cells }) => (
            <div className="table-scroll scroll-area">
              <table>{cells}</table>
            </div>
          ),
          a: ({ children: label, href }) => (
            <a
              href={href}
              target="_blank"
              rel="noreferrer noopener"
              className="text-accent-text underline underline-offset-2 wrap-anywhere"
            >
              {label}
            </a>
          ),
          img: ({ alt }) => (
            <span className="inline-block rounded border border-line bg-sunken px-2 py-1 text-xs text-faint">
              {alt || "image"}
            </span>
          ),
        }}
      >
        {children}
      </ReactMarkdown>
    </div>
  );
});
