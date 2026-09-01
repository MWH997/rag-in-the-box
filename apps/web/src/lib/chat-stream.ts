import type { ChatEvent, ChatMessage } from "@rag/shared";

import { API_URL, ApiError } from "./api";

/**
 * Consumes the chat endpoint's Server-Sent Events stream.
 *
 * The browser's own EventSource cannot issue a POST, so the stream is read off
 * a fetch body. Frames are parsed incrementally, which is what lets the answer
 * appear a few words at a time instead of arriving in one block at the end.
 */
export async function streamChat(
  body: { messages: ChatMessage[]; documentIds?: string[] },
  onEvent: (event: ChatEvent) => void,
  signal?: AbortSignal,
): Promise<void> {
  const response = await fetch(`${API_URL}/api/chat`, {
    method: "POST",
    credentials: "include",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
    signal,
  });

  if (!response.ok || !response.body) {
    let code = "chat_failed";
    let message = `The request failed with status ${response.status}.`;
    try {
      const payload = (await response.json()) as { error?: string; code?: string };
      code = payload.code ?? code;
      message = payload.error ?? message;
    } catch {
      // Keep the status-derived message.
    }
    throw new ApiError(response.status, code, message);
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });

    let boundary = buffer.indexOf("\n\n");
    while (boundary !== -1) {
      const frame = buffer.slice(0, boundary);
      buffer = buffer.slice(boundary + 2);
      for (const line of frame.split("\n")) {
        if (!line.startsWith("data:")) continue;
        const payload = line.slice(5).trim();
        if (payload.length === 0) continue;
        try {
          onEvent(JSON.parse(payload) as ChatEvent);
        } catch {
          // A frame we cannot parse is skipped rather than ending the stream.
        }
      }
      boundary = buffer.indexOf("\n\n");
    }
  }
}
