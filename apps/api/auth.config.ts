// CLI-only entry point: `better-auth generate` imports this to introspect the
// enabled plugins and emit the Drizzle schema. It is never imported at runtime
// (see src/lib/auth.ts for the real per-request factory), the `db` argument
// here is a stand-in since schema generation never executes a query.
import { betterAuth } from "better-auth";
import { organization } from "better-auth/plugins/organization";
import { drizzleAdapter } from "@better-auth/drizzle-adapter";

export const auth = betterAuth({
  database: drizzleAdapter({}, { provider: "sqlite" }),
  plugins: [organization()],
});
