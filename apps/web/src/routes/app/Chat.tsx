import { RotateCcw } from "lucide-react";
import { useState } from "react";

import { ChatPane } from "@/components/ChatPane";
import { DocumentPicker } from "@/components/DocumentPicker";
import { DocumentReader } from "@/components/DocumentReader";
import { SplitView, type Pane } from "@/components/SplitView";
import { Button } from "@/components/ui/button";
import { useWorkspace } from "@/hooks/use-workspace";

const SUGGESTIONS = [
  "What is this document about?",
  "What are the main obligations it sets out?",
  "List every date it mentions",
];

export function Chat() {
  const workspace = useWorkspace();
  const [pane, setPane] = useState<Pane>("chat");

  // Selecting a citation brings the document forward on a narrow screen.
  const showCitation = (citation: Parameters<typeof workspace.selectCitation>[0]) => {
    workspace.selectCitation(citation);
    setPane("reader");
  };

  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col">
      <div className="flex h-12 shrink-0 items-center gap-2 border-b border-line bg-raised px-4 sm:px-6">
        <h1 className="shrink-0 text-sm font-medium text-ink">Answers</h1>
        <div className="ml-auto flex min-w-0 items-center gap-2">
          <DocumentPicker
            documents={workspace.documents}
            selectedId={workspace.selectedId}
            onSelect={workspace.setSelectedId}
          />
          {workspace.turns.length > 0 && (
            <Button variant="ghost" size="sm" onClick={workspace.resetConversation}>
              <RotateCcw className="h-3.5 w-3.5" aria-hidden />
              <span className="hidden sm:inline">Reset</span>
            </Button>
          )}
        </div>
      </div>

      <SplitView
        pane={pane}
        onPaneChange={setPane}
        reader={
          <DocumentReader
            content={workspace.content}
            loading={workspace.contentLoading || workspace.documentsLoading}
            activeCitation={workspace.activeCitation}
            className="h-full"
          />
        }
        chat={
          <ChatPane
            turns={workspace.turns}
            streaming={workspace.streaming}
            stage={workspace.stage}
            activeCitation={workspace.activeCitation}
            suggestions={SUGGESTIONS}
            disabled={workspace.documents.length === 0}
            disabledReason={
              workspace.documents.length === 0
                ? "Add a document first, then ask about it here."
                : null
            }
            onSend={(question) => void workspace.send(question)}
            onStop={workspace.stop}
            onSelectCitation={showCitation}
            className="h-full"
          />
        }
      />
    </div>
  );
}
