# The public demo

The demo at [rib.mwhassan.com](https://rib.mwhassan.com) runs the same code as
everything else in this repository, from the same branch, with two differences:
there are no accounts, and there are hard daily allowances.

It exists so someone can decide whether this is worth their time before
installing anything.

## How it differs from a normal deployment

|                       | Self hosted        | Demo                                       |
| --------------------- | ------------------ | ------------------------------------------ |
| Accounts              | email and password | none                                       |
| Workspace             | one per account    | one per browser, plus a shared curated one |
| Settings              | editable           | fixed                                      |
| Uploads               | unlimited          | one small file each, deleted after a while |
| Daily limits          | your own           | per visitor and deployment wide            |
| Provisioning endpoint | available          | refused                                    |
| Auth routes           | mounted            | not mounted                                |

`APP_MODE=demo` is the only switch. Everything above follows from it.

## The allowances

Two counters, both reset at midnight UTC.

**Per visitor.** Twelve questions a day by default. Enough to form an opinion,
not enough for one person to spend the day's budget.

**Deployment wide.** One hundred and ten questions a day by default, against a
Cloudflare grant that pays for roughly a hundred and fifty. The gap is
deliberate headroom.

When either is reached, the interface says which one, explains that the limit
exists so the demo costs nothing to run, says when it lifts, and points at the
source. Nothing breaks and no error page appears.

### How a visitor is counted

The per-visitor counter is keyed on an HMAC of the caller's network address,
salted with `DEMO_COOKIE_SECRET`. The address itself is never stored. A cookie
carries the visitor's own workspace id, but it is not what the counter is keyed
on, so clearing cookies does not hand out a fresh allowance.

People behind one shared address share an allowance. That is the trade for not
requiring sign-in, and the deployment-wide cap is what actually protects the
budget.

## The document it answers from

The demo ships with the **NIST Cybersecurity Framework 2.0** already indexed. It
was chosen because it is a work of the United States government and therefore in
the public domain, it is dense and well structured in the way real working
documents are, it is useful to the kind of person who would want this tool, and
it is about as far from contentious as a document gets.

The file is fetched from NIST when the demo is seeded rather than committed
here, so no third party bytes live in this repository.

To load it, or something else:

```bash
ADMIN_TOKEN='...' node scripts/seed-demo.ts \
  --api https://your-api-origin \
  --tenant demo-curated
```

```
--source   a URL or a local path   (default: the NIST framework)
--title    the filename shown      (default: its title)
--batch    passages per request    (default: 24)
```

The script does what the browser normally does, from Node: read the file, split
it into passages, send them in small batches. If it fails part way it removes
the half-built document, so a failed run leaves nothing behind.

## Deploying it

```bash
cp .env.demo.example .env.demo
# fill it in
./scripts/deploy.sh --profile demo
```

The demo gets its own Worker, its own database and its own vector index.
Nothing is shared with any other deployment, so a mistake in the demo cannot
reach anyone else's data.

Then point the two custom domains at it, and seed the document.

There is also a manual GitHub Actions workflow, `Deploy demo`, which runs the
same script from CI. It requires typing `deploy` to confirm and reads
`CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID` from the `demo` environment's
secrets. It never runs on a push.

## Visitor uploads

The curated document shows the product answers questions. It cannot show that it
answers questions about the reader's own document, which is the only question
they actually have. So each visitor may add one small file.

The defaults:

| Setting                        | Default | Why                                          |
| ------------------------------ | ------- | -------------------------------------------- |
| `DEMO_VISITOR_UPLOADS_PER_DAY` | 1       | Enough to answer the question they came with |
| `DEMO_GLOBAL_UPLOADS_PER_DAY`  | 30      | Caps the day's storage growth                |
| `DEMO_MAX_UPLOAD_BYTES`        | 2 MB    | A few pages is enough to watch the pipeline  |
| `DEMO_RETENTION_HOURS`         | 3       | Long enough to try it and export it          |

### Why the retention exists

Vectorize storage does not reset daily. The free index holds roughly 13,000
passages at 384 dimensions. At thirty uploads a day of fifty passages each,
uploads left in place would fill it permanently in about nine days, and the only
fix would be deleting vectors by hand. The free plan also caps an index at 1,000
namespaces, and each visitor workspace is one namespace.

So the purge is not tidiness, it is what makes the feature affordable. The cron
trigger in `apps/api/wrangler.toml` runs it hourly. Raising the retention without
redoing that arithmetic will fill the index.

The purge deletes vectors before rows. A vector outliving its chunk row would be
unreachable and unremovable, because the ids to delete it by are the chunk ids.
Losing the row first is merely untidy, so the order fails in the safe direction.

Only workspaces whose id starts with `demo-v-` are touched. The curated
workspace does not match that prefix, which is asserted in a test, because
deleting the featured document would silently empty the demo.

### What the visitor is told

The retention appears above the upload control before they choose a file, not
after. Next to it sits an export button, which hands back a JSON file holding
the extracted text, the passage boundaries and the vectors. That is the whole
index, in a form that can be loaded somewhere else. A demo that takes your work
and deletes it is a worse advertisement than no demo.

### Turning it off

Set `DEMO_UPLOADS_ENABLED=false`. The curated document stays, the upload control
disappears, and the API refuses uploads before consuming any allowance.

## Keeping the demo safe

- The demo Worker holds no personal data. There is no sign-up, no email address
  and no password.
- Network addresses are hashed with a secret before being used as a counter key
  and are never written down.
- The provisioning endpoint refuses to run in demo mode.
- The auth routes are not mounted in demo mode, so there is no sign-in surface
  to attack.
- `.env.demo` is ignored by git, and the deployment script refuses to publish
  with the offline development switch set.
- Visitor uploads are deleted on a schedule, so files from strangers are not
  accumulated. An export is offered before that happens.
- A visitor's export contains only their own workspace. The curated document
  belongs to the deployment and is excluded.

## Running the demo locally

```bash
# apps/api/.dev.vars
APP_MODE=demo
DEMO_TENANT_ID=demo-curated
DEMO_COOKIE_SECRET=anything-local
DEMO_VISITOR_CHATS_PER_DAY=4
DEMO_GLOBAL_CHATS_PER_DAY=6
```

Restart the API, seed a document against `http://127.0.0.1:8787`, and open
http://localhost:5173/demo. Small limits make the exhausted banner easy to see.

To reset the counters while testing:

```bash
cd apps/api
npx wrangler d1 execute rag-db --local --command "DELETE FROM quota_counters;"
```
