import type { DemoStatusResponse } from "@rag/shared";
import { ArrowLeft, RotateCcw } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router";

import { ChatPane } from "@/components/ChatPane";
import { DemoTryBar } from "@/components/DemoTryBar";
import { DocumentPicker } from "@/components/DocumentPicker";
import { DocumentReader } from "@/components/DocumentReader";
import { GithubMark, Wordmark } from "@/components/Logo";
import { QuotaBanner } from "@/components/QuotaBanner";
import { SplitView, type Pane } from "@/components/SplitView";
import { Button } from "@/components/ui/button";
import { useWorkspace } from "@/hooks/use-workspace";
import { brand } from "@/lib/brand";
import { api } from "@/lib/api";

const REPO_URL = brand.repoUrl;

/**
 * Opening questions for the curated document.
 *
 * These are about whatever was seeded, so a deployment that seeds something
 * else needs its own. Set VITE_DEMO_SUGGESTIONS to a list separated by a pipe.
 * The defaults suit the NIST Cybersecurity Framework that scripts/seed-demo.ts
 * loads; asking that document about safety requirements or deadlines produces
 * a shrug, which is a poor first impression to hand a visitor.
 */
const SUGGESTIONS = (import.meta.env.VITE_DEMO_SUGGESTIONS ?? "")
  .split("|")
  .map((question) => question.trim())
  .filter((question) => question.length > 0)
  .slice(0, 6);

const DEFAULT_SUGGESTIONS = [
  "What is this document about?",
  "What are the core functions it defines?",
  "How does it say to measure progress?",
  "Who is it written for?",
];

/**
 * The public demo.
 *
 * No sign-in, one curated document already indexed, and a daily allowance that
 * keeps the deployment inside every free tier it depends on. A visitor who runs
 * out is told why and when it lifts, rather than meeting a broken page.
 *
 * A visitor may also add one small file of their own. The curated document
 * shows the product works; only their own file shows it works on what they
 * care about. Those uploads are deleted a few hours later, which is said before
 * the upload rather than after, and they can export everything first.
 */
export function Demo() {
  const workspace = useWorkspace();
  const [status, setStatus] = useState<DemoStatusResponse | null>(null);
  const [pane, setPane] = useState<Pane>("chat");

  // Selecting a citation brings the document forward. On a wide screen both
  // panes are already visible and this changes nothing.
  const showCitation = (citation: Parameters<typeof workspace.selectCitation>[0]) => {
    workspace.selectCitation(citation);
    setPane("reader");
  };

  const refreshStatus = useCallback(async () => {
    try {
      setStatus(await api.demoStatus());
    } catch {
      setStatus(null);
    }
  }, []);

  useEffect(() => {
    void refreshStatus();
  }, [refreshStatus]);

  const quotaBlocked = status ? !status.quota.allowed : false;

  // Retrieval is scoped to the document on screen. Without this a visitor who
  // uploads their own file gets an answer built mostly from the curated one,
  // which is the opposite of what they came to find out, and the citations
  // would point into a document the reader pane is not showing.
  const handleSend = (question: string) => {
    void workspace
      .send(question, {
        documentIds: workspace.selectedId ? [workspace.selectedId] : undefined,
        onQuotaError: refreshStatus,
      })
      .then(refreshStatus);
  };

  return (
    <div className="flex h-dvh min-w-0 flex-col overflow-hidden bg-bg">
      <header className="flex h-14 shrink-0 items-center gap-3 border-b border-line bg-raised px-4 sm:px-6">
        <Link
          to="/"
          className="-mx-1 flex min-w-0 shrink items-center gap-2 rounded-lg px-1 py-1.5"
        >
          <ArrowLeft className="h-4 w-4 shrink-0 text-faint sm:hidden" aria-hidden />
          <Wordmark className="hidden sm:flex" />
          <span className="truncate text-sm font-medium text-ink sm:hidden">Demo</span>
        </Link>

        <div className="ml-auto flex min-w-0 items-center gap-2">
          <DocumentPicker
            documents={workspace.documents}
            selectedId={workspace.selectedId}
            onSelect={workspace.setSelectedId}
            className="hidden sm:block"
          />
          {workspace.turns.length > 0 && (
            <Button
              variant="ghost"
              size="sm"
              onClick={workspace.resetConversation}
              aria-label="Start a new conversation"
            >
              <RotateCcw className="h-3.5 w-3.5" aria-hidden />
              <span className="hidden sm:inline">Reset</span>
            </Button>
          )}
          <a
            href={REPO_URL}
            target="_blank"
            rel="noreferrer noopener"
            className="shrink-0 rounded-lg p-2 text-muted transition-colors hover:bg-sunken hover:text-ink"
            aria-label="Source on GitHub"
          >
            <GithubMark className="h-4 w-4" aria-hidden />
          </a>
        </div>
      </header>

      {status && <QuotaBanner quota={status.quota} className="shrink-0" />}

      {status && (
        <DemoTryBar
          status={status}
          onUploaded={async () => {
            await Promise.all([workspace.refreshDocuments(), refreshStatus()]);
          }}
        />
      )}

      {workspace.documents.length > 1 && (
        <div className="shrink-0 border-b border-line bg-raised px-4 py-2 sm:hidden">
          <DocumentPicker
            documents={workspace.documents}
            selectedId={workspace.selectedId}
            onSelect={workspace.setSelectedId}
            className="max-w-none"
          />
        </div>
      )}

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
            suggestions={SUGGESTIONS.length > 0 ? SUGGESTIONS : DEFAULT_SUGGESTIONS}
            disabled={quotaBlocked || workspace.documents.length === 0}
            disabledReason={
              quotaBlocked
                ? (status?.quota.reason ?? "The daily allowance is used up.")
                : workspace.documents.length === 0
                  ? "No document has been loaded into this demo yet."
                  : null
            }
            onSend={handleSend}
            onStop={workspace.stop}
            onSelectCitation={showCitation}
            className="h-full"
          />
        }
      />
    </div>
  );
}
