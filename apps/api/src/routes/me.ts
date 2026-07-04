import { Hono } from "hono";
import { eq } from "drizzle-orm";
import type { Env } from "../env.js";
import { requireAuth, type AuthVariables } from "../middleware/require-auth.js";
import { createDb } from "../db/index.js";
import { user } from "../db/schema.js";

export const meRoute = new Hono<{ Bindings: Env; Variables: AuthVariables }>();

meRoute.get("/me", requireAuth, async (c) => {
  const db = createDb(c.env.DB);
  const userId = c.get("userId");
  const [row] = await db.select({ email: user.email }).from(user).where(eq(user.id, userId));

  return c.json({
    userId,
    tenantId: c.get("tenantId"),
    email: row?.email,
  });
});
