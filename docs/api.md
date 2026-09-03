# The API

Every route below is served by the Worker in `apps/api`. The interface uses the
same routes and nothing else, so anything the interface can do, a script can do.

Bodies and responses are described by the schemas in `packages/shared`, and
`node qa/contract.mjs` checks a running deployment against them.

## How a request is identified

There are three ways in, and which one applies is decided by the deployment
mode rather than by the request.

**A signed-in session.** The normal case on a self-hosted install. The session
cookie is set by the auth routes and carries the workspace. The tenant is read
from the session on the server and never from the request, so a caller cannot
ask for someone else's data by changing a parameter.

**A demo visitor.** In demo mode there is no sign-in. Each browser gets its own
workspace, plus read access to the one curated workspace holding the featured
document.

**The operator token.** Sending both `x-admin-token` and `x-tenant-id` acts as
the named workspace. The token is a deployment secret that never reaches a
browser, and the comparison is constant time. This is how seeding and
provisioning work, and it is the only way to write to a workspace you are not
signed in to.

## Health

### `GET /health`

Open to anyone, outside `/api`, and the one route that needs no identity.

```json
{ "ok": true, "version": "1.0.0", "mode": "demo" }
```

`mode` is `self-host` or `demo`. Everything else about the deployment follows
from it.

## Documents

### `POST /api/documents`

Registers a document before any text is sent. The body carries the filename,
kind, size, page count and how many passages to expect. The response gives the
document id and the batch size this workspace may send per request.

Nothing is uploaded here. The text arrives afterwards in batches, which is what
keeps every invocation inside the free plan's ten milliseconds of processor
time whatever the size of the file.

Refused with `413` when the file is over the tier limit, `409` when the
workspace is at its document or passage allowance, and `429` when the daily
allowance is used up.

### `POST /api/documents/:id/ingest`

Sends a batch of display segments and passages. Set `done` on the last call.
The Worker embeds the passages and stores the vectors. The response reports how
many are embedded so far and how long the Worker spent.

### `POST /api/documents/upload`

The whole file in one request, for deployments on the paid tier where the
Worker is allowed to parse. On the free tier this is refused, because reading a
document costs more processor time than a request is given.

### `POST /api/documents/:id/resume`

Picks up a document left in the parsing state, which happens when a scanned
file was sent to the hosted parser and the job was still running.

### `GET /api/documents`

Lists the workspace's documents with their status and passage counts, and how
much of the workspace allowance is used.

### `GET /api/documents/:id/content`

The document as the reader pane shows it: ordered markdown segments with the
character offset each one starts at, which is how a citation finds its place.

### `POST /api/documents/reindex`

Re-embeds everything after the embedding model changes. Mixing vectors from two
models in one index silently ruins retrieval, so the interface offers this as
soon as it notices the mismatch.

### `DELETE /api/documents/:id`

Removes the document, its passages, its vectors and its stored original.

## Asking questions

### `POST /api/chat`

Takes the conversation so far and streams the answer back as server-sent
events. `documentIds` limits retrieval to particular documents; without it the
whole workspace is searched.

The events, in the order they arrive:

| Event       | Carries                                                |
| ----------- | ------------------------------------------------------ |
| `status`    | Which stage is running, for the progress display       |
| `citations` | The retrieved passages, before the answer starts       |
| `token`     | A piece of the answer                                  |
| `done`      | Token counts, the model that answered, and timings     |
| `error`     | A message and a code, when something failed mid-stream |

Citations arrive before the tokens on purpose. The reader can see what the
answer will be built from while it is still being written.

## Settings

### `GET /api/settings`

The workspace's settings, the catalogue of models this deployment can actually
offer, and whether the settings are read-only, which they are on the demo.

### `PATCH /api/settings`

Changes the tier, the providers and models, the answering instructions, or the
answer tuning. Values outside the allowed range are refused rather than
clamped, so a mistake is visible instead of silently ignored.

## Usage

### `GET /api/usage`

Today and the last fourteen days: questions, documents, tokens, neurons, cost
outside Cloudflare, and the database rows actually read and written. The last
two matter most, because Cloudflare enforces a daily row allowance and a
deployment that crosses it stops answering until midnight UTC.

## Taking your data out

### `GET /api/export`

One JSON file holding the workspace's documents, their extracted text, the
passage boundaries and, where they can be read back, the vectors. It is enough
to rebuild the index somewhere else.

Vectorize cannot return stored vectors in bulk, so under Vectorize the export
says so and names the embedding model instead of quietly omitting the field.

## The demo

### `GET /api/demo/status`

The visitor's remaining allowance, the deployment-wide allowance, which
document is featured, whether uploads are on, how long an upload survives, and
which reading platforms this demo can offer. Reading it consumes nothing, so the
banner can poll it.

### `POST /api/demo/parse`

Hands one file to LlamaParse and returns a job id. Multipart, field `file`.
Demo mode only, and refused unless `DEMO_LLAMAPARSE_ENABLED` is on and a
LlamaCloud key is configured.

Metered on its own `parse` counter rather than the upload one, because it spends
LlamaCloud credits rather than Vectorize storage. A job LlamaCloud refuses gives
the allowance back, so a provider outage does not consume a visitor's attempt.

The job id is returned as `<id>.<signature>`, signed over both the id and the
visitor it belongs to. The bare id is enough to read the markdown back, so an
unsigned one would let anyone holding it read another visitor's document.

### `GET /api/demo/parse/:jobId`

Polls a job. Returns `parsing` while it runs, `completed` with the markdown once
it finishes, and `failed` with a reason otherwise. A job id that does not verify
against this visitor is answered as if it did not exist.

The browser chunks the returned markdown and sends it through the ordinary
`POST /api/documents` and ingest calls, so nothing after the reading differs
from a file the browser extracted itself.

## Operator routes

### `POST /api/admin/provision`

Creates a workspace for someone else and returns a one-time link they use to
set their own password. Needs the admin token as a bearer credential. Refused
in demo mode, where there are no accounts to create.

No password is ever chosen by the operator, so nobody but the account holder
knows it.

## Errors

Every failure is JSON with a stable `code`, so a caller can branch on the code
rather than on the wording.

| Code                       | Status | Means                                                      |
| -------------------------- | ------ | ---------------------------------------------------------- |
| `unauthenticated`          | 401    | No session, on a deployment that needs one                 |
| `quota_exhausted`          | 429    | This caller's daily allowance is gone                      |
| `quota_global_exhausted`   | 429    | The deployment's shared allowance is gone                  |
| `upload_too_large`         | 413    | Over the tier limit                                        |
| `chunk_limit_reached`      | 409    | The workspace is at its passage allowance                  |
| `d1_daily_limit`           | 503    | Cloudflare is refusing database queries until midnight UTC |
| `invalid_request`          | 422    | The body did not match the schema                          |
| `demo_llamaparse_disabled` | 403    | This demo is not offering the LlamaIndex reader            |
| `parse_job_not_found`      | 404    | That parse job was not issued to this visitor              |
| `empty_answer`             | stream | The model finished without writing anything                |

`d1_daily_limit` is the one worth handling deliberately. It is not a fault in
the request, and it clears on its own at midnight UTC.
