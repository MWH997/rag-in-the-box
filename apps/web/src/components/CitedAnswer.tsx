import type { Citation } from "@rag/shared";
import { Children, isValidElement, type ReactNode } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

/**
 * The answer, with its bracketed citations turned into buttons.
 *
 * The model is asked to write "[1]" after a claim. Those markers are rewritten
 * into controls that select the passage, so a reader can move from a sentence
 * in the answer to the sentence in the source that supports it.
 */

const MARKER = /\[(\d{1,2})\]/g;

function decorate(
  children: ReactNode,
  citations: Citation[],
  onSelect: (citation: Citation) => void,
  activeIndex: number | null,
): ReactNode {
  return Children.map(children, (child, childKey) => {
    if (typeof child === "string") {
      const pieces: ReactNode[] = [];
      let cursor = 0;
      for (const match of child.matchAll(MARKER)) {
        const index = Number.parseInt(match[1] ?? "", 10);
        const citation = citations.find((candidate) => candidate.index === index);
        const at = match.index ?? 0;
        if (at > cursor) pieces.push(child.slice(cursor, at));
        cursor = at + match[0].length;

        if (!citation) {
          pieces.push(match[0]);
          continue;
        }
        pieces.push(
          <button
            key={`${childKey}-${at}`}
            type="button"
            onClick={() => onSelect(citation)}
            title={`${citation.filename}${citation.page ? `, page ${citation.page}` : ""}`}
            aria-label={`Show source ${index} in the document`}
            className={
              "tap-target relative mx-0.5 inline-flex h-[1.15rem] min-w-[1.15rem] items-center " +
              "justify-center rounded border px-1 align-baseline font-mono text-[0.6875rem] " +
              "leading-none transition-colors " +
              (activeIndex === index
                ? "border-accent bg-accent text-accent-contrast"
                : "border-accent/40 bg-accent-soft text-accent-text hover:border-accent")
            }
          >
            {index}
          </button>,
        );
      }
      if (pieces.length === 0) return child;
      if (cursor < child.length) pieces.push(child.slice(cursor));
      return pieces;
    }

    if (isValidElement(child)) {
      const element = child as React.ReactElement<{ children?: ReactNode }>;
      if (element.props.children) {
        return {
          ...element,
          props: {
            ...element.props,
            children: decorate(element.props.children, citations, onSelect, activeIndex),
          },
        };
      }
    }
    return child;
  });
}

export function CitedAnswer({
  text,
  citations,
  activeIndex,
  onSelect,
}: {
  text: string;
  citations: Citation[];
  activeIndex: number | null;
  onSelect: (citation: Citation) => void;
}) {
  const wrap = (children: ReactNode) => decorate(children, citations, onSelect, activeIndex);

  return (
    <div className="prose-doc">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          p: ({ children }) => <p>{wrap(children)}</p>,
          li: ({ children }) => <li>{wrap(children)}</li>,
          td: ({ children }) => <td>{wrap(children)}</td>,
          table: ({ children }) => (
            <div className="table-scroll scroll-area">
              <table>{children}</table>
            </div>
          ),
        }}
      >
        {text}
      </ReactMarkdown>
    </div>
  );
}
