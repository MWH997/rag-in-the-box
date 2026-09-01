/**
 * Everything on the marketing pages that belongs to whoever is running this,
 * rather than to the software.
 *
 * This is an open source product other people host. Without this module their
 * landing page carries the original author's email address, links to their
 * website, quotes their price, and offers their consulting time. That is wrong
 * for them, because their site would sell someone else's service, and wrong for
 * the author, who would field support requests for installs they have never
 * seen.
 *
 * Every value falls back to this project's own, so nothing changes for the
 * canonical deployment and a fork can be rebranded without touching a component.
 * Read at build time, because the interface is a static bundle on Pages.
 */

function text(value: string | undefined, fallback: string): string {
  const trimmed = value?.trim();
  return trimmed && trimmed.length > 0 ? trimmed : fallback;
}

function flag(value: string | undefined, fallback: boolean): boolean {
  if (value === undefined || value.trim() === "") return fallback;
  return value === "true" || value === "1";
}

export const brand = {
  /** Product name, used in headings and the browser title. */
  name: text(import.meta.env.VITE_BRAND_NAME, "RAG in the Box"),

  /** Source repository. The clone button and the header mark point here. */
  repoUrl: text(import.meta.env.VITE_REPO_URL, "https://github.com/MWH997/rag-in-the-box"),

  /** Public demo. Leave blank on a fork that does not run one. */
  demoUrl: text(import.meta.env.VITE_DEMO_URL, "https://rib.mwhassan.com"),

  /** Who built it, shown in the footer. */
  author: {
    name: text(import.meta.env.VITE_AUTHOR_NAME, "Muhammad Hassan"),
    url: text(import.meta.env.VITE_AUTHOR_URL, "https://mwhassan.com"),
  },

  /**
   * The paid setup offer.
   *
   * This is a business, not a feature, so it is off until someone supplies an
   * address to receive the enquiries. There is deliberately no fallback email:
   * a default would compile the original author's address into every fork's
   * bundle, where it is invisible in the interface but readable by anyone who
   * looks at the JavaScript, and would send them enquiries about installs they
   * have never seen.
   */
  setup: {
    enabled:
      flag(import.meta.env.VITE_SETUP_OFFER, true) &&
      Boolean(import.meta.env.VITE_SETUP_EMAIL?.trim()),
    price: text(import.meta.env.VITE_SETUP_PRICE, "$300"),
    email: text(import.meta.env.VITE_SETUP_EMAIL, ""),
  },
} as const;

/** The demo host on its own, for the mock browser chrome on the landing page. */
export const demoHost = brand.demoUrl.replace(/^https?:\/\//, "").replace(/\/+$/, "");

/** A mailto link for the setup offer, with the product name in the subject. */
export const setupMailto = `mailto:${brand.setup.email}?subject=${encodeURIComponent(
  `${brand.name} setup`,
)}`;
