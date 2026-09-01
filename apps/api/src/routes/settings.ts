import {
  CHAT_MODELS,
  EMBEDDING_MODELS,
  TIERS,
  UpdateSettingsRequest,
  embeddingFitsIndex,
} from "@rag/shared";
import { Hono } from "hono";

import { capabilities, indexDimensions, type Env } from "../env.js";
import { loadSettings, saveSettings, toApiSettings } from "../lib/settings.js";
import type { AppEnv } from "../middleware/tenant.js";

export const settingsRoute = new Hono<AppEnv>();

/**
 * The catalogue the settings screen renders.
 *
 * Options a deployment cannot actually use are still listed, with the reason
 * attached, so an operator can see what adding a key would make available
 * instead of wondering why a provider is missing.
 */
function catalogue(env: Env) {
  const caps = capabilities(env);
  const dimensions = indexDimensions(env);

  return {
    tiers: TIERS,
    indexDimensions: dimensions,
    embedding: Object.entries(EMBEDDING_MODELS).map(([provider, models]) => ({
      provider,
      available: provider === "openai" ? caps.openai : caps.workersAi,
      requires: provider === "openai" ? "OPENAI_API_KEY" : null,
      models: models.map((model) => ({
        id: model.id,
        label: model.label,
        note: model.note,
        freeTier: model.freeTier,
        nativeDimensions: model.nativeDimensions,
        fitsIndex: embeddingFitsIndex(model, dimensions),
      })),
    })),
    chat: Object.entries(CHAT_MODELS).map(([provider, models]) => ({
      provider,
      available:
        provider === "openai"
          ? caps.openai
          : provider === "deepseek"
            ? caps.deepseek
            : caps.workersAi,
      requires:
        provider === "openai"
          ? "OPENAI_API_KEY"
          : provider === "deepseek"
            ? "DEEPSEEK_API_KEY"
            : null,
      models: models.map((model) => ({
        id: model.id,
        label: model.label,
        note: model.note,
        freeTier: model.freeTier,
      })),
    })),
  };
}

settingsRoute.get("/settings", async (c) => {
  const db = c.get("db");
  const tenant = c.get("tenant");
  const resolved = await loadSettings(db, c.env, tenant.tenantId);
  return c.json({
    settings: await toApiSettings(db, c.env, tenant.tenantId, resolved),
    catalogue: catalogue(c.env),
    readOnly: tenant.mode === "demo",
  });
});

settingsRoute.patch("/settings", async (c) => {
  const db = c.get("db");
  const tenant = c.get("tenant");

  // The public demo runs on one fixed configuration. Letting visitors change
  // the model would let them spend the shared daily allowance far faster.
  if (tenant.mode === "demo") {
    return c.json({ error: "Settings are fixed on the public demo.", code: "demo_read_only" }, 403);
  }

  const patch = UpdateSettingsRequest.parse(await c.req.json());
  const resolved = await saveSettings(db, c.env, tenant.tenantId, patch);
  return c.json({
    settings: await toApiSettings(db, c.env, tenant.tenantId, resolved),
    catalogue: catalogue(c.env),
    readOnly: false,
  });
});
