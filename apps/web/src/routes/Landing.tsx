import { motion } from "framer-motion";
import {
  ArrowRight,
  Check,
  FileSearch,
  Layers,
  MessageSquareQuote,
  Server,
  ShieldCheck,
  Terminal,
} from "lucide-react";
import { Link } from "react-router";

import { GithubMark, Wordmark } from "@/components/Logo";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardBody, CardHeader, CardTitle } from "@/components/ui/card";
import { useAppMode } from "@/hooks/use-app-mode";

const REPO_URL = "https://github.com/MWH997/rag-in-the-box";

const STEPS = [
  {
    icon: FileSearch,
    title: "The browser reads the file",
    body: "Text comes out of the PDF, spreadsheet or document on the reader's own machine. Nothing heavy runs on the server, which is what keeps a request inside the 10 ms of processor time a free Cloudflare Worker gets.",
  },
  {
    icon: Layers,
    title: "Passages go in one small batch at a time",
    body: "Each request embeds a handful of passages and writes them once. A four hundred page report and a one page memo cost the same per request, so nothing ever runs long enough to be cut off.",
  },
  {
    icon: MessageSquareQuote,
    title: "Answers arrive with the passage attached",
    body: "A question is matched against your own documents only. Every claim carries a number, and pressing it scrolls the source document to the sentence behind it.",
  },
  {
    icon: ShieldCheck,
    title: "Each workspace is sealed off",
    body: "Documents, passages and vectors all carry a workspace id that comes from the session, never from the request. The test suite asserts that a second workspace cannot list, read or retrieve the first one's text.",
  },
];

const FREE_TIER_ROWS = [
  { service: "Workers", allowance: "100,000 requests a day", note: "10 ms processor time each" },
  { service: "Workers AI", allowance: "10,000 neurons a day", note: "around 150 answers" },
  { service: "D1", allowance: "5 GB, 5M row reads a day", note: "100,000 row writes a day" },
  { service: "Vectorize", allowance: "5M stored dimensions", note: "about 13,000 passages" },
  { service: "Pages", allowance: "unlimited requests", note: "500 builds a month" },
];

export function Landing() {
  const { mode } = useAppMode();

  return (
    <div className="min-h-dvh bg-bg">
      <header className="sticky top-0 z-30 border-b border-line bg-bg/85 backdrop-blur">
        <div className="mx-auto flex h-14 max-w-6xl items-center gap-3 px-4 sm:px-6">
          <Link to="/" className="-mx-1 min-w-0 shrink rounded-lg px-1 py-1.5">
            <Wordmark />
          </Link>
          <nav className="ml-auto hidden items-center gap-1 md:flex">
            {[
              { href: "#how", label: "How it works" },
              { href: "#free", label: "Free tier" },
              { href: "#host", label: "Self host" },
              { href: "#pricing", label: "Pricing" },
            ].map((item) => (
              <a
                key={item.href}
                href={item.href}
                className="rounded-lg px-3 py-2 text-[0.8125rem] text-muted transition-colors hover:bg-raised hover:text-ink"
              >
                {item.label}
              </a>
            ))}
          </nav>
          <div className="ml-auto flex shrink-0 items-center gap-2 md:ml-0">
            <a
              href={REPO_URL}
              target="_blank"
              rel="noreferrer noopener"
              className="hidden rounded-lg p-2 text-muted transition-colors hover:bg-raised hover:text-ink sm:block"
              aria-label="Source on GitHub"
            >
              <GithubMark className="h-4 w-4" aria-hidden />
            </a>
            <Link to="/demo">
              <Button size="sm">Try the demo</Button>
            </Link>
          </div>
        </div>
      </header>

      <main>
        {/* Hero */}
        <section className="relative overflow-hidden border-b border-line">
          <div className="grid-backdrop pointer-events-none absolute inset-0" aria-hidden />
          <div className="relative mx-auto max-w-6xl px-4 pb-16 pt-14 sm:px-6 sm:pb-20 sm:pt-20">
            <motion.div
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.5, ease: "easeOut" }}
              className="mx-auto max-w-3xl text-center"
            >
              <Badge tone="accent" className="mb-5">
                Open source, MIT licensed
              </Badge>
              <h1 className="text-balance text-3xl font-semibold leading-[1.1] tracking-[-0.03em] text-ink sm:text-5xl">
                Ask your documents. Check every answer.
              </h1>
              <p className="mx-auto mt-5 max-w-2xl text-pretty text-[0.9375rem] leading-relaxed text-muted sm:text-base">
                A retrieval system you host yourself. It reads your files, answers questions from
                them alone, and shows the passage behind every sentence it writes. The whole thing
                fits inside the Cloudflare free plan, and the code is yours.
              </p>
              <div className="mt-8 flex flex-col items-center justify-center gap-3 sm:flex-row">
                <Link to="/demo" className="w-full sm:w-auto">
                  <Button size="lg" className="w-full sm:w-auto">
                    Open the live demo
                    <ArrowRight className="h-4 w-4" aria-hidden />
                  </Button>
                </Link>
                <a
                  href={REPO_URL}
                  target="_blank"
                  rel="noreferrer noopener"
                  className="w-full sm:w-auto"
                >
                  <Button size="lg" variant="secondary" className="w-full sm:w-auto">
                    <GithubMark className="h-4 w-4" aria-hidden />
                    Read the source
                  </Button>
                </a>
              </div>
              <p className="mt-4 text-[0.8125rem] text-faint">
                No account needed for the demo. No credit card needed to host it.
              </p>
            </motion.div>

            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.6, delay: 0.15, ease: "easeOut" }}
              className="mx-auto mt-12 max-w-4xl"
            >
              <HeroPreview />
            </motion.div>
          </div>
        </section>

        {/* How it works */}
        <section id="how" className="border-b border-line py-16 sm:py-20">
          <div className="mx-auto max-w-6xl px-4 sm:px-6">
            <SectionHeading
              eyebrow="How it works"
              title="Built around one hard limit"
              body="A Worker on the free plan gets 10 milliseconds of processor time per request. Reading a PDF costs hundreds. Everything below follows from taking that limit seriously instead of hoping it goes away."
            />
            <div className="mt-10 grid gap-4 sm:grid-cols-2">
              {STEPS.map((step) => (
                <Card key={step.title} className="h-full">
                  <CardHeader className="gap-3">
                    <span className="flex h-9 w-9 items-center justify-center rounded-[10px] border border-line bg-sunken text-accent">
                      <step.icon className="h-4 w-4" aria-hidden />
                    </span>
                    <CardTitle>{step.title}</CardTitle>
                  </CardHeader>
                  <CardBody>
                    <p className="text-sm leading-relaxed text-muted">{step.body}</p>
                  </CardBody>
                </Card>
              ))}
            </div>
          </div>
        </section>

        {/* Free tier */}
        <section id="free" className="border-b border-line py-16 sm:py-20">
          <div className="mx-auto max-w-6xl px-4 sm:px-6">
            <SectionHeading
              eyebrow="Free tier"
              title="What free actually buys you"
              body="These are Cloudflare's published allowances, not estimates. The app tracks its own consumption against them and shows you the numbers as you go."
            />
            <Card className="mt-10 overflow-hidden">
              <div className="scroll-area overflow-x-auto">
                <table className="w-full min-w-[34rem] text-left text-sm">
                  <thead>
                    <tr className="border-b border-line bg-sunken">
                      <th className="px-4 py-3 font-medium text-muted sm:px-5">Service</th>
                      <th className="px-4 py-3 font-medium text-muted sm:px-5">Free allowance</th>
                      <th className="px-4 py-3 font-medium text-muted sm:px-5">In practice</th>
                    </tr>
                  </thead>
                  <tbody>
                    {FREE_TIER_ROWS.map((row) => (
                      <tr key={row.service} className="border-b border-line last:border-0">
                        <td className="px-4 py-3 font-medium text-ink sm:px-5">{row.service}</td>
                        <td className="px-4 py-3 text-muted sm:px-5">{row.allowance}</td>
                        <td className="px-4 py-3 text-faint sm:px-5">{row.note}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Card>
            <p className="mt-4 text-[0.8125rem] leading-relaxed text-faint">
              Allowances change. The repository documents where each number comes from so you can
              check it against Cloudflare's own pages before you rely on it.
            </p>
          </div>
        </section>

        {/* Self host */}
        <section id="host" className="border-b border-line py-16 sm:py-20">
          <div className="mx-auto max-w-6xl px-4 sm:px-6">
            <div className="grid gap-10 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)] lg:items-center">
              <div className="min-w-0">
                <SectionHeading
                  align="left"
                  eyebrow="Self host"
                  title="Three commands and a file of keys"
                  body="Copy the example environment file, fill in your Cloudflare account, and run the deploy script. It creates the database, the vector index and the secrets, applies the migrations and publishes both halves."
                />
                <ul className="mt-6 space-y-2.5">
                  {[
                    "Creates every Cloudflare resource it needs, and skips the ones that already exist",
                    "Checks your account before it changes anything",
                    "Prints the exact URLs it published to",
                    "Safe to run again after a change",
                  ].map((item) => (
                    <li key={item} className="flex min-w-0 items-start gap-2.5">
                      <Check className="mt-0.5 h-4 w-4 shrink-0 text-positive" aria-hidden />
                      <span className="text-sm leading-relaxed text-muted">{item}</span>
                    </li>
                  ))}
                </ul>
              </div>
              <Card className="min-w-0 overflow-hidden">
                <div className="flex items-center gap-2 border-b border-line px-4 py-2.5">
                  <Terminal className="h-3.5 w-3.5 shrink-0 text-faint" aria-hidden />
                  <span className="truncate font-mono text-[0.75rem] text-faint">
                    setting up your own copy
                  </span>
                </div>
                <div className="scroll-area overflow-x-auto p-4">
                  <pre className="font-mono text-[0.75rem] leading-6 text-muted sm:text-[0.8125rem]">
                    <code>{`git clone ${REPO_URL}.git
cd rag-in-the-box
npm install

cp .env.example .env
# fill in CLOUDFLARE_ACCOUNT_ID and CLOUDFLARE_API_TOKEN

./scripts/deploy.sh --profile production`}</code>
                  </pre>
                </div>
              </Card>
            </div>
          </div>
        </section>

        {/* Pricing */}
        <section id="pricing" className="border-b border-line py-16 sm:py-20">
          <div className="mx-auto max-w-6xl px-4 sm:px-6">
            <SectionHeading
              eyebrow="Pricing"
              title="Free to run. Paid only if you want me to do it."
              body="The code is free and always will be. The only thing sold here is my time."
            />
            <div className="mx-auto mt-10 grid max-w-4xl gap-4 md:grid-cols-2">
              <Card className="flex h-full min-w-0 flex-col">
                <CardHeader>
                  <Badge className="w-fit">Do it yourself</Badge>
                  <p className="pt-2 text-3xl font-semibold tracking-[-0.02em] text-ink">Free</p>
                  <p className="text-sm text-muted">Forever, under the MIT licence.</p>
                </CardHeader>
                <CardBody className="flex-1">
                  <ul className="space-y-2.5">
                    {[
                      "The whole codebase, no held back features",
                      "Step by step hosting guide",
                      "Deploy script that does the setup for you",
                      "Runs inside the Cloudflare free plan",
                      "Open issues and I will read them",
                    ].map((item) => (
                      <li key={item} className="flex min-w-0 items-start gap-2.5">
                        <Check className="mt-0.5 h-4 w-4 shrink-0 text-positive" aria-hidden />
                        <span className="text-sm leading-relaxed text-muted">{item}</span>
                      </li>
                    ))}
                  </ul>
                </CardBody>
                <div className="p-4 pt-0 sm:p-5 sm:pt-0">
                  <a href={REPO_URL} target="_blank" rel="noreferrer noopener" className="block">
                    <Button variant="secondary" className="w-full">
                      <GithubMark className="h-4 w-4" aria-hidden />
                      Clone the repository
                    </Button>
                  </a>
                </div>
              </Card>

              <Card className="flex h-full min-w-0 flex-col border-accent/40">
                <CardHeader>
                  <Badge tone="accent" className="w-fit">
                    Done for you
                  </Badge>
                  <p className="pt-2 text-3xl font-semibold tracking-[-0.02em] text-ink">
                    $300
                    <span className="ml-2 align-middle text-sm font-normal text-muted">
                      one off
                    </span>
                  </p>
                  <p className="text-sm text-muted">
                    Paid once, when the thing is working. No retainer.
                  </p>
                </CardHeader>
                <CardBody className="flex-1">
                  <ul className="space-y-2.5">
                    {[
                      "Set up on your own Cloudflare account, which you keep",
                      "Your domain, your keys, your data",
                      "Your first documents loaded and checked",
                      "Tuned to stay inside the free allowances for your volume",
                      "A walkthrough call, and two weeks of questions answered",
                    ].map((item) => (
                      <li key={item} className="flex min-w-0 items-start gap-2.5">
                        <Check className="mt-0.5 h-4 w-4 shrink-0 text-accent" aria-hidden />
                        <span className="text-sm leading-relaxed text-muted">{item}</span>
                      </li>
                    ))}
                  </ul>
                </CardBody>
                <div className="p-4 pt-0 sm:p-5 sm:pt-0">
                  <a
                    href="mailto:hello@mwhassan.com?subject=RAG%20in%20the%20Box%20setup"
                    className="block"
                  >
                    <Button className="w-full">Ask me to set it up</Button>
                  </a>
                  <p className="mt-3 text-center text-[0.75rem] text-faint">
                    If it cannot be made to work on your setup, you pay nothing.
                  </p>
                </div>
              </Card>
            </div>
          </div>
        </section>

        {/* Closing */}
        <section className="py-16 sm:py-20">
          <div className="mx-auto max-w-3xl px-4 text-center sm:px-6">
            <Server className="mx-auto h-6 w-6 text-accent" aria-hidden />
            <h2 className="mt-4 text-balance text-2xl font-semibold tracking-[-0.02em] text-ink sm:text-3xl">
              See it work before you decide anything
            </h2>
            <p className="mx-auto mt-3 max-w-xl text-pretty text-[0.9375rem] leading-relaxed text-muted">
              The demo has a document already loaded. Ask it something and watch the answer point
              back at the page it came from.
            </p>
            <Link to="/demo" className="mt-7 inline-block">
              <Button size="lg">
                Open the demo
                <ArrowRight className="h-4 w-4" aria-hidden />
              </Button>
            </Link>
          </div>
        </section>
      </main>

      <footer className="border-t border-line py-8">
        <div className="mx-auto flex max-w-6xl flex-col items-center gap-3 px-4 sm:flex-row sm:px-6">
          <Wordmark />
          <p className="text-center text-[0.8125rem] text-faint sm:text-left">
            MIT licensed. Built by{" "}
            <a
              href="https://mwhassan.com"
              className="text-muted underline underline-offset-2 hover:text-ink"
            >
              Muhammad Hassan
            </a>
            .
          </p>
          <div className="sm:ml-auto">
            <a
              href={REPO_URL}
              target="_blank"
              rel="noreferrer noopener"
              className="flex items-center gap-1.5 rounded-lg py-1 text-[0.8125rem] text-muted hover:text-ink"
            >
              <GithubMark className="h-3.5 w-3.5" aria-hidden />
              GitHub
            </a>
          </div>
        </div>
        {mode === "demo" && (
          <p className="mt-4 px-4 text-center text-[0.75rem] text-faint">
            This copy is running in demo mode with daily limits.
          </p>
        )}
      </footer>
    </div>
  );
}

function SectionHeading({
  eyebrow,
  title,
  body,
  align = "center",
}: {
  eyebrow: string;
  title: string;
  body: string;
  align?: "center" | "left";
}) {
  return (
    <div className={align === "center" ? "mx-auto max-w-2xl text-center" : "max-w-xl"}>
      <p className="text-[0.75rem] font-medium uppercase tracking-[0.08em] text-accent-text">
        {eyebrow}
      </p>
      <h2 className="mt-2 text-balance text-2xl font-semibold tracking-[-0.02em] text-ink sm:text-3xl">
        {title}
      </h2>
      <p className="mt-3 text-pretty text-[0.9375rem] leading-relaxed text-muted">{body}</p>
    </div>
  );
}

/** A still of the product, so the page shows the thing rather than describing it. */
function HeroPreview() {
  return (
    <Card className="overflow-hidden shadow-[var(--shadow-soft)]">
      <div className="flex items-center gap-1.5 border-b border-line bg-sunken px-3 py-2.5">
        <span className="h-2.5 w-2.5 rounded-full bg-line-strong" />
        <span className="h-2.5 w-2.5 rounded-full bg-line-strong" />
        <span className="h-2.5 w-2.5 rounded-full bg-line-strong" />
        <span className="ml-2 truncate font-mono text-[0.6875rem] text-faint">
          rib.mwhassan.com
        </span>
      </div>
      <div className="grid sm:grid-cols-2">
        <div className="min-w-0 border-line p-4 sm:border-r">
          <p className="mb-2 truncate text-[0.6875rem] uppercase tracking-wide text-faint">
            Source document
          </p>
          <div className="space-y-1.5">
            <div className="h-2 w-4/5 rounded bg-line" />
            <div className="h-2 w-full rounded bg-line" />
            <div className="h-2 w-full rounded bg-[color:var(--highlight)]" />
            <div className="h-2 w-3/4 rounded bg-[color:var(--highlight)]" />
            <div className="h-2 w-full rounded bg-line" />
            <div className="h-2 w-2/3 rounded bg-line" />
          </div>
        </div>
        <div className="min-w-0 p-4">
          <p className="mb-2 truncate text-[0.6875rem] uppercase tracking-wide text-faint">
            Answer
          </p>
          <p className="text-[0.8125rem] leading-relaxed text-muted">
            The review board meets twice a year
            <span className="mx-0.5 inline-flex h-[1.05rem] min-w-[1.05rem] items-center justify-center rounded border border-accent/40 bg-accent-soft px-1 align-baseline font-mono text-[0.625rem] leading-none text-accent-text">
              1
            </span>
            and publishes findings within sixty days
            <span className="mx-0.5 inline-flex h-[1.05rem] min-w-[1.05rem] items-center justify-center rounded border border-accent/40 bg-accent-soft px-1 align-baseline font-mono text-[0.625rem] leading-none text-accent-text">
              2
            </span>
            .
          </p>
          <div className="mt-3 flex flex-wrap gap-1.5">
            <Badge>1 handbook.pdf p12</Badge>
            <Badge>2 handbook.pdf p14</Badge>
          </div>
        </div>
      </div>
    </Card>
  );
}
