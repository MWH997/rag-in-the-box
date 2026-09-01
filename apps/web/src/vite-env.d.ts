/// <reference types="vite/client" />

/**
 * Build-time settings. See src/lib/brand.ts for what each one does and what it
 * falls back to when unset.
 */
interface ImportMetaEnv {
  readonly VITE_API_URL?: string;
  readonly VITE_BRAND_NAME?: string;
  readonly VITE_REPO_URL?: string;
  readonly VITE_DEMO_URL?: string;
  readonly VITE_AUTHOR_NAME?: string;
  readonly VITE_AUTHOR_URL?: string;
  readonly VITE_SETUP_OFFER?: string;
  readonly VITE_SETUP_PRICE?: string;
  readonly VITE_SETUP_EMAIL?: string;
  readonly VITE_DEMO_SUGGESTIONS?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
