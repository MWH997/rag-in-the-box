import { createAuthClient } from "better-auth/react";
import { organizationClient } from "better-auth/client/plugins";

const API_URL = import.meta.env.VITE_API_URL ?? "http://localhost:8787";

export const authClient = createAuthClient({
  baseURL: API_URL,
  fetchOptions: { credentials: "include" },
  plugins: [organizationClient()],
});

export const { useSession, signIn, signUp, signOut } = authClient;
