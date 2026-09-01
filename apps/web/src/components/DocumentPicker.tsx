import type { DocumentSummary } from "@rag/shared";
import { ChevronDown } from "lucide-react";

import { cn } from "@/lib/utils";

/** Chooses which document the reader shows. Hidden when there is only one. */
export function DocumentPicker({
  documents,
  selectedId,
  onSelect,
  className,
}: {
  documents: DocumentSummary[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  className?: string;
}) {
  if (documents.length <= 1) return null;

  return (
    <div className={cn("relative min-w-0", className)}>
      <select
        value={selectedId ?? ""}
        onChange={(event) => onSelect(event.target.value)}
        aria-label="Document to read"
        className={cn(
          "h-8 w-full min-w-0 max-w-[15rem] appearance-none truncate rounded-lg border border-line",
          "bg-sunken pl-2.5 pr-7 text-[0.8125rem] text-ink",
          "focus-visible:border-accent focus-visible:ring-2 focus-visible:ring-accent",
        )}
      >
        {documents.map((document) => (
          <option key={document.id} value={document.id}>
            {document.filename}
          </option>
        ))}
      </select>
      <ChevronDown
        className="pointer-events-none absolute right-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-faint"
        aria-hidden
      />
    </div>
  );
}
