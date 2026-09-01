# RAG in the Box

Ask your documents questions and get answers that show their working. Upload a
file, ask something, and every claim in the answer links back to the passage it
came from, highlighted in the original document beside it.

It runs on the Cloudflare free plan. Not "free to try", not "free for a small
project". The whole thing, on the permanent free tier, with no credit card.

**[Live demo](https://rib.mwhassan.com)** · [Host it yourself](docs/hosting.md) ·
[How it works](docs/architecture.md) · [What free buys you](docs/free-tier.md)

---

## What it does

- Reads PDF, DOCX, CSV, TXT and Markdown files.
- Answers only from your documents, and says so plainly when they do not cover
  the question.
- Numbers every claim, so pressing a number scrolls the source document to the
  sentence behind it.
- Keeps each workspace sealed off from every other one.
- Reports what each answer cost, against the free daily allowances.
- Switches between the free and paid Cloudflare plans from a control in the
  interface.

## Why it is built this way

A Worker on the Cloudflare free plan gets **10 milliseconds of processor time
per request**. Reading a PDF costs hundreds. That single number decided the
architecture:

| Step                | Where it runs                | Why                                                                      |
| ------------------- | ---------------------------- | ------------------------------------------------------------------------ |
| Read the file       | Your browser                 | Extraction is the expensive part, and your own machine has time to spare |
| Split into passages | Your browser                 | Same reason, and it means the server never holds the whole document      |
| Embed and store     | The Worker, in small batches | One outbound call and two writes per request, whatever the file size     |
| Retrieve and answer | The Worker                   | Waiting on a model costs no processor time                               |

Everything else follows from that. There is no queue to configure, no
background job to babysit, and no request that can run long enough to be cut
off. [The full reasoning is in docs/architecture.md](docs/architecture.md).

## Running it locally

Needs Node 24 or newer. Nothing else, and no accounts anywhere.

```bash
git clone https://github.com/MWH997/rag-in-the-box.git
cd rag-in-the-box
npm install
npm run db:migrate:local
npm run dev
```

Open http://localhost:5173 and create a workspace.

Local development runs entirely offline. Vectors live in the local database
instead of Vectorize, and the models are replaced with deterministic stand-ins
so retrieval, streaming, citations and usage accounting all exercise the same
code paths without an API key. See
[docs/architecture.md](docs/architecture.md#running-without-an-account) for what
that does and does not prove.

## Hosting your own

```bash
cp .env.example .env
# fill in CLOUDFLARE_ACCOUNT_ID and CLOUDFLARE_API_TOKEN
./scripts/deploy.sh
```

The script creates the database, the vector index and the secrets, applies the
migrations, and publishes both halves. It skips anything that already exists,
so running it again after a change is safe. `--dry-run` prints what it would do
and touches nothing.

Full walkthrough, including the exact API token permissions and how to put it
on your own domain: **[docs/hosting.md](docs/hosting.md)**.

## What free actually buys you

| Service    | Free allowance                                    | Roughly                                 |
| ---------- | ------------------------------------------------- | --------------------------------------- |
| Workers    | 100,000 requests a day, 10 ms processor time each | plenty                                  |
| Workers AI | 10,000 neurons a day                              | about 150 answers                       |
| D1         | 5 GB, 5M row reads and 100,000 row writes a day   | tens of thousands of passages           |
| Vectorize  | 5M stored vector dimensions                       | about 13,000 passages at 384 dimensions |
| Pages      | unlimited requests, 500 builds a month            | plenty                                  |

The usage screen tracks your own consumption against these numbers. Where each
one comes from, and what happens when you cross it, is in
[docs/free-tier.md](docs/free-tier.md).

## Paid tier

One control in the settings screen switches a workspace to the paid tier. It
raises the limits, lets the Worker parse files itself, turns on optical
character recognition for scanned documents through LlamaParse, and offers the
models that Cloudflare requires a billing method for. Any provider key you add
appears as a choice rather than replacing what is already there.

The Cloudflare paid plan starts at five dollars a month.

## Getting it set up for you

The code is free and always will be. If you would rather not do the setup, I
will do it for **$300, once**:

- Set up on your own Cloudflare account, which stays yours.
- Your domain, your keys, your data. I hold nothing afterwards.
- Your first documents loaded and checked against real questions.
- Tuned so your volume stays inside the free allowances.
- A walkthrough call, and two weeks of questions answered.

If it cannot be made to work on your setup, you pay nothing.
[hello@mwhassan.com](mailto:hello@mwhassan.com?subject=RAG%20in%20the%20Box%20setup)

## Repository layout

```
apps/api        Hono on Cloudflare Workers. Auth, ingestion, retrieval, chat.
apps/web        React on Cloudflare Pages. Reader, chat, usage, settings.
packages/shared Contracts and the chunker, shared by both.
scripts         Deployment and demo seeding.
qa              The layout audit used to check every route at six widths.
docs            Architecture, hosting, free tier, demo, security.
```

## Commands

| Command                         | What it does                                    |
| ------------------------------- | ----------------------------------------------- |
| `npm run dev`                   | Both servers together                           |
| `npm run verify`                | Typecheck, lint and tests, the same set CI runs |
| `npm test`                      | Unit tests                                      |
| `npm run db:migrate:local`      | Apply migrations to the local database          |
| `apps/api/scripts/smoke.sh`     | End to end check against a running local API    |
| `./scripts/deploy.sh --dry-run` | Show what a deployment would do                 |

## Contributing

Commit messages follow [Conventional Commits](https://www.conventionalcommits.org).
See [CONTRIBUTING.md](CONTRIBUTING.md).

## Licence

MIT. See [LICENSE](LICENSE).
