import { FileText, MessageSquare } from "lucide-react";
import { useState, type ReactNode } from "react";

import { cn } from "@/lib/utils";

export type Pane = "reader" | "chat";

/**
 * The reader and the chat, side by side.
 *
 * Two panes fit from 1024 px up. Below that they become one pane with a
 * segmented control, because a split view on a phone gives each half too little
 * width to read comfortably.
 *
 * The pane can be controlled from outside, which matters on a phone: selecting
 * a citation has to bring the document forward, or the highlight lands on a
 * pane the reader cannot see.
 */
export function SplitView({
  reader,
  chat,
  pane: controlledPane,
  onPaneChange,
  className,
}: {
  reader: ReactNode;
  chat: ReactNode;
  pane?: Pane;
  onPaneChange?: (pane: Pane) => void;
  className?: string;
}) {
  const [uncontrolledPane, setUncontrolledPane] = useState<Pane>("chat");
  const pane = controlledPane ?? uncontrolledPane;
  const setPane = (next: Pane) => {
    setUncontrolledPane(next);
    onPaneChange?.(next);
  };

  return (
    <div className={cn("flex min-h-0 min-w-0 flex-1 flex-col", className)}>
      <div
        role="tablist"
        aria-label="Which pane to show"
        className="flex shrink-0 items-center gap-1 border-b border-line bg-raised p-1.5 lg:hidden"
      >
        {(
          [
            { id: "reader", label: "Document", icon: FileText },
            { id: "chat", label: "Answers", icon: MessageSquare },
          ] as const
        ).map((option) => (
          <button
            key={option.id}
            type="button"
            role="tab"
            aria-selected={pane === option.id}
            onClick={() => setPane(option.id)}
            className={cn(
              "flex flex-1 items-center justify-center gap-1.5 rounded-lg px-3 py-2",
              "text-[0.8125rem] font-medium transition-colors",
              pane === option.id ? "bg-sunken text-ink" : "text-muted hover:text-ink",
            )}
          >
            <option.icon className="h-3.5 w-3.5 shrink-0" aria-hidden />
            <span className="truncate">{option.label}</span>
          </button>
        ))}
      </div>

      <div className="grid min-h-0 min-w-0 flex-1 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] xl:grid-cols-[minmax(0,1.05fr)_minmax(0,1fr)]">
        <div
          className={cn(
            "min-h-0 min-w-0 border-line lg:flex lg:flex-col lg:border-r",
            pane === "reader" ? "flex flex-col" : "hidden",
          )}
        >
          {reader}
        </div>
        <div
          className={cn(
            "min-h-0 min-w-0 lg:flex lg:flex-col",
            pane === "chat" ? "flex flex-col" : "hidden",
          )}
        >
          {chat}
        </div>
      </div>
    </div>
  );
}
