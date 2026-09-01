import { Link } from "react-router";

import { Wordmark } from "@/components/Logo";
import { Button } from "@/components/ui/button";

export function NotFound() {
  return (
    <div className="flex min-h-dvh flex-col bg-bg">
      <header className="flex h-14 items-center px-4 sm:px-6">
        <Link to="/" className="-mx-1 rounded-lg px-1 py-1.5">
          <Wordmark />
        </Link>
      </header>
      <main className="flex flex-1 items-center justify-center px-4 py-12 text-center">
        <div className="max-w-sm">
          <p className="font-mono text-sm text-faint">404</p>
          <h1 className="mt-2 text-2xl font-semibold tracking-[-0.02em] text-ink">
            There is nothing at this address
          </h1>
          <p className="mt-2 text-sm leading-relaxed text-muted">
            The link may be out of date, or the page may have moved.
          </p>
          <Link to="/" className="mt-6 inline-block">
            <Button>Back to the start</Button>
          </Link>
        </div>
      </main>
    </div>
  );
}
