/**
 * Creates a workspace for someone else.
 *
 * There is no self-serve sign-up form for other people on purpose. This makes
 * the account and prints a one-time link they use to set their own password,
 * so no password is ever transmitted or known by the operator.
 *
 *   ADMIN_TOKEN=<token> node apps/api/scripts/provision-tenant.ts \
 *     <email> <organisation name> [api origin]
 *
 * Needs a running API and the same ADMIN_TOKEN configured there. See
 * docs/hosting.md for where that value lives in each environment.
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
