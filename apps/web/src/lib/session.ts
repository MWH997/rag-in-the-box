import { createAuthClient } from "better-auth/react";
import { organizationClient } from "better-auth/client/plugins";

import { API_URL } from "./api";

/**
 * The auth client, used only in self-hosted mode.
 *
 * The public demo has no accounts at all, so nothing here is loaded on that
 * deployment beyond the module itself.
 */
export const authClient = createAuthClient({
  baseURL: API_URL,
  plugins: [organizationClient()],
  fetchOptions: { credentials: "include" },
});

export const { useSession, signIn, signUp, signOut } = authClient;
