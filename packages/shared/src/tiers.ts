/**
 * Tier definitions.
 *
 * "free" is sized so a deployment stays inside the Cloudflare free plan.
 * "paid" is sized for the Workers Paid plan, which starts at five dollars a
 * month, and turns on the server-side parsing path plus larger models.
 *
 * Every number here is a product decision, not a platform fact. The platform
 * facts live in docs/free-tier.md with links to Cloudflare's own limit pages.
 */

export const TIERS = ["free", "paid"] as const;
export type Tier = (typeof TIERS)[number];

export interface TierLimits {
  /** Largest single upload accepted, in bytes. */
  maxUploadBytes: number;
  /** Documents a tenant may keep at once. */
  maxDocuments: number;
  /** Chunks a tenant may keep at once, which is what Vectorize storage bills on. */
  maxChunksPerTenant: number;
  /** Chunks embedded per ingest request. Bounded to stay inside the CPU budget. */
  ingestBatchSize: number;
  /** Chat messages allowed per tenant per calendar day (UTC). */
  chatMessagesPerDay: number;
  /** Documents a tenant may ingest per calendar day (UTC). */
  documentsPerDay: number;
  /** Chunks retrieved per question. */
  retrievalTopK: number;
  /** Whether the Worker itself may parse binary files. */
  serverSideParsing: boolean;
  /** Whether scanned documents may be sent to LlamaParse. */
  ocrFallback: boolean;
}

export const TIER_LIMITS: Record<Tier, TierLimits> = {
  free: {
    maxUploadBytes: 8 * 1024 * 1024,
    maxDocuments: 25,
    maxChunksPerTenant: 4_000,
    ingestBatchSize: 16,
    chatMessagesPerDay: 100,
    documentsPerDay: 10,
    retrievalTopK: 6,
    serverSideParsing: false,
    ocrFallback: false,
  },
  paid: {
    maxUploadBytes: 100 * 1024 * 1024,
    maxDocuments: 5_000,
    maxChunksPerTenant: 200_000,
    ingestBatchSize: 96,
    chatMessagesPerDay: 5_000,
    documentsPerDay: 500,
    retrievalTopK: 12,
    serverSideParsing: true,
    ocrFallback: true,
  },
};

export function limitsFor(tier: Tier): TierLimits {
  return TIER_LIMITS[tier];
}

/**
 * Answer tuning, and the range each value may take.
 *
 * These are the knobs that trade cost against answer quality, so they are per
 * workspace rather than fixed in the source. The bounds are what keeps a
 * mistake cheap: the context budget is the single largest driver of prompt
 * cost, and Workers AI bills on tokens in as well as out.
 */
export const ANSWER_TUNING = {
  contextCharBudget: {
    default: 9_000,
    min: 1_000,
    max: 32_000,
    label: "Context budget",
    help: "Characters of retrieved passages sent with the question. More context can answer harder questions and costs proportionally more per answer.",
  },
  maxAnswerTokens: {
    default: 700,
    min: 128,
    max: 4_000,
    label: "Longest answer",
    help: "Tokens the model may spend replying. Output tokens usually cost several times what input tokens cost.",
  },
  temperature: {
    default: 0.1,
    min: 0,
    max: 1,
    step: 0.05,
    label: "Temperature",
    help: "How much the model may vary its wording. Low keeps answers close to the source, which is what makes citations line up.",
  },
} as const;
