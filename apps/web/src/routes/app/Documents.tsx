import type { DocumentListResponse, DocumentSummary } from "@rag/shared";
import { AlertTriangle, FileText, Loader2, Trash2, Upload } from "lucide-react";
import { useCallback, useEffect, useRef, useState, type DragEvent } from "react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardBody, CardHeader, CardTitle } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty";
import { Progress } from "@/components/ui/progress";
import { api, ApiError } from "@/lib/api";
import { ACCEPTED_EXTENSIONS } from "@/lib/extract";
import { ingestFile, type IngestProgress } from "@/lib/ingest";
import { cn, formatBytes, formatDuration } from "@/lib/utils";

const STAGE_LABEL: Record<IngestProgress["stage"], string> = {
  extracting: "Reading the file in your browser",
  chunking: "Splitting it into passages",
  uploading: "Creating the document",
  embedding: "Embedding passages",
  done: "Ready",
};

export function Documents() {
  const [data, setData] = useState<DocumentListResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [progress, setProgress] = useState<IngestProgress | null>(null);
  const [dragging, setDragging] = useState(false);
  const [deleting, setDeleting] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const refresh = useCallback(async () => {
    try {
      setData(await api.documents());
    } catch (error) {
      toast.error(error instanceof ApiError ? error.message : "The list could not be loaded.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const upload = useCallback(
    async (file: File) => {
      if (progress) return;
      try {
        const result = await ingestFile(file, setProgress);
        toast.success(
          `${file.name} is ready. ${result.chunks} passages from ${result.pages} ${result.pages === 1 ? "page" : "pages"}, ` +
            `${formatDuration(result.workerMs)} of server time.`,
        );
        await refresh();
      } catch (error) {
        toast.error(
          error instanceof ApiError || error instanceof Error
            ? error.message
            : "The upload did not finish.",
        );
      } finally {
        setProgress(null);
      }
    },
    [progress, refresh],
  );

  const onDrop = (event: DragEvent) => {
    event.preventDefault();
    setDragging(false);
    const file = event.dataTransfer.files.item(0);
    if (file) void upload(file);
  };

  const remove = async (document: DocumentSummary) => {
    setDeleting(document.id);
    try {
      await api.deleteDocument(document.id);
      toast.success(`${document.filename} was removed.`);
      await refresh();
    } catch (error) {
      toast.error(error instanceof ApiError ? error.message : "It could not be deleted.");
    } finally {
      setDeleting(null);
    }
  };

  const documents = data?.documents ?? [];
  const usage = data?.usage;

  return (
    <div className="scroll-area min-h-0 flex-1 overflow-y-auto">
      <div className="mx-auto w-full max-w-4xl px-4 py-6 sm:px-6 sm:py-8">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div className="min-w-0">
            <h1 className="text-xl font-semibold tracking-[-0.02em] text-ink">Documents</h1>
            <p className="mt-1 text-sm text-muted">
              Files are read in your browser. Only the text reaches the server.
            </p>
          </div>
          {usage && (
            <div className="flex shrink-0 gap-2">
              <Badge>
                {usage.documents} of {usage.maxDocuments} documents
              </Badge>
              <Badge>
                {usage.chunks.toLocaleString()} of {usage.maxChunks.toLocaleString()} passages
              </Badge>
            </div>
          )}
        </div>

        {/* Upload */}
        <div
          onDragOver={(event) => {
            event.preventDefault();
            setDragging(true);
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={onDrop}
          className={cn(
            "mt-6 rounded-card border border-dashed p-6 text-center transition-colors sm:p-8",
            dragging ? "border-accent bg-accent-soft/40" : "border-line-strong bg-raised",
          )}
        >
          <input
            ref={inputRef}
            type="file"
            aria-label="Choose a document to upload"
            className="sr-only"
            accept={ACCEPTED_EXTENSIONS.join(",")}
            onChange={(event) => {
              const file = event.target.files?.item(0);
              if (file) void upload(file);
              event.target.value = "";
            }}
          />

          {progress ? (
            <div className="mx-auto max-w-sm space-y-3">
              <div className="flex items-center justify-center gap-2">
                <Loader2 className="h-4 w-4 animate-spin text-accent" aria-hidden />
                <p className="truncate text-sm font-medium text-ink">
                  {STAGE_LABEL[progress.stage]}
                </p>
              </div>
              <Progress value={progress.fraction} label="Upload progress" />
              <p className="truncate text-[0.8125rem] text-muted">{progress.detail}</p>
              {progress.workerMs !== undefined && (
                <p className="font-mono text-[0.75rem] text-faint">
                  {formatDuration(progress.workerMs)} of server time so far
                </p>
              )}
            </div>
          ) : (
            <div className="space-y-3">
              <span className="mx-auto flex h-11 w-11 items-center justify-center rounded-full border border-line bg-sunken">
                <Upload className="h-5 w-5 text-faint" aria-hidden />
              </span>
              <div className="space-y-1">
                <p className="text-sm font-medium text-ink">Drop a file here</p>
                <p className="text-[0.8125rem] text-muted">
                  {ACCEPTED_EXTENSIONS.join(", ")} up to the limit for your tier
                </p>
              </div>
              <Button variant="secondary" size="sm" onClick={() => inputRef.current?.click()}>
                Choose a file
              </Button>
            </div>
          )}
        </div>

        {/* List */}
        <Card className="mt-6 overflow-hidden">
          <CardHeader className="border-b border-line">
            <CardTitle>Indexed documents</CardTitle>
          </CardHeader>

          {loading ? (
            <CardBody className="pt-4 sm:pt-5">
              <div className="space-y-2">
                {[0, 1, 2].map((row) => (
                  <div key={row} className="h-12 animate-pulse rounded-lg bg-sunken" />
                ))}
              </div>
            </CardBody>
          ) : documents.length === 0 ? (
            <EmptyState
              icon={FileText}
              title="Nothing indexed yet"
              description="Add a file above and it will be ready to ask questions about in a few seconds."
            />
          ) : (
            <ul className="divide-y divide-[color:var(--border)]">
              {documents.map((document) => (
                <li
                  key={document.id}
                  className="flex min-w-0 flex-col gap-2 px-4 py-3 sm:flex-row sm:items-center sm:gap-3 sm:px-5"
                >
                  {/* On a narrow screen the name gets the full width and the
                      status moves below it, because a filename truncated to a
                      few words tells the reader nothing. */}
                  <div className="flex min-w-0 flex-1 items-start gap-3">
                    <FileText className="mt-0.5 h-4 w-4 shrink-0 text-faint" aria-hidden />
                    <div className="min-w-0 flex-1">
                      <p
                        className="line-clamp-2 text-sm font-medium text-ink sm:truncate"
                        title={document.filename}
                      >
                        {document.filename}
                      </p>
                      <p className="truncate text-[0.75rem] text-faint">
                        {formatBytes(document.sizeBytes)}
                        {" · "}
                        {document.embeddedCount} passages
                        {document.pageCount > 1 ? ` · ${document.pageCount} pages` : ""}
                      </p>
                    </div>
                  </div>

                  <div className="flex shrink-0 items-center gap-2 pl-7 sm:pl-0">
                    {document.shared && <Badge>Shared</Badge>}
                    {document.stale && (
                      <Badge tone="warning" title="Embedded with a different model">
                        <AlertTriangle className="h-3 w-3" aria-hidden />
                        Re-index
                      </Badge>
                    )}
                    <Badge tone={document.status === "active" ? "positive" : "neutral"}>
                      {document.status}
                    </Badge>
                    {!document.shared && (
                      <Button
                        variant="ghost"
                        size="icon"
                        aria-label={`Delete ${document.filename}`}
                        disabled={deleting === document.id}
                        onClick={() => void remove(document)}
                      >
                        {deleting === document.id ? (
                          <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
                        ) : (
                          <Trash2 className="h-3.5 w-3.5" aria-hidden />
                        )}
                      </Button>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
    </div>
  );
}
