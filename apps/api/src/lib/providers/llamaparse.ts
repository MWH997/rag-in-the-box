import type { Env } from "../../env.js";
import { ProviderError } from "./types.js";

/**
 * LlamaParse client for the scanned-document fallback.
 *
 * Endpoints and field names come from the LlamaParse v2 REST reference:
 *   POST /api/v2/parse/upload            multipart, field "file", JSON "configuration"
 *   GET  /api/v2/parse/{job_id}          status at job.status
 *   GET  /api/v2/parse/{job_id}?expand=markdown_full   concatenated markdown
 *
 * The free plan grants 10,000 credits a month and the cost_effective tier costs
 * 3 credits a page, so roughly 3,300 pages a month cost nothing. That is why
 * cost_effective is the default tier here rather than agentic at 10 credits.
 */

const BASE_URL = "https://api.cloud.llamaindex.ai/api/v2/parse";

export type LlamaParseTier = "fast" | "cost_effective" | "agentic" | "agentic_plus";

export type LlamaParseStatus = "PENDING" | "RUNNING" | "COMPLETED" | "FAILED" | "CANCELLED";

function requireKey(env: Env): string {
  const key = env.LLAMA_CLOUD_API_KEY;
  if (!key) {
    throw new ProviderError(
      "LLAMA_CLOUD_API_KEY is not configured",
      "llamaparse_missing_key",
      400,
    );
  }
  return key;
}

async function readError(response: Response): Promise<string> {
  const body = await response.text().catch(() => "");
  return `${response.status} ${body.slice(0, 300)}`;
}

/** Submits a file and returns the job id. The body is streamed, never buffered. */
export async function submitParseJob(
  env: Env,
  file: Blob,
  filename: string,
  tier: LlamaParseTier = "cost_effective",
): Promise<string> {
  const form = new FormData();
  form.append("file", file, filename);
  form.append("configuration", JSON.stringify({ tier, version: "latest" }));

  const response = await fetch(`${BASE_URL}/upload`, {
    method: "POST",
    headers: { authorization: `Bearer ${requireKey(env)}` },
    body: form,
  });

  if (!response.ok) {
    throw new ProviderError(
      `LlamaParse upload failed: ${await readError(response)}`,
      "llamaparse_upload_failed",
    );
  }

  const payload = (await response.json()) as { id?: string };
  if (!payload.id) {
    throw new ProviderError("LlamaParse upload returned no job id", "llamaparse_no_job_id");
  }
  return payload.id;
}

export async function getJobStatus(env: Env, jobId: string): Promise<LlamaParseStatus> {
  const response = await fetch(`${BASE_URL}/${encodeURIComponent(jobId)}`, {
    headers: { authorization: `Bearer ${requireKey(env)}` },
  });
  if (!response.ok) {
    throw new ProviderError(
      `LlamaParse status failed: ${await readError(response)}`,
      "llamaparse_status_failed",
    );
  }
  // The create response puts status at the top level; the read response nests it
  // under `job`. Read both so neither shape silently yields undefined.
  const payload = (await response.json()) as {
    status?: LlamaParseStatus;
    job?: { status?: LlamaParseStatus };
  };
  const status = payload.job?.status ?? payload.status;
  if (!status) {
    throw new ProviderError("LlamaParse status response had no status", "llamaparse_no_status");
  }
  return status;
}

export async function getJobMarkdown(env: Env, jobId: string): Promise<string> {
  const url = `${BASE_URL}/${encodeURIComponent(jobId)}?expand=markdown_full`;
  const response = await fetch(url, {
    headers: { authorization: `Bearer ${requireKey(env)}` },
  });
  if (!response.ok) {
    throw new ProviderError(
      `LlamaParse result failed: ${await readError(response)}`,
      "llamaparse_result_failed",
    );
  }
  const payload = (await response.json()) as {
    markdown_full?: string;
    job?: { markdown_full?: string; pages?: { markdown?: string }[] };
    pages?: { markdown?: string }[];
  };
  const full = payload.markdown_full ?? payload.job?.markdown_full;
  if (typeof full === "string" && full.length > 0) return full;

  const pages = payload.job?.pages ?? payload.pages ?? [];
  const joined = pages
    .map((page) => page.markdown ?? "")
    .filter((markdown) => markdown.length > 0)
    .join("\n\n---\n\n");
  if (joined.length === 0) {
    throw new ProviderError("LlamaParse returned no markdown", "llamaparse_empty_result");
  }
  return joined;
}
