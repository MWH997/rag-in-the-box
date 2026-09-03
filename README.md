# RAG in the Box

Ask your documents questions and get answers that show their working. Upload a
file, ask something, and every claim in the answer links back to the passage it
came from, highlighted in the original document beside it.

It runs on the Cloudflare free plan. Not "free to try", not "free for a small
project". The whole thing, on the permanent free tier, with no credit card.

**[Live demo](https://rib.mwhassan.com)** · [Documentation](https://rib.mwhassan.com/docs) ·
[Host it yourself](docs/hosting.md) · [How it works](docs/architecture.md) ·
[What free buys you](docs/free-tier.md)

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
code paths without an API key.

For real models with still no account anywhere, run Ollama:

```bash
docker compose up -d
npm run ollama:pull
```

Set `OLLAMA_BASE_URL` in `apps/api/.dev.vars`, then pick the local models in
Settings. Details, and what each setup does and does not prove, are in
[docs/local-models.md](docs/local-models.md).

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

Cloudflare began enforcing the D1 row limits on 1 September 2026. Past either
one, D1 queries fail until midnight UTC. The usage screen measures your actual
row consumption rather than estimating it, so you can see the line coming.
Where each number comes from, and what happens when you cross it, is in
[docs/free-tier.md](docs/free-tier.md).

## Other model providers

Nothing else is required. With no provider keys at all, Workers AI answers
questions and embeds passages, and every free tier figure above is measured
against exactly that.

Four more are supported, and each one adds a choice rather than replacing what
already works:

| Provider   | What it adds                                                                            | Key                   | Billed by                               |
| ---------- | --------------------------------------------------------------------------------------- | --------------------- | --------------------------------------- |
| OpenAI     | answers, and the only embedding models that fit the default index without recreating it | `OPENAI_API_KEY`      | OpenAI                                  |
| DeepSeek   | answers, cheaper per token than the OpenAI models                                       | `DEEPSEEK_API_KEY`    | DeepSeek                                |
| LlamaIndex | reads scanned pages, which nothing else here can                                        | `LLAMA_CLOUD_API_KEY` | LlamaCloud, free within a monthly grant |
| Ollama     | answers and embeddings on your own machine                                              | `OLLAMA_BASE_URL`     | nobody                                  |

Add a key, run `./scripts/check-credentials.sh` to confirm it works before
spending a deployment on it, deploy, then pick the model on the settings screen.
Until you pick it, nothing has changed and the key costs nothing. A provider
whose key is absent is hidden rather than offered and then refused.

What each one costs, when it is worth adding, and the two things that catch
people out are in [docs/providers.md](docs/providers.md).

The public demo carries a toggle between the two free platforms, Cloudflare and
LlamaIndex, so a visitor can see what a different reader does to their own
document before installing anything. A scanned page is the case that separates
them: the Cloudflare path cannot read one at all, because there is no text in
the file to extract.

## Paid tier

One control in the settings screen switches a workspace to the paid tier. It
raises the limits, lets the Worker parse files itself, turns on optical
character recognition for scanned documents through LlamaParse, and offers the
models that Cloudflare requires a billing method for.

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
[devwahid5@gmail.com](mailto:devwahid5@gmail.com?subject=RAG%20in%20the%20Box%20setup)

## Repository layout

```
apps/api        Hono on Cloudflare Workers. Auth, ingestion, retrieval, chat.
apps/web        React on Cloudflare Pages. Reader, chat, usage, settings.
packages/shared Contracts and the chunker, shared by both.
scripts         Deployment and demo seeding.
qa              Layout, accessibility and contract audits, and the runner
                that starts everything and fails the build on a finding.
docs            Architecture, the API, free tier, providers, hosting, local
                models, the demo and security. The site renders these files.
```

## Commands

| Command                          | What it does                                           |
| -------------------------------- | ------------------------------------------------------ |
| `npm run dev`                    | Both servers together                                  |
| `npm run ollama:up`              | Start a local model server in Docker                   |
| `npm run ollama:pull`            | Fetch the local models                                 |
| `npm run verify`                 | Typecheck, lint, format and tests                      |
| `npm run qa`                     | Prose, secrets, API contract, layout and accessibility |
| `npm run prose`                  | Check the writing for machine-sounding tics            |
| `./scripts/check-credentials.sh` | Confirm every credential in .env works                 |
| `npm test`                       | Unit tests                                             |
| `npm run db:migrate:local`       | Apply migrations to the local database                 |
| `apps/api/scripts/smoke.sh`      | End to end check against a running local API           |
| `./scripts/deploy.sh --dry-run`  | Show what a deployment would do                        |

## Contributing

Commit messages follow [Conventional Commits](https://www.conventionalcommits.org).
See [CONTRIBUTING.md](CONTRIBUTING.md).

## Licence

MIT. See [LICENSE](LICENSE).
