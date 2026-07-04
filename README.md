# RAG-in-a-Box

## Tenant onboarding

New tenants (clients) are provisioned via `apps/api/scripts/provision-tenant.ts`, which calls the
admin-only `POST /api/admin/provision` endpoint. This creates a user + organization for the tenant
and returns a one-time password-reset link — there is no self-serve signup for new clients.

```bash
cd apps/api
ADMIN_TOKEN=<value from .dev.vars locally, or the deployed secret> \
  node scripts/provision-tenant.ts <email> "<org name>" [baseUrl]
```

- `baseUrl` defaults to `http://localhost:8787` (a local `npm run dev` instance). Pass the deployed
  API URL to provision a tenant in production.
- The script prints an `inviteUrl` — send this link to the client so they can set their own
  password. The account's initial password is a random value never given to anyone; it's only
  reachable via this link.
- `ADMIN_TOKEN` is a secret (`.dev.vars` locally, `wrangler secret put ADMIN_TOKEN` in prod) — never
  commit it.

_A fuller README (local dev setup, env vars, deploy steps, free-tier limits) lands in TICKET-26._
