# Model providers

Nothing here is required. A deployment with no provider keys at all works:
Cloudflare Workers AI answers questions and embeds passages, and that is what
every free tier number in this project is measured against.

Each key below adds a choice. It never replaces what is already working, and
nothing is switched over until someone picks it on the settings screen.

## What each one is for

| Provider   | What it does here            | Key                   | Billed by  | Free?               |
| ---------- | ---------------------------- | --------------------- | ---------- | ------------------- |
| Workers AI | answers and embeddings       | none, it is a binding | Cloudflare | yes                 |
| OpenAI     | answers and embeddings       | `OPENAI_API_KEY`      | OpenAI     | no                  |
| DeepSeek   | answers                      | `DEEPSEEK_API_KEY`    | DeepSeek   | no                  |
| LlamaIndex | reads scans and hard layouts | `LLAMA_CLOUD_API_KEY` | LlamaCloud | yes, within a grant |
| Ollama     | answers and embeddings       | `OLLAMA_BASE_URL`     | nobody     | yes                 |

The first column is a platform, not a model. Every model each one offers, with
its dimensions and its price, lives in `packages/shared/src/providers.ts`. That
file is the single registry the settings screen, the cost estimates and the
usage report all read, so a model added there appears everywhere at once.

## OpenAI

Answers and embeddings, billed by OpenAI rather than Cloudflare.

```
OPENAI_API_KEY=sk-...
```

Two chat models are offered, `gpt-4.1-mini` and `gpt-4.1`, and two embedding
models, `text-embedding-3-small` and `text-embedding-3-large`.

The embedding models are the interesting half. Both were trained so a shortened
prefix of the vector is still meaningful, which means either can fill the
384-dimension index this project creates by default without recreating it. No
Workers AI embedding model can do that: picking `bge-base` instead of `bge-small`
means a new index at 768 dimensions and re-embedding everything. The app refuses
to shorten a model that was not trained for it rather than quietly wrecking
recall, so this is a real difference and not a formality.

Changing the embedding model makes every stored vector stale. The settings
screen says so and offers a re-index; until that runs, old passages are in a
different vector space from new questions and the answers get worse.

## DeepSeek

Answers only. Cheaper per token than the OpenAI models above.

```
DEEPSEEK_API_KEY=sk-...
```

`deepseek-chat` answers directly. `deepseek-reasoner` thinks first, which is
better on a question that needs several steps and worse on a question that
needs a quotation, because the thinking is billed as output and can eat the
answer budget. That is the same trap the Workers AI default avoids, and the
reason `llama-4-scout` is the default rather than `gpt-oss`.

DeepSeek models are also on Workers AI, with no DeepSeek account. Cloudflare
requires a billing method for those, so a DeepSeek key is the cheaper way in if
you are staying on the Cloudflare free plan.

## LlamaIndex

Reading, not answering. LlamaCloud has no chat or embedding endpoint that this
project could use, so a LlamaCloud key never changes who writes the answer. It
changes who reads the file.

```
LLAMA_CLOUD_API_KEY=llx-...
```

It earns its place on one case the rest of the project cannot handle at all: a
scanned page. There is no text in that file to extract, so the browser
extractor and the in-Worker parsers both come back with nothing, correctly.
LlamaParse does optical character recognition and returns markdown.

The free plan grants 10,000 credits a month. At three credits a page on the
`cost_effective` tier, which is the tier this project asks for, that is about
3,300 pages a month at no cost.

**Keys are region specific.** LlamaCloud runs a separate EU region, and a key
created there is rejected by the North American host with no hint about why. If
your key came from the EU console:

```
LLAMA_CLOUD_BASE_URL=https://api.cloud.eu.llamaindex.ai
```

Getting this wrong looks exactly like a bad key. `./scripts/check-credentials.sh`
names the host it tried, which is what tells the two apart.

Where it is reachable:

- **Self hosted, paid tier.** The Worker triages an upload, parses locally when
  it can, and escalates to LlamaParse only for a file no local parser can read.
  That is what keeps the credit spend on the minority of documents that need it.
- **The demo.** A visitor chooses it with a toggle. See
  [The demo's reader toggle](#the-demos-reader-toggle) below.
- **Self hosted, free tier.** Not offered, because server side parsing is not.

## Ollama

Real models on your own machine, billed by nobody.

```
OLLAMA_BASE_URL=http://localhost:11434
```

There is deliberately no default. An unset value means nobody opted in, so the
local models stay hidden rather than failing against a URL nothing is serving.
It cannot be used from a deployed Worker, which has no route to a server on your
own machine. [local-models.md](local-models.md) covers the rest.

## The demo's reader toggle

The public demo offers both free platforms side by side, and lets a visitor
switch between them before uploading a file.

|                     | Cloudflare                      | LlamaIndex                     |
| ------------------- | ------------------------------- | ------------------------------ |
| Where the file goes | nowhere, it is read in the page | LlamaCloud                     |
| Reads a scan        | no                              | yes                            |
| Page numbers        | kept, so citations cite a page  | not returned, headings instead |
| Costs               | nothing                         | credits from the monthly grant |
| Who embeds it       | Workers AI                      | Workers AI                     |

Only the reading changes. The markdown is chunked in the browser either way,
embedded by the same Workers AI model either way, and answered by the same model
either way, which is what makes the toggle worth having: it isolates one
variable instead of swapping the product.

Turning it on:

```
DEMO_LLAMAPARSE_ENABLED=true
LLAMA_CLOUD_API_KEY=llx-...
```

Both are needed. The toggle stays hidden without the key, so the interface never
offers a choice the deployment could not honour.

Parsing carries its own daily budget, separate from the upload one, because it
spends a different scarce thing: LlamaCloud credits rather than Vectorize
storage. The arithmetic behind the defaults is in [demo.md](demo.md).

## Checking a key works

```bash
./scripts/check-credentials.sh
./scripts/check-credentials.sh --file .env.demo
```

Every key is used in a real request and only the verdict is printed, so the
output is safe to paste into an issue or read out on a call. A key that is
present but rejected is reported separately from one that is missing, because
those are different problems: the first deploys and then fails on the first real
request.

## Adding one

1. Put the key in `.env`, or `.env.demo` for the demo.
2. `./scripts/check-credentials.sh` to confirm it works before spending a
   deployment on it.
3. `./scripts/deploy.sh`. Keys go up as Worker secrets, never as plain
   variables, so they are not readable from the dashboard afterwards.
4. Pick the model on the settings screen. Until then nothing has changed.

A key that is set but never selected costs nothing. The settings screen hides
any provider whose key is absent, so the list shows what this deployment can
actually do rather than what it could do in principle.

## What it costs

Per million tokens, from the registry in `packages/shared/src/providers.ts`:

| Model               | In    | Out   |
| ------------------- | ----- | ----- |
| `deepseek-chat`     | $0.28 | $0.42 |
| `gpt-4.1-mini`      | $0.40 | $1.60 |
| `deepseek-reasoner` | $0.55 | $2.19 |
| `gpt-4.1`           | $2.00 | $8.00 |

Workers AI is not in that table because it is not billed in dollars on the free
plan. It is billed in neurons against a daily grant of 10,000, and
[free-tier.md](free-tier.md) works through what that buys.

The usage screen reports both: neurons against the Cloudflare grant, and dollars
against whatever an external provider has been asked to do. Picking OpenAI does
not make the neuron count go away, because embeddings and retrieval may still be
running on Cloudflare.
