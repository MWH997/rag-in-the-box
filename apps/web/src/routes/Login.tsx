import { AlertCircle, Loader2 } from "lucide-react";
import { useEffect, useState, type FormEvent } from "react";
import { Link, useNavigate } from "react-router";
import { toast } from "sonner";

import { Wordmark } from "@/components/Logo";
import { Button } from "@/components/ui/button";
import { Card, CardBody } from "@/components/ui/card";
import { Input, Label } from "@/components/ui/field";
import { useAppMode } from "@/hooks/use-app-mode";
import { signIn, signUp, useSession } from "@/lib/session";
import { cn } from "@/lib/utils";

type Tab = "signin" | "signup";

export function Login() {
  const navigate = useNavigate();
  const { data: session, isPending } = useSession();
  const { mode, reachable, loading: modeLoading } = useAppMode();

  const [tab, setTab] = useState<Tab>("signin");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);

  // Redirects belong in an effect. Calling navigate during render updates the
  // router while this component is still rendering, which React warns about
  // and which can drop the navigation entirely.
  useEffect(() => {
    if (!isPending && session) void navigate("/app", { replace: true });
  }, [isPending, session, navigate]);

  useEffect(() => {
    if (!modeLoading && mode === "demo") void navigate("/demo", { replace: true });
  }, [mode, modeLoading, navigate]);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    try {
      const result =
        tab === "signin"
          ? await signIn.email({ email, password })
          : await signUp.email({ email, password, name: name || email.split("@")[0] || "You" });

      if (result.error) {
        toast.error(result.error.message ?? "That did not work. Check the details and try again.");
        return;
      }
      await navigate("/app", { replace: true });
    } catch {
      toast.error("The API could not be reached.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex min-h-dvh flex-col bg-bg">
      <header className="flex h-14 shrink-0 items-center px-4 sm:px-6">
        <Link to="/" className="-mx-1 rounded-lg px-1 py-1.5">
          <Wordmark />
        </Link>
      </header>

      <main className="flex flex-1 items-center justify-center px-4 py-8 sm:px-6">
        <div className="w-full max-w-sm">
          <h1 className="text-center text-xl font-semibold tracking-[-0.02em] text-ink">
            {tab === "signin" ? "Sign in to your workspace" : "Create a workspace"}
          </h1>
          <p className="mt-2 text-center text-sm leading-relaxed text-muted">
            {tab === "signin"
              ? "Your documents and their passages stay inside this workspace."
              : "A new workspace is created for you, sealed off from every other one."}
          </p>

          {!modeLoading && !reachable && (
            <div className="mt-5 flex items-start gap-2.5 rounded-[10px] border border-warning/40 bg-warning/10 px-3.5 py-3">
              <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-warning" aria-hidden />
              <p className="text-[0.8125rem] leading-relaxed text-ink">
                The API is not responding. Start it with{" "}
                <code className="font-mono text-[0.75rem]">npm run dev:api</code> and reload.
              </p>
            </div>
          )}

          <Card className="mt-6">
            <div className="flex gap-1 border-b border-line p-1.5">
              {(
                [
                  { id: "signin", label: "Sign in" },
                  { id: "signup", label: "Sign up" },
                ] as const
              ).map((option) => (
                <button
                  key={option.id}
                  type="button"
                  aria-pressed={tab === option.id}
                  onClick={() => setTab(option.id)}
                  className={cn(
                    "flex-1 rounded-lg px-3 py-2 text-[0.8125rem] font-medium transition-colors",
                    tab === option.id ? "bg-sunken text-ink" : "text-muted hover:text-ink",
                  )}
                >
                  {option.label}
                </button>
              ))}
            </div>

            <CardBody className="pt-4 sm:pt-5">
              <form onSubmit={submit} className="space-y-4">
                {tab === "signup" && (
                  <div className="space-y-1.5">
                    <Label htmlFor="name">Name</Label>
                    <Input
                      id="name"
                      autoComplete="name"
                      value={name}
                      onChange={(event) => setName(event.target.value)}
                      placeholder="Your name"
                    />
                  </div>
                )}
                <div className="space-y-1.5">
                  <Label htmlFor="email">Email</Label>
                  <Input
                    id="email"
                    type="email"
                    required
                    autoComplete="email"
                    value={email}
                    onChange={(event) => setEmail(event.target.value)}
                    placeholder="you@example.com"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="password">Password</Label>
                  <Input
                    id="password"
                    type="password"
                    required
                    minLength={8}
                    autoComplete={tab === "signin" ? "current-password" : "new-password"}
                    value={password}
                    onChange={(event) => setPassword(event.target.value)}
                    placeholder="At least 8 characters"
                  />
                </div>
                <Button type="submit" className="w-full" disabled={busy}>
                  {busy && <Loader2 className="h-4 w-4 animate-spin" aria-hidden />}
                  {tab === "signin" ? "Sign in" : "Create workspace"}
                </Button>
              </form>
            </CardBody>
          </Card>

          <p className="mt-5 text-center text-[0.8125rem] text-faint">
            Just looking?{" "}
            <Link to="/demo" className="text-muted underline underline-offset-2 hover:text-ink">
              Open the demo instead
            </Link>
          </p>
        </div>
      </main>
    </div>
  );
}
