# Contributing

## Getting set up

```bash
npm install
npm run db:migrate:local
npm run dev
```

Node 24 or newer. Nothing else, and no accounts anywhere: local development
stores vectors in the local database and replaces the models with deterministic
stand-ins.

## Before you open a pull request

```bash
npm run verify
```

That runs the typecheck, the linter and the tests, which is exactly what CI
runs. If you touched anything in the request path, also run the end to end
check against a running API:

```bash
npm run dev:api          # in one terminal
apps/api/scripts/smoke.sh
```

If you touched the interface, run the layout audit. It catches the things
screenshots hide.

```js
// with the dev server running, in the browser console
await import("/@fs/ABSOLUTE/PATH/TO/qa/audit.js");
window.__ragAudit();
```

Check every route at 320, 390, 768, 1024, 1440 and 1920 pixels wide. The audit
should report nothing.

## Commit messages

[Conventional Commits](https://www.conventionalcommits.org):

```
<type>(<scope>): <subject>

feat(chat): stream answers with inline citations
fix(ingest): split inserts by bound parameter count
docs(free-tier): correct the vectorize storage figure
```

Types: `feat`, `fix`, `perf`, `refactor`, `docs`, `test`, `build`, `ci`,
`chore`, `style`, `revert`.

Scopes: `api`, `web`, `shared`, `demo`, `db`, `auth`, `chat`, `ingest`,
`providers`, `quota`, `deploy`, `docs`, `ci`, `deps`, `repo`.

The subject is lower case, in the imperative, and under 100 characters. Explain
why in the body when the reason is not obvious from the change.

To have the hook check this locally, once per clone:

```bash
git config core.hooksPath .githooks
```

CI checks every commit in a pull request regardless.

## House rules

**Do not hardcode a model.** Model identifiers, dimensions and prices live in
`packages/shared/src/providers.ts`, each read from the vendor's documentation.
The runtime reads them from settings.

**Do not hardcode a platform limit.** Derive it. The bound parameter batching
reads the column count from the table definition rather than a number in a
constant, because a written-down number goes stale the moment a column is added.

**Every tenant id comes from the session.** Never from a request body, query
parameter or header, except the admin escape hatch, which is guarded by a
constant-time comparison against a Worker secret.

**Keep the Worker's own work small.** The free plan allows 10 ms of processor
time per request. Anything that grows with document size belongs in the browser.

**Say what a number is.** If you pick a batch size, a timeout or a threshold,
write down what it is measured against.

## Writing

Documentation and interface copy are written plainly. No em dashes, and no
words that exist to sound impressive. If a sentence would survive being said out
loud to a colleague, it is fine.

## Project layout

```
apps/api        Hono on Cloudflare Workers
apps/web        React on Cloudflare Pages
packages/shared Contracts, the chunker, the provider registry
scripts         Deployment and demo seeding
qa              The layout audit
docs            Architecture, hosting, free tier, demo, security
```

Anything shared by both halves goes in `packages/shared`. The chunker lives
there because the browser and the Worker both run it, and identical boundaries
matter.

## Pinned dependencies

**TypeScript is held at 5.9.** The code compiles clean under 7.0, but
`typescript-eslint` refuses to load against it and fails the lint step. Raise it
once that support lands. Two fixes made for 7.0 are already in: `app.on` takes
its path as an array, and the auth handler is `async` so both branches return
the same type.
