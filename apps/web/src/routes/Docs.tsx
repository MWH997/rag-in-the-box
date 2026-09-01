import { ArrowLeft, BookOpen } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { Link, useParams, useNavigate } from "react-router";

import { GithubMark, Wordmark } from "@/components/Logo";
import { Markdown } from "@/components/Markdown";
import { brand } from "@/lib/brand";
import { cn } from "@/lib/utils";

/**
 * The documentation, read straight from the files in docs/.
 *
 * Not a copy. The markdown is pulled in at build time from the same files the
 * repository ships, so the site cannot drift from what someone reads on GitHub.
 * A second, hand-written version of the same material is the surest way to end
 * up with two answers to the same question and no way to tell which is current.
 */
const FILES = import.meta.glob("../../../../docs/*.md", {
  query: "?raw",
  import: "default",
  eager: true,
}) as Record<string, string>;

interface Page {
  slug: string;
  title: string;
  summary: string;
  body: string;
}

/** The order the pages are meant to be read in, rather than alphabetical. */
const ORDER = ["architecture", "api", "free-tier", "hosting", "local-models", "demo", "security"];

const SUMMARIES: Record<string, string> = {
  architecture: "Why the work is split the way it is, and what each half does.",
  api: "Every route, what identifies a caller, and the error codes.",
  "free-tier": "What the free plan actually allows, and what happens at each limit.",
  hosting: "Getting your own copy running, start to finish.",
  "local-models": "Real models on your own machine, with no account anywhere.",
  demo: "How the public demo differs from a normal install.",
  security: "Where the boundaries are and how each one is enforced.",
};

const PAGES: Page[] = Object.entries(FILES)
  .map(([path, body]) => {
    const slug = path.split("/").pop()!.replace(/\.md$/, "");
    const heading = /^#\s+(.+)$/m.exec(body);
    return {
      slug,
      title: heading?.[1] ?? slug,
      summary: SUMMARIES[slug] ?? "",
      body,
    };
  })
  .sort((a, b) => {
    const rank = (slug: string) => {
      const at = ORDER.indexOf(slug);
      return at === -1 ? ORDER.length : at;
    };
    return rank(a.slug) - rank(b.slug) || a.slug.localeCompare(b.slug);
  });

export function Docs() {
  const { slug } = useParams();
  const navigate = useNavigate();
  const current = useMemo(() => PAGES.find((page) => page.slug === slug) ?? PAGES[0], [slug]);
  const [open, setOpen] = useState(false);

  // A new page starts at the top. Keeping the previous scroll position drops
  // the reader into the middle of something they have not started.
  useEffect(() => {
    window.scrollTo({ top: 0 });
    setOpen(false);
  }, [slug]);

  useEffect(() => {
    const first = PAGES[0];
    if (!slug && first) navigate(`/docs/${first.slug}`, { replace: true });
  }, [slug, navigate]);

  if (!current) return null;

  return (
    <div className="min-h-dvh bg-bg">
      <header className="sticky top-0 z-30 border-b border-line bg-raised/85 backdrop-blur">
        <div className="mx-auto flex h-14 max-w-6xl items-center gap-3 px-4 sm:px-6">
          <Link to="/" className="-mx-1 flex min-w-0 items-center gap-2 rounded-lg px-1 py-1.5">
            <ArrowLeft className="h-4 w-4 shrink-0 text-faint sm:hidden" aria-hidden />
            <Wordmark className="hidden sm:flex" />
            <span className="truncate text-sm font-medium text-ink sm:hidden">Docs</span>
          </Link>

          <button
            type="button"
            onClick={() => setOpen((was) => !was)}
            aria-expanded={open}
            className="ml-auto flex items-center gap-1.5 rounded-lg border border-line px-3 py-2 text-[0.8125rem] text-muted md:hidden"
          >
            <BookOpen className="h-3.5 w-3.5" aria-hidden />
            Pages
          </button>

          <div className="ml-auto hidden items-center gap-2 md:flex">
            <Link
              to="/demo"
              className="rounded-lg px-3 py-2 text-[0.8125rem] text-muted transition-colors hover:bg-sunken hover:text-ink"
            >
              Try the demo
            </Link>
            <a
              href={brand.repoUrl}
              target="_blank"
              rel="noreferrer noopener"
              className="rounded-lg p-2 text-muted transition-colors hover:bg-sunken hover:text-ink"
              aria-label="Source on GitHub"
            >
              <GithubMark className="h-4 w-4" aria-hidden />
            </a>
          </div>
        </div>
      </header>

      <div className="mx-auto flex max-w-6xl gap-8 px-4 py-8 sm:px-6 sm:py-10">
        <nav
          aria-label="Documentation"
          className={cn(
            "w-full shrink-0 md:block md:w-56",
            open ? "block" : "hidden",
            "md:sticky md:top-24 md:self-start",
          )}
        >
          <ul className="space-y-0.5">
            {PAGES.map((page) => {
              const active = page.slug === current.slug;
              return (
                <li key={page.slug}>
                  <Link
                    to={`/docs/${page.slug}`}
                    aria-current={active ? "page" : undefined}
                    className={cn(
                      "block min-w-0 rounded-lg px-3 py-2 text-[0.8125rem] transition-colors",
                      active
                        ? "bg-sunken font-medium text-ink"
                        : "text-muted hover:bg-sunken hover:text-ink",
                    )}
                  >
                    <span className="block truncate">{page.title}</span>
                    {page.summary && (
                      <span className="mt-0.5 block text-[0.75rem] leading-snug text-faint">
                        {page.summary}
                      </span>
                    )}
                  </Link>
                </li>
              );
            })}
          </ul>
        </nav>

        <main className={cn("min-w-0 flex-1", open && "hidden md:block")}>
          <Markdown className="max-w-none">{current.body}</Markdown>

          <p className="mt-10 border-t border-line pt-5 text-[0.8125rem] text-muted">
            This page is the file{" "}
            <a
              href={`${brand.repoUrl}/blob/main/docs/${current.slug}.md`}
              target="_blank"
              rel="noreferrer noopener"
              className="underline underline-offset-2 hover:text-ink"
            >
              docs/{current.slug}.md
            </a>{" "}
            in the repository, rendered here. There is no second copy to fall out of date.
          </p>
        </main>
      </div>
    </div>
  );
}
