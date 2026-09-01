# What free actually buys you

Every number here was read from Cloudflare's own documentation in September
2026, with the page it came from. Allowances change. Check the links before you
rely on any of this, and treat the figures in the interface as a guide rather
than a guarantee.

## The allowances

| Service                       | Free plan                             | Source                                                                               |
| ----------------------------- | ------------------------------------- | ------------------------------------------------------------------------------------ |
| Workers requests              | 100,000 a day                         | [Workers limits](https://developers.cloudflare.com/workers/platform/limits/)         |
| Workers processor time        | 10 ms per request                     | same                                                                                 |
| Workers outbound calls        | 50 per request                        | same                                                                                 |
| Workers memory                | 128 MB                                | same                                                                                 |
| Workers AI                    | 10,000 neurons a day                  | [Workers AI pricing](https://developers.cloudflare.com/workers-ai/platform/pricing/) |
| D1 storage                    | 5 GB total, 500 MB per database       | [D1 limits](https://developers.cloudflare.com/d1/platform/limits/)                   |
| D1 reads                      | 5,000,000 rows a day                  | [D1 pricing](https://developers.cloudflare.com/d1/platform/pricing/)                 |
| D1 writes                     | 100,000 rows a day                    | same                                                                                 |
| D1 queries per request        | 50                                    | [D1 limits](https://developers.cloudflare.com/d1/platform/limits/)                   |
| D1 bound parameters per query | 100                                   | same                                                                                 |
| Vectorize storage             | 5,000,000 vector dimensions           | [Vectorize pricing](https://developers.cloudflare.com/vectorize/platform/pricing/)   |
| Vectorize queries             | 30,000,000 queried dimensions a month | same                                                                                 |
| Vectorize namespaces          | 1,000 per index                       | [Vectorize limits](https://developers.cloudflare.com/vectorize/platform/limits/)     |
| Pages requests                | unlimited                             | [Pages limits](https://developers.cloudflare.com/pages/platform/limits/)             |
| Pages builds                  | 500 a month                           | same                                                                                 |

Daily allowances reset at midnight UTC.

## What that means in practice

### Answers a day

Cloudflare grants 10,000 neurons a day on every plan, paid included. One answer
costs roughly:

```
prompt   6 passages at ~350 tokens, plus instructions   ~3,000 tokens
answer                                                    ~400 tokens
```

At the default model, `@cf/openai/gpt-oss-20b`, billed at 18,182 neurons per
million input tokens and 27,273 per million output:

```
(3,000 x 18,182 + 400 x 27,273) / 1,000,000  =  about 65 neurons
10,000 / 65                                  =  about 150 answers a day
```

Embedding the question costs about 0.04 neurons, which rounds away.

Choosing a larger model changes this a lot. `@cf/meta/llama-3.3-70b-instruct-fp8-fast`
costs about 162 neurons an answer, so about 60 a day. The settings screen shows
the trade for each model, and the usage screen shows what you actually spent.

### How many documents fit

Vectorize bills on stored dimensions, not vectors:

```
5,000,000 / 384 dimensions  =  about 13,000 passages
```

A passage is about 1,400 characters, so roughly 18 million characters, or in
the region of 5,000 pages of ordinary prose. The free tier limits in this
project cap a workspace at 4,000 passages, which leaves room for three
workspaces before the account allowance is the binding constraint.

D1 is not the limit: 4,000 passages of 1,400 characters is about 6 MB against a
500 MB database.

### Ingesting a document

A 100 page report produces roughly 400 passages. At 16 passages per request
that is 25 requests, each doing one embedding call and a handful of writes.
Against 100,000 requests and 100,000 row writes a day, ingesting a few hundred
pages a day is unremarkable.

### The two limits that actually bite

**Processor time.** Ten milliseconds per request is the reason the browser does
the reading. See [architecture.md](architecture.md).

**Bound parameters.** D1 rejects a query with more than 100 bound parameters. A
multi-row insert binds one per column per row, so a batch of 24 passages across
13 columns is 312 parameters and fails with `too many SQL variables`. Inserts
are split by column count read from the table definition rather than by a number
written down somewhere, because a hand-maintained number goes stale the first
time a column is added and only fails under a large batch.

## When you cross a line

| Allowance              | What happens                                              |
| ---------------------- | --------------------------------------------------------- |
| Workers requests       | Requests are rejected until midnight UTC                  |
| Workers processor time | That single request is terminated                         |
| Workers AI neurons     | Model calls fail until midnight UTC, unless billing is on |
| D1 daily rows          | Queries return errors until midnight UTC                  |
| D1 storage             | Writes are refused; reads keep working                    |
| Vectorize storage      | Upserts are refused                                       |

None of these bill you by surprise. The free plan stops rather than charging.

## Making it last longer

- Keep the default model. It is the cheapest per answer of the good options.
- Delete documents you have stopped asking about. Storage is the allowance most
  likely to run out first.
- Lower the retrieved passage count in settings. Six is the default; four
  cuts the prompt by a third.
- Watch the usage screen for the first week. Real volume is usually nothing like
  the estimate.

## Going paid

The Workers Paid plan is five dollars a month and lifts processor time to 30
seconds a request, requests to unlimited, and D1 to 25 billion row reads a
month. Workers AI stays metered, with the same 10,000 free neurons a day and
$0.011 per 1,000 after that.

Switch a workspace to the paid tier from the settings screen. It raises the
limits this project imposes and turns on server side parsing and scanned
document support. It does not change your Cloudflare plan; do that in the
Cloudflare dashboard.
