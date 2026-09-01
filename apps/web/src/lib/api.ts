import type {
  CreateDocumentRequest,
  DemoStatusResponse,
  DocumentContentResponse,
  DocumentListResponse,
  HealthResponse,
  IngestRequest,
  IngestResponse,
  MeResponse,
  TenantSettings,
  UpdateSettingsRequest,
  UsageResponse,
} from "@rag/shared";

export const API_URL = import.meta.env.VITE_API_URL ?? "http://localhost:8787";

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly details?: unknown,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`${API_URL}${path}`, {
      ...init,
      credentials: "include",
      headers: {
        ...(init?.body ? { "content-type": "application/json" } : {}),
        ...init?.headers,
      },
    });
  } catch {
    throw new ApiError(0, "network_error", "The API could not be reached.");
  }

  if (response.status === 204) return undefined as T;

  const text = await response.text();
  let payload: unknown = null;
  if (text.length > 0) {
    try {
      payload = JSON.parse(text);
    } catch {
      payload = null;
    }
  }

  if (!response.ok) {
    const body = payload as { error?: string; code?: string; details?: unknown } | null;
    throw new ApiError(
      response.status,
      body?.code ?? "request_failed",
      body?.error ?? `The request failed with status ${response.status}.`,
      body?.details,
    );
  }

  return payload as T;
}

export interface SettingsCatalogue {
  tiers: readonly string[];
  indexDimensions: number;
  embedding: {
    provider: string;
    available: boolean;
    requires: string | null;
    models: {
      id: string;
      label: string;
      note: string;
      freeTier: boolean;
      nativeDimensions: number;
      fitsIndex: boolean;
    }[];
  }[];
  chat: {
    provider: string;
    available: boolean;
    requires: string | null;
    models: { id: string; label: string; note: string; freeTier: boolean }[];
  }[];
}

export interface SettingsResponse {
  settings: TenantSettings;
  catalogue: SettingsCatalogue;
  readOnly: boolean;
}

export const api = {
  health: () => request<HealthResponse>("/health"),
  me: () => request<MeResponse>("/api/me"),
  documents: () => request<DocumentListResponse>("/api/documents"),
  documentContent: (id: string) =>
    request<DocumentContentResponse>(`/api/documents/${encodeURIComponent(id)}/content`),
  createDocument: (body: CreateDocumentRequest) =>
    request<{ documentId: string; batchSize: number }>("/api/documents", {
      method: "POST",
      body: JSON.stringify(body),
    }),
  ingest: (id: string, body: IngestRequest) =>
    request<IngestResponse>(`/api/documents/${encodeURIComponent(id)}/ingest`, {
      method: "POST",
      body: JSON.stringify(body),
    }),
  deleteDocument: (id: string) =>
    request<{ deleted: string }>(`/api/documents/${encodeURIComponent(id)}`, { method: "DELETE" }),
  settings: () => request<SettingsResponse>("/api/settings"),
  updateSettings: (body: UpdateSettingsRequest) =>
    request<SettingsResponse>("/api/settings", { method: "PATCH", body: JSON.stringify(body) }),
  usage: () => request<UsageResponse>("/api/usage"),
  demoStatus: () => request<DemoStatusResponse>("/api/demo/status"),
  /**
   * The export as a blob, so the browser can hand it to the visitor as a file.
   *
   * It does not go through `request`, which parses JSON into an object. The
   * export can be several megabytes and parsing it only to serialise it again
   * would double the memory for no gain.
   */
  exportBlob: async (): Promise<Blob> => {
    const response = await fetch(`${API_URL}/api/export`, { credentials: "include" });
    if (!response.ok) {
      const body = (await response.json().catch(() => null)) as {
        error?: string;
        code?: string;
      } | null;
      throw new ApiError(
        response.status,
        body?.code ?? "export_failed",
        body?.error ?? "The export could not be prepared.",
      );
    }
    return response.blob();
  },
  reindex: () => request<{ reindexed: number }>("/api/documents/reindex", { method: "POST" }),
};
