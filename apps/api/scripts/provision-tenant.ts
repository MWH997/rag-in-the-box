/**
 * Onboarding runbook script (see README.md "Tenant onboarding"). Creates a
 * new tenant (user + organization) and prints a one-time password-reset
 * link for the operator to hand to the client.
 *
 * Usage:
 *   ADMIN_TOKEN=<token> node scripts/provision-tenant.ts <email> <orgName> [baseUrl]
 *
 * Requires a running API (e.g. `npm run dev` in apps/api for local use, or
 * the deployed Worker URL in production) and the same ADMIN_TOKEN value
 * configured there (`.dev.vars` locally, `wrangler secret put` in prod).
 */

const [, , email, orgName, baseUrlArg] = process.argv;
const baseUrl = baseUrlArg ?? "http://localhost:8787";
const adminToken = process.env.ADMIN_TOKEN;

if (!email || !orgName) {
  console.error(
    "Usage: ADMIN_TOKEN=<token> node scripts/provision-tenant.ts <email> <orgName> [baseUrl]",
  );
  process.exit(1);
}

if (!adminToken) {
  console.error("Missing ADMIN_TOKEN environment variable.");
  process.exit(1);
}

const response = await fetch(`${baseUrl}/api/admin/provision`, {
  method: "POST",
  headers: {
    "Content-Type": "application/json",
    Authorization: `Bearer ${adminToken}`,
  },
  body: JSON.stringify({ email, orgName }),
});

const body = await response.json();

if (!response.ok) {
  console.error(`Provisioning failed (${response.status}):`, body);
  process.exit(1);
}

console.log("Tenant provisioned:");
console.log(`  userId:         ${body.userId}`);
console.log(`  organizationId: ${body.organizationId}`);
console.log(`  email:          ${body.email}`);
console.log(`  invite link:    ${body.inviteUrl}`);
console.log("\nSend the invite link to the client so they can set their own password.");
