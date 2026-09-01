import { fileURLToPath, URL } from "node:url";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
  plugins: [react(), tailwindcss()],
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
