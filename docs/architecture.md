# How it works

## The constraint everything follows from

A Worker on the Cloudflare free plan gets **10 milliseconds of processor time
per request**. Not wall clock: waiting on a database or a model costs nothing.
Only work the Worker itself does counts.

Ten milliseconds is generous for routing a request and quite a lot of database
work. It is nowhere near enough to read a PDF. Extracting text from a hundred
page document costs hundreds of milliseconds at best. So the usual shape of a
document pipeline, where a file is posted to a server that parses it, cannot
run on the free plan at all.

Two measurements taken inside the Workers runtime on a development machine,
which set the design:

| Operation                                             | Processor time             |
| ----------------------------------------------------- | -------------------------- |
| Reading a 32 page PDF                                 | several hundred ms         |
| Hashing a password with the default scrypt parameters | about 30 ms                |
| Hashing a password with PBKDF2 at 100,000 iterations  | about 5 ms                 |
| One embedding call and two database writes            | under 1 ms of our own work |

The second row is worth pausing on. Sign-in alone would have failed on the free
plan, silently, in a way no local test would catch, because local development
does not enforce the limit.

## The shape that resulted

```
Browser                                 Worker                        Storage
-------                                 ------                        -------
read the file
split it into passages
  |
  |-- POST /api/documents ----------->  create the row  ------------> D1
  |
  |-- POST .../ingest (batch 1) ----->  embed 16 passages ----------> Workers AI
  |                                     write them  ----------------> D1
  |                                     store the vectors ----------> Vectorize
  |-- POST .../ingest (batch 2) ----->  ... same again
  |-- POST .../ingest (batch n, done)

  |-- POST /api/chat ---------------->  embed the question ---------> Workers AI
                                        search  --------------------> Vectorize
                                        read the passages ----------> D1
                                        stream the answer ----------> Workers AI
```

Every request the Worker handles does a bounded amount of its own work. A one
page memo and a four hundred page report cost the same per request; the report
simply sends more requests. Nothing can run long enough to be cut off, and
there is no queue, no background job and no retry loop to operate.

Cloudflare Queues, which would be the obvious way to do this otherwise, is not
on the free plan.

## Retrieval

Documents are stored twice, on purpose.

`document_segments` holds the document as the reader sees it, cut on line
boundaries into pieces of a few kilobytes. The reader pane renders these.

`chunks` holds the retrieval units: overlapping passages of about 1,400
characters, cut on structure first and size second. The text is duplicated from
the segments so that fetching the passages behind an answer is a single query
by primary key, whatever comes back from the vector search. On the free plan a
Worker may issue 50 database queries per request, so leaving headroom matters
more than saving the storage.

### Chunking

The chunker is in `packages/shared` because the browser runs it during upload
and the Worker runs it on the server side path. One implementation means both
produce identical boundaries.

It works structurally first:

1. Split on headings, so a passage never straddles two sections.
2. Inside a section, gather whole blocks (paragraphs, list runs, tables, fenced
   code) until the size budget is reached.
3. A block too large on its own is split on sentence boundaries, then
   whitespace, then mid-word as a last resort.
4. Consecutive passages overlap, so a fact that lands on a boundary still
   appears whole in one of them.

Tables are never split while they fit, and when one must be split the header
row is repeated on each piece. Overlap is never carried across a table, because
the carried tail would be half a row.

Each chunk records `body_start` as well as `char_start`. Because passages
overlap, a chunk's text opens with a tail belonging to the previous passage.
Anything that points a reader at a passage uses `body_start`, or the citation
would scroll to the end of the section before.

### Vector storage

Two backends behind one interface.

**Vectorize** is the default whenever the binding exists. Every write sets both
the namespace and a `tenant_id` metadata value, and every read sets both the
namespace and a `tenant_id` filter. Either alone would isolate tenants. Both
are used so a mistake in one still leaves the other enforcing it.

**D1** is used when no Vectorize binding is configured, which in practice means
local development: Cloudflare provides
[no local simulation for Vectorize](https://developers.cloudflare.com/workers/local-development/),
so without this the project could not run without an account. Vectors are stored
as Float32 blobs and searched by scanning. A scan of 4,000 vectors at 384
dimensions is about 1.5 million multiply-adds, which measures in single digit
milliseconds, so the scan stops at 4,000 to stay inside the processor budget.

Processor time is no longer what caps it, though. A scan reads one D1 row per
stored vector, and since 1 September 2026 Cloudflare enforces a daily allowance
of 5,000,000 rows read. A full scan therefore buys 1,250 questions a day before
every query in the account starts failing, and that is before counting the rest
of the request. Vectorize reads no D1 rows to search at all.

So: Vectorize for anything deployed, D1 for local development and for a corpus
small enough that the scan stays short. The settings screen names the live store
and, when it is D1, works out the ceiling. Both deployment environments in
`wrangler.toml` set `VECTOR_BACKEND = "vectorize"`.

### Dimensions

The index dimension is fixed when the index is created. The default is 384,
which `@cf/baai/bge-small-en-v1.5` emits natively and which OpenAI's
text-embedding-3 models can be asked for directly, since those were trained so
a shortened prefix of the vector is still meaningful.

Models without that property are never truncated to fit. The settings screen
refuses the combination and says why, because quietly cutting a vector down
would degrade recall in a way nobody would notice until answers got worse.

Changing the embedding model changes the vector space, so existing passages
stop being comparable. The app detects this, marks the documents, and offers a
re-index rather than mixing two spaces in one index.

## Tenant isolation

Every table that holds tenant data carries a `tenant_id`, every query filters
on it, and the value always comes from the server side session. No request body
or query parameter can supply one.

`apps/api/scripts/smoke.sh` asserts it end to end: a second workspace cannot
list the first one's document, cannot read its content, and cannot retrieve its
text through a question.

In demo mode there is no sign-in, so each visitor gets their own workspace keyed
to their browser, plus read access to the curated workspace holding the featured
document. The same filtering applies.

## Providers

Nothing hardcodes a model. The runtime reads a provider and a model from the
workspace settings and falls back to the deployment default.

| Purpose           | Options                      |
| ----------------- | ---------------------------- |
| Embeddings        | Workers AI, OpenAI           |
| Answers           | Workers AI, OpenAI, DeepSeek |
| Scanned documents | LlamaParse                   |

A provider only appears in the settings screen once its key is configured, so
the interface never offers something that cannot work. Model identifiers, their
dimensions and their prices live in `packages/shared/src/providers.ts`, each one
read from the vendor's own documentation.

## The free and paid switch

The tier is a per-workspace setting. It changes:

|                       | Free  | Paid    |
| --------------------- | ----- | ------- |
| Largest upload        | 8 MB  | 100 MB  |
| Documents             | 25    | 5,000   |
| Passages              | 4,000 | 200,000 |
| Passages per request  | 16    | 96      |
| Questions a day       | 100   | 5,000   |
| Passages retrieved    | 6     | 12      |
| Parsing in the Worker | no    | yes     |
| Scanned documents     | no    | yes     |

These are product decisions, not platform facts. The platform facts are in
[free-tier.md](free-tier.md).

## Running without an account

`OFFLINE_AI=true` replaces the model providers with deterministic stand-ins:
embeddings become a hashed bag-of-words projection, and answers quote the
retrieved passages instead of generating new text. Combined with the D1 vector
backend, the whole application runs with no account anywhere.

This proves the plumbing: retrieval, streaming, citation resolution, quota
accounting and the interface all exercise the same code paths as a real
deployment. It proves nothing about answer quality, and it says so in the
interface, which reports the answer as coming from the offline provider rather
than crediting a model that never ran.

For real models with still no account anywhere, point `OLLAMA_BASE_URL` at a
local Ollama server and pick the local models in settings. That gives genuine
embeddings and genuine prose while everything else stays local. Choosing a local
provider outranks `OFFLINE_AI`, and the usage report asks the same question the
dispatcher asks, so the model named under an answer is always the one that
produced it. See [local-models.md](local-models.md).

The deployment script refuses to publish with `OFFLINE_AI` set.

## Passwords

`apps/api/src/lib/password.ts` uses PBKDF2-HMAC-SHA256 through WebCrypto at
100,000 iterations by default, chosen from the measurement above.

That is below the 600,000 OWASP currently suggests for this algorithm. It is a
deliberate trade against a hard platform limit rather than an oversight, and it
is stated here rather than buried. On the Workers Paid plan, set
`PASSWORD_KDF_ITERATIONS=600000`; it costs about 35 ms, which the paid budget
absorbs easily.

Each hash records the iteration count it was made with, so raising the setting
never locks anyone out.

## What is not here

- **No email.** Password reset links are returned to the operator by the
  provisioning script rather than sent. Adding an email provider is a small
  change; leaving it out keeps the free tier claim true.
- **No background jobs.** Deliberate, as above.
- **No multi-user workspaces.** One account, one workspace. The organisation
  tables exist and the plumbing supports more, but nothing exposes it.
