import type { Citation } from "@rag/shared";

/**
 * Builds the context block handed to the model.
 *
 * Passages are numbered so the model can cite them, and each carries its source
 * file, heading and page so a citation resolves to somewhere a reader can look.
 * The block is truncated by character budget rather than passage count, so a
 * few long passages cannot push the prompt past the model's context window.
 */
export function buildContextBlock(
  passages: { citation: Citation; text: string }[],
  maxChars: number,
): { block: string; used: Citation[] } {
  const lines: string[] = [];
  const used: Citation[] = [];
  let budget = maxChars;

  for (const passage of passages) {
    const header = [
      `[${passage.citation.index}] ${passage.citation.filename}`,
      passage.citation.heading ? `section: ${passage.citation.heading}` : null,
      passage.citation.page ? `page ${passage.citation.page}` : null,
    ]
      .filter(Boolean)
      .join(", ");

    const entry = `${header}\n${passage.text}`;
    if (entry.length > budget) {
      if (used.length > 0) break;
      lines.push(entry.slice(0, Math.max(0, budget)));
      used.push(passage.citation);
      break;
    }
    lines.push(entry);
    used.push(passage.citation);
    budget -= entry.length + 2;
  }

  return { block: lines.join("\n\n"), used };
}

export function buildUserTurn(question: string, contextBlock: string): string {
  if (contextBlock.length === 0) {
    return [
      "No passages were retrieved for this question.",
      "Tell the reader that the documents do not cover it. Do not answer from general knowledge.",
      "",
      `Question: ${question}`,
    ].join("\n");
  }
  return [
    "Context passages:",
    "",
    contextBlock,
    "",
    `Question: ${question}`,
    "",
    "Answer using only the passages above, citing them with bracketed numbers.",
  ].join("\n");
}

/** Keeps the transcript short enough to leave room for retrieved context. */
export function trimHistory(
  messages: { role: "user" | "assistant"; content: string }[],
  maxTurns: number,
): { role: "user" | "assistant"; content: string }[] {
  if (messages.length <= maxTurns) return messages;
  return messages.slice(messages.length - maxTurns);
}
