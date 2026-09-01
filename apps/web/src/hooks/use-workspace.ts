import {
  CHAT_MODELS,
  findChatModel,
  neuronsForChat,
  type Citation,
  type DocumentContentResponse,
  type DocumentSummary,
} from "@rag/shared";
import { useCallback, useEffect, useRef, useState } from "react";

import type { Turn } from "@/components/ChatPane";
import { api, ApiError } from "@/lib/api";
import { streamChat } from "@/lib/chat-stream";

/**
 * State for the side-by-side workspace.
 *
 * Both the public demo and the signed-in app render the same reader and chat
 * panes, so the behaviour that connects them lives here once: which document is
 * open, which passage a citation points at, and the streaming answer.
 */
export function useWorkspace() {
  const [documents, setDocuments] = useState<DocumentSummary[]>([]);
  const [documentsLoading, setDocumentsLoading] = useState(true);
  const [documentsError, setDocumentsError] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [content, setContent] = useState<DocumentContentResponse | null>(null);
  const [contentLoading, setContentLoading] = useState(false);
  const [turns, setTurns] = useState<Turn[]>([]);
  const [streaming, setStreaming] = useState(false);
  const [stage, setStage] = useState<string | null>(null);
  const [activeCitation, setActiveCitation] = useState<Citation | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const refreshDocuments = useCallback(async () => {
    setDocumentsLoading(true);
    try {
      const response = await api.documents();
      // Only finished documents are offered here. A document still embedding,
      // or one whose ingestion was interrupted, has no passages to retrieve, so
      // listing it would just be an option that answers nothing. The documents
      // screen still shows every document with its real status.
      setDocuments(response.documents.filter((document) => document.status === "active"));
      setDocumentsError(null);
      const usable = response.documents.filter((document) => document.status === "active");
      setSelectedId((current) => {
        if (current && usable.some((document) => document.id === current)) return current;
        return usable[0]?.id ?? null;
      });
      return response;
    } catch (error) {
      setDocumentsError(
        error instanceof ApiError ? error.message : "The document list could not be loaded.",
      );
      return null;
    } finally {
      setDocumentsLoading(false);
    }
  }, []);

  useEffect(() => {
    void refreshDocuments();
  }, [refreshDocuments]);

  useEffect(() => {
    if (!selectedId) {
      setContent(null);
      return;
    }
    let cancelled = false;
    setContentLoading(true);
    api
      .documentContent(selectedId)
      .then((response) => {
        if (!cancelled) setContent(response);
      })
      .catch(() => {
        if (!cancelled) setContent(null);
      })
      .finally(() => {
        if (!cancelled) setContentLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [selectedId]);

  const selectCitation = useCallback((citation: Citation) => {
    setActiveCitation(citation);
    setSelectedId(citation.documentId);
  }, []);

  const stop = useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = null;
    setStreaming(false);
    setStage(null);
  }, []);

  const send = useCallback(
    async (question: string, options?: { documentIds?: string[]; onQuotaError?: () => void }) => {
      if (streaming) return;

      const history = turns
        .filter((turn) => !turn.error)
        .map((turn) => ({ role: turn.role, content: turn.content }))
        .filter((message) => message.content.length > 0);

      const answerId = crypto.randomUUID();
      setTurns((current) => [
        ...current,
        {
          id: crypto.randomUUID(),
          role: "user",
          content: question,
          citations: [],
          stats: null,
          error: null,
        },
        { id: answerId, role: "assistant", content: "", citations: [], stats: null, error: null },
      ]);

      setStreaming(true);
      setStage("retrieving");
      setActiveCitation(null);

      const controller = new AbortController();
      abortRef.current = controller;

      const update = (patch: Partial<Turn>) => {
        setTurns((current) =>
          current.map((turn) => (turn.id === answerId ? { ...turn, ...patch } : turn)),
        );
      };

      let answer = "";
      let citations: Citation[] = [];

      try {
        await streamChat(
          {
            messages: [...history, { role: "user", content: question }],
            documentIds: options?.documentIds,
          },
          (event) => {
            switch (event.type) {
              case "status":
                setStage(event.stage);
                break;
              case "citations":
                citations = event.citations;
                update({ citations });
                break;
              case "token":
                answer += event.text;
                update({ content: answer });
                break;
              case "done": {
                // Neurons are Cloudflare's unit, so they only mean anything for
                // a Workers AI model. OpenAI and DeepSeek bill in their own
                // currency and the offline development provider bills nothing,
                // so both report zero rather than a number that looks like a
                // Cloudflare cost.
                const model = CHAT_MODELS["workers-ai"].some(
                  (candidate) => candidate.id === event.model,
                )
                  ? findChatModel("workers-ai", event.model)
                  : undefined;
                update({
                  stats: {
                    retrievalMs: event.retrievalMs,
                    totalMs: event.totalMs,
                    promptTokens: event.promptTokens,
                    completionTokens: event.completionTokens,
                    neurons: model
                      ? neuronsForChat(model, event.promptTokens, event.completionTokens)
                      : 0,
                    model: event.model,
                    passages: citations.length,
                  },
                });
                break;
              }
              case "error":
                update({ error: event.message });
                if (event.code.startsWith("quota")) options?.onQuotaError?.();
                break;
            }
          },
          controller.signal,
        );
      } catch (error) {
        if (controller.signal.aborted) {
          update({ error: answer.length > 0 ? null : "Stopped." });
        } else {
          const message =
            error instanceof ApiError ? error.message : "The answer could not be generated.";
          update({ error: message });
          if (error instanceof ApiError && error.code.startsWith("quota")) {
            options?.onQuotaError?.();
          }
        }
      } finally {
        abortRef.current = null;
        setStreaming(false);
        setStage(null);
      }
    },
    [streaming, turns],
  );

  return {
    documents,
    documentsLoading,
    documentsError,
    selectedId,
    setSelectedId,
    content,
    contentLoading,
    turns,
    streaming,
    stage,
    activeCitation,
    selectCitation,
    setActiveCitation,
    send,
    stop,
    refreshDocuments,
    resetConversation: () => setTurns([]),
  };
}
