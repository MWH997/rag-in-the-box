import { Hono } from "hono";
import { z } from "zod";
import { eq } from "drizzle-orm";
import type { Env } from "../env.js";
import { requireAuth, type AuthVariables } from "../middleware/require-auth.js";
import { createDb } from "../db/index.js";
import { documents } from "../db/schema.js";

export const documentsRoute = new Hono<{ Bindings: Env; Variables: AuthVariables }>();

const MAX_UPLOAD_BYTES = 100 * 1024 * 1024;

const EXTENSION_MIME_MAP = {
  pdf: "application/pdf",
  csv: "text/csv",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  txt: "text/plain",
  md: "text/markdown",
} as const;

const UploadMeta = z.object({
  filename: z.string().min(1).max(255),
  extension: z.enum(["pdf", "csv", "docx", "txt", "md"]),
  sizeBytes: z
    .number()
    .int()
    .positive()
    .max(MAX_UPLOAD_BYTES, `File exceeds the ${MAX_UPLOAD_BYTES} byte limit`),
});

function sanitizeFilename(filename: string): string {
  return filename.replace(/[^a-zA-Z0-9._-]/g, "_");
}

documentsRoute.post("/documents", requireAuth, async (c) => {
  const formData = await c.req.formData();
  const file = formData.get("file");

  if (!(file instanceof File)) {
    return c.json(
      { error: { code: "invalid_upload", message: "Missing 'file' field in form data" } },
      422,
    );
  }

  const extension = file.name.split(".").pop()?.toLowerCase();
  const parsed = UploadMeta.safeParse({
    filename: file.name,
    extension,
    sizeBytes: file.size,
  });

  if (!parsed.success) {
    return c.json(
      { error: { code: "invalid_upload", message: "Invalid file", issues: parsed.error.issues } },
      422,
    );
  }

  const tenantId = c.get("tenantId");
  const sanitizedFilename = sanitizeFilename(parsed.data.filename);
  const mimeType = EXTENSION_MIME_MAP[parsed.data.extension];
  const db = createDb(c.env.DB);

  const [inserted] = await db
    .insert(documents)
    .values({
      tenantId,
      filename: sanitizedFilename,
      mimeType,
      sizeBytes: parsed.data.sizeBytes,
      status: "uploading",
    })
    .returning();

  if (!inserted) {
    return c.json({ error: { code: "insert_failed", message: "Could not create document" } }, 500);
  }

  const r2Key = `${tenantId}/${inserted.id}/${sanitizedFilename}`;

  // Stream directly to R2 — never buffer the whole file into an ArrayBuffer.
  await c.env.BUCKET.put(r2Key, file.stream());

  await db
    .update(documents)
    .set({ r2Key, updatedAt: Date.now() })
    .where(eq(documents.id, inserted.id));

  return c.json({ documentId: inserted.id });
});
