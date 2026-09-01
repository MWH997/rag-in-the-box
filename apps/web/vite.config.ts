import { fileURLToPath, URL } from "node:url";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

/**
 * Fills %VITE_SITE_URL% in index.html, with a default.
 *
 * Vite substitutes the placeholder only when the variable is set, and leaves
 * the literal text behind when it is not. Share metadata holding
 * "%VITE_SITE_URL%/og.png" is worse than a wrong address: it is not a URL at
 * all. The deploy script passes the address the site actually answers on, and
 * this is what a plain build falls back to.
 */
function siteUrl() {
  const fallback = "https://rib.mwhassan.com";
  return {
    name: "site-url",
    transformIndexHtml(html: string) {
      const value = process.env.VITE_SITE_URL?.trim() || fallback;
      return html.replaceAll("%VITE_SITE_URL%", value.replace(/\/+$/, ""));
    },
  };
}

export default defineConfig({
  plugins: [react(), tailwindcss(), siteUrl()],
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
  server: {
    fs: {
      // The docs route reads docs/*.md from the repository root so the site and
      // the repository cannot disagree. The dev server refuses to serve files
      // above its own root without this.
      allow: [fileURLToPath(new URL("../..", import.meta.url))],
    },
  },
});
