# Security

## Reporting something

Email [devwahid5@gmail.com](mailto:devwahid5@gmail.com) rather than opening a
public issue. Include what you did and what happened. I will reply.

## What the design relies on

### Tenant isolation

Every table holding tenant data carries a `tenant_id`. Every query filters on
it. The value comes from the server side session and nothing else: no request
body, query parameter or header can supply one, except the operator escape
hatch described below.

Vector storage is scoped twice, by namespace and by a metadata filter, so a
mistake in one still leaves the other enforcing isolation.

`apps/api/scripts/smoke.sh` asserts this end to end on every run: a second
workspace cannot list, read or retrieve the first one's document.

### The admin escape hatch

`scripts/seed-demo.ts` writes into a workspace it does not own. It does this by
sending the deployment's `ADMIN_TOKEN` alongside a tenant id, which the tenant
middleware accepts after a constant-time comparison.

That token is a Worker secret. It never reaches a browser, it is never sent to
the interface, and the mechanism is inert on a deployment that has not set one.
Treat it as equivalent to database access, because that is what it is.

### Passwords

PBKDF2-HMAC-SHA256 through WebCrypto, 100,000 iterations by default, with a
random 16 byte salt per password and a constant-time comparison on verify.

The iteration count is below current OWASP guidance for this algorithm, because
the Cloudflare free plan allows 10 ms of processor time per request and the
recommended count costs about 35 ms. This is stated plainly rather than hidden:
see [architecture.md](architecture.md#passwords). Raise
`PASSWORD_KDF_ITERATIONS` to 600000 on the paid plan. Existing accounts keep
working, because each hash records the count it was made with.

### Sessions

Session cookies are HTTP-only. In production they are set with `Secure` and
`SameSite=None`, because the interface and the API are on different origins.
Locally they fall back to `SameSite=Lax` without `Secure`, since browsers refuse
to store a `Secure` cookie over plain HTTP.

Cross-origin requests are only accepted from the configured origin. There is no
wildcard, which credentialed requests would forbid anyway.

### Input

Every request body is validated with a schema before anything touches the
database. Uploads are limited by tier. Document text is stored and rendered as
markdown, never as HTML, and the renderer does not pass raw HTML through.

### What the model is told

The answering instructions tell the model to use only the supplied passages and
to say so when they do not cover the question. Retrieved passages are document
text, which means a document can contain text addressed at the model. Treat an
answer as reflecting the documents, not as a judgement about them, and do not
wire this to anything that acts on its own output.

## Known limits

- **No rate limit on sign-in attempts.** A self-hosted deployment behind
  Cloudflare can add one at the edge. The demo has no sign-in at all.
- **No audit log.** Chat history is kept per workspace; administrative actions
  are not recorded.
- **The offline development provider must never be deployed.** The deployment
  script refuses when `OFFLINE_AI` is set, but nothing stops someone setting it
  by hand on a Worker.
- **Documents are not encrypted at rest** beyond what Cloudflare provides for
  D1 and Vectorize.

## If you self host

- Generate `BETTER_AUTH_SECRET` and `ADMIN_TOKEN` randomly, and keep them out of
  version control. `.env` is ignored by git.
- Give the Cloudflare API token only the permissions listed in
  [hosting.md](hosting.md), and rotate it when you are done deploying.
- Serve both halves over HTTPS.
- Rotating `BETTER_AUTH_SECRET` signs everyone out, which is the intended way to
  end all sessions.
