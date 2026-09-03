import type { DemoReader, DemoStatusResponse } from "@rag/shared";
import { Download, Loader2, Upload } from "lucide-react";
import { useRef, useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { ReaderSwitch } from "@/components/ui/reader-switch";
import { api, ApiError } from "@/lib/api";
import { ACCEPTED_EXTENSIONS } from "@/lib/extract";
import { ingestFile, type IngestProgress } from "@/lib/ingest";
import { formatBytes, formatDuration } from "@/lib/utils";

const STAGE_LABEL: Record<IngestProgress["stage"], string> = {
  extracting: "Reading it in your browser",
  parsing: "LlamaIndex is reading it",
  chunking: "Splitting it into passages",
  uploading: "Creating the document",
  embedding: "Embedding passages",
  done: "Ready",
};

/**
 * Lets a demo visitor run one file of their own through the pipeline.
 *
 * The curated document proves the product answers questions. It cannot prove it
 * answers questions about *your* document, which is the only question a visitor
 * actually has. One small file settles it.
 *
 * The retention is stated before the upload, not after, and the export sits
 * next to it so the answer to "what happens to my file" comes with the means to
 * keep the work.
 */
export function DemoTryBar({
  status,
  onUploaded,
}: {
  status: DemoStatusResponse;
  onUploaded: () => void | Promise<void>;
}) {
  const [progress, setProgress] = useState<IngestProgress | null>(null);
  const [exporting, setExporting] = useState(false);
  const [reader, setReader] = useState<DemoReader>("cloudflare");
  const inputRef = useRef<HTMLInputElement>(null);

  // LlamaIndex has a budget of its own, so it can run out while uploads have
  // not. Falling back to Cloudflare is better than refusing the upload: the
  // visitor still gets an answer about their own document.
  const llamaAvailable = status.readers.llamaindex && status.parsesRemaining > 0;
  const effectiveReader: DemoReader = llamaAvailable ? reader : "cloudflare";
  const canUpload = status.uploadsEnabled && status.uploadsRemaining > 0 && !progress;

  const upload = async (file: File) => {
    if (progress) return;
    if (file.size > status.maxUploadBytes) {
      toast.error(
        `That file is ${formatBytes(file.size)}. The demo takes up to ${formatBytes(status.maxUploadBytes)}.`,
      );
      return;
    }
    try {
      const result = await ingestFile(file, setProgress, effectiveReader);
      toast.success(
        `${file.name} is ready. ${result.chunks} passages, ${formatDuration(result.workerMs)} of server time. Ask it something.`,
      );
      await onUploaded();
    } catch (error) {
      toast.error(
        error instanceof ApiError || error instanceof Error
          ? error.message
          : "The upload did not finish.",
      );
    } finally {
      setProgress(null);
    }
  };

  const exportWorkspace = async () => {
    setExporting(true);
    try {
      const blob = await api.exportBlob();
      // Held only long enough for the click. Revoking it afterwards keeps the
      // browser from pinning the whole export in memory for the session.
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = `rag-export-${new Date().toISOString().slice(0, 10)}.json`;
      document.body.append(anchor);
      anchor.click();
      anchor.remove();
      URL.revokeObjectURL(url);
    } catch (error) {
      toast.error(error instanceof ApiError ? error.message : "The export could not be prepared.");
    } finally {
      setExporting(false);
    }
  };

  if (!status.uploadsEnabled && !status.hasOwnDocuments) return null;

  return (
    <div className="shrink-0 border-b border-line bg-raised px-4 py-2.5 sm:px-6">
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
        <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1.5">
          <Loader2 className="h-4 w-4 shrink-0 animate-spin text-accent" aria-hidden />
          <p className="min-w-0 shrink truncate text-[0.8125rem] font-medium text-ink">
            {STAGE_LABEL[progress.stage]}
          </p>
          <div className="min-w-[8rem] flex-1">
            <Progress value={progress.fraction} label="Upload progress" />
          </div>
          <p className="shrink-0 truncate font-mono text-[0.75rem] text-faint">{progress.detail}</p>
        </div>
      ) : (
        <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-2">
          <p className="min-w-0 shrink text-[0.8125rem] leading-relaxed text-muted">
            {status.uploadsRemaining > 0 ? (
              <>
                Try it on your own file. One document up to {formatBytes(status.maxUploadBytes)},
                deleted after {status.retentionHours} hours.
              </>
            ) : status.hasOwnDocuments ? (
              <>
                Your document is here until it is deleted, {status.retentionHours} hours after you
                added it. Export it to keep it.
              </>
            ) : (
              <>You have used your upload for today. It resets at midnight UTC.</>
            )}
            {status.readers.llamaindex && status.uploadsRemaining > 0 && (
              <>
                {" "}
                {llamaAvailable ? (
                  effectiveReader === "llamaindex" ? (
                    <>LlamaIndex will read it, so a scan works.</>
                  ) : (
                    <>Cloudflare reads it in this page. Switch to LlamaIndex for a scan.</>
                  )
                ) : (
                  <>LlamaIndex is used up for today, so Cloudflare reads it.</>
                )}
              </>
            )}
          </p>

          <div className="ml-auto flex shrink-0 items-center gap-2">
            {status.readers.llamaindex && status.uploadsEnabled && (
              <ReaderSwitch
                value={effectiveReader}
                onChange={setReader}
                disabled={!canUpload || !llamaAvailable}
              />
            )}
            {status.hasOwnDocuments && (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => void exportWorkspace()}
                disabled={exporting}
              >
                {exporting ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
                ) : (
                  <Download className="h-3.5 w-3.5" aria-hidden />
                )}
                Export
              </Button>
            )}
            {status.uploadsEnabled && (
              <Button
                variant="secondary"
                size="sm"
                onClick={() => inputRef.current?.click()}
                disabled={!canUpload}
              >
                <Upload className="h-3.5 w-3.5" aria-hidden />
                Add a file
              </Button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
