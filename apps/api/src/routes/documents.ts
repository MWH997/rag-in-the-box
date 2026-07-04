import { Hono } from "hono";
import { z } from "zod";
import { eq } from "drizzle-orm";
import type { Env } from "../env.js";
import { requireAuth, type AuthVariables } from "../middleware/require-auth.js";
import { createDb } from "../db/index.js";
import { documents } from "../db/schema.js";
import { routeDocument, TRIAGE } from "../lib/router.js";

export const documentsRoute = new Hono<{ Bindings: Env; Variables: AuthVariables }>();

const MAX_UPLOAD_BYTES = 100 * 1024 * 1024;

const EXTENSION_MIME_MAP = {
  pdf: "application/pdf",
  csv: "text/csv",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  txt: "text/plain",
  md: "text/markdown",
} as const;

// .txt/.csv/.md are never routed to LlamaParse (TICKET-32 rule 2), and local
// parsing needs the whole file in memory, so anything over the router's own
// local-size ceiling has nowhere safe to go and is rejected outright here
// rather than accepted and failing later.
const NEVER_LLAMAPARSE_EXTENSIONS = new Set(["txt", "csv", "md"]);

const UploadMeta = z
  .object({
    filename: z.string().min(1).max(255),
    extension: z.enum(["pdf", "csv", "docx", "txt", "md"]),
    sizeBytes: z
      .number()
      .int()
      .positive()
      .max(MAX_UPLOAD_BYTES, `File exceeds the ${MAX_UPLOAD_BYTES} byte limit`),
  })
  .refine(
    (value) =>
      !NEVER_LLAMAPARSE_EXTENSIONS.has(value.extension) || value.sizeBytes <= TRIAGE.MAX_LOCAL_BYTES,
    {
      message: `.txt/.csv/.md files must be at most ${TRIAGE.MAX_LOCAL_BYTES} bytes — they are always parsed locally and cannot fall back to LlamaParse`,
      path: ["sizeBytes"],
    },
  );

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

  // Materializing the whole file here (via file.arrayBuffer()) is expected
  // for local parsing — unlike the R2 upload above, the parsers in TICKET-31
  // inherently need the full buffer resident, which is exactly why the
  // 20 MB router size guard exists in the first place. Blobs/Files are
  // re-readable, so this is independent of the .stream() already consumed
  // by BUCKET.put() above.
  await routeDocument(
    c.env,
    { id: inserted.id, tenantId, filename: sanitizedFilename, sizeBytes: parsed.data.sizeBytes },
    () => file.arrayBuffer(),
  );

  return c.json({ documentId: inserted.id });
});
