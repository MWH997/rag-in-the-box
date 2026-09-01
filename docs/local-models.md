# Running real models locally

The project starts with no account anywhere. Out of the box the models are
replaced with deterministic stand-ins, which prove the wiring: retrieval,
streaming, citations, quotas and usage accounting all take the same code path
they take in production. What they cannot tell you is whether the answers are
any good, because they do not think. They quote the passage they matched.

Ollama fixes that. Same code, same code path, real models, still no account.

## Setup

Either install [Ollama](https://ollama.com/download) directly, or use the
compose file in this repository:

```bash
docker compose up -d
```

Then pull the two models the project expects:

```bash
npm run ollama:pull
```

That fetches `all-minilm` for embeddings and `llama3.2:3b` for answers. Both are
small. The chat model runs on a laptop with no graphics card.

Point the API at the server by creating `apps/api/.dev.vars`:

```
OLLAMA_BASE_URL=http://localhost:11434
```

Restart the API, open Settings, and pick the local models under Embedding and
Chat.

## Why these two models

`all-minilm` emits 384 dimensions natively, which is exactly the width of the
default index. That matters more than it sounds. Ollama serves the OpenAI
embeddings API but does not support its `dimensions` parameter, so it cannot
shorten a wider model to fit. A model that emits the wrong width is rejected
before the call rather than silently truncated, because truncating an embedding
that was not trained for it quietly wrecks recall.

`nomic-embed-text` is also offered, at 768 dimensions. Using it means recreating
the index at 768 and re-embedding, which the settings screen will tell you.

## What this does and does not prove

It exercises the real thing:

- Real embeddings, so retrieval ranks by meaning rather than by construction.
- A real model writing real prose, so the citation matcher has to find passages
  in text it did not produce.
- The same streaming, the same quota accounting, the same failure paths.

It does not prove:

- **The 10 ms processor budget.** Local development does not enforce it. A
  Worker that passes here can still be cut off in production, which is why the
  expensive work happens in the browser rather than the Worker.
- **Vectorize.** Cloudflare provides no local emulation, so vectors go to D1
  and search is a brute-force scan. See below.
- **Anything about your Cloudflare account**, including whether the D1 daily
  allowance holds up under your real traffic.

## Vector search locally

Vectorize has no local simulation, which Cloudflare
[states plainly](https://developers.cloudflare.com/workers/local-development/).
So local development stores vectors in D1 and searches by scanning them.

That is a real algorithm giving real results, not a stub, and it is a reasonable
production choice for a few thousand passages. It has one property worth knowing:
a scan reads one D1 row per stored vector, and since 1 September 2026 Cloudflare
meters D1 rows. At the 4,000-vector scan limit that is 1,250 questions a day
before the daily allowance is gone. Vectorize searches without reading D1 rows at
all and has no such ceiling, which is why it is the default for anything
deployed. The settings screen shows which store is live and, when it is D1, what
the ceiling works out to.

To develop against the real Vectorize index instead, run Wrangler with remote
bindings so the binding reaches Cloudflare while the rest stays local. That
needs an account and it does consume your real allowances.

## Turning it off

Delete `OLLAMA_BASE_URL` from `.dev.vars` and restart. The stand-ins come back.

Choosing Ollama outranks the `OFFLINE_AI` flag: the flag means "nothing is
configured, use the stand-ins", and selecting a local provider says something
now is. The usage report asks the same question the dispatcher asks, so the
model named in the answer footer is always the model that produced it.

```bash
docker compose down
```

Pulled models live in a named volume and survive that, so starting again does
not re-download them.
