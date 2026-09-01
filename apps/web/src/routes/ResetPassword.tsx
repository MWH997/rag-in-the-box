import { CheckCircle2, Loader2, TriangleAlert } from "lucide-react";
import { useEffect, useState, type FormEvent } from "react";
import { Link, useNavigate, useSearchParams } from "react-router";

import { Wordmark } from "@/components/Logo";
import { Button } from "@/components/ui/button";
import { Card, CardBody } from "@/components/ui/card";
import { Input, Label } from "@/components/ui/field";
import { authClient } from "@/lib/session";

/**
 * Where a workspace invitation lands.
 *
 * Someone provisioned by an operator has an account but no password. The
 * provisioning script hands them a one-time link, and this is the only place
 * that link is useful: they choose their own password here, and the operator
 * never learns it.
 */
export function ResetPassword() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const token = params.get("token") ?? "";

  const [password, setPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  // A new link means a new attempt. Without this, arriving at a second
  // invitation from inside the app would show the previous success message.
  useEffect(() => {
    setDone(false);
    setError(null);
    setPassword("");
    setConfirmation("");
  }, [token]);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setError(null);

    if (password.length < 8) {
      setError("Use at least eight characters.");
      return;
    }
    if (password !== confirmation) {
      setError("The two passwords do not match.");
      return;
    }

    setBusy(true);
    try {
      const result = await authClient.resetPassword({ newPassword: password, token });
      if (result.error) {
        setError(
          result.error.message ??
            "That link did not work. It may have been used already, or expired.",
        );
        return;
      }
      setDone(true);
    } catch {
      setError("The API could not be reached.");
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
          {!token ? (
            <Card>
              <CardBody className="space-y-3 pt-5">
                <div className="flex items-start gap-2.5">
                  <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0 text-warning" aria-hidden />
                  <div className="min-w-0 space-y-1">
                    <p className="text-sm font-medium text-ink">This link is incomplete</p>
                    <p className="text-sm leading-relaxed text-muted">
                      Open the invitation link exactly as it was sent to you. It carries a
                      one-time code that this page needs.
                    </p>
                  </div>
                </div>
                <Link to="/login">
                  <Button variant="secondary" className="w-full">
                    Go to sign in
                  </Button>
                </Link>
              </CardBody>
            </Card>
          ) : done ? (
            <Card>
              <CardBody className="space-y-3 pt-5 text-center">
                <CheckCircle2 className="mx-auto h-6 w-6 text-positive" aria-hidden />
                <div className="space-y-1">
                  <p className="text-sm font-medium text-ink">Your password is set</p>
                  <p className="text-sm leading-relaxed text-muted">
                    Sign in with it and your workspace will be waiting.
                  </p>
                </div>
                <Button className="w-full" onClick={() => void navigate("/login")}>
                  Sign in
                </Button>
              </CardBody>
            </Card>
          ) : (
            <>
              <h1 className="text-center text-xl font-semibold tracking-[-0.02em] text-ink">
                Choose a password
              </h1>
              <p className="mt-2 text-center text-sm leading-relaxed text-muted">
                Your workspace is ready. Pick a password and nobody else will know it, including
                whoever set the workspace up.
              </p>

              <Card className="mt-6">
                <CardBody className="pt-5">
                  <form onSubmit={submit} className="space-y-4">
                    <div className="space-y-1.5">
                      <Label htmlFor="password">New password</Label>
                      <Input
                        id="password"
                        type="password"
                        required
                        minLength={8}
                        autoComplete="new-password"
                        value={password}
                        onChange={(event) => setPassword(event.target.value)}
                        placeholder="At least 8 characters"
                      />
                    </div>
                    <div className="space-y-1.5">
                      <Label htmlFor="confirmation">Repeat it</Label>
                      <Input
                        id="confirmation"
                        type="password"
                        required
                        autoComplete="new-password"
                        value={confirmation}
                        onChange={(event) => setConfirmation(event.target.value)}
                        placeholder="The same again"
                      />
                    </div>

                    {error && (
                      <p className="wrap-anywhere text-[0.8125rem] leading-relaxed text-danger">
                        {error}
                      </p>
                    )}

                    <Button type="submit" className="w-full" disabled={busy}>
                      {busy && <Loader2 className="h-4 w-4 animate-spin" aria-hidden />}
                      Set the password
                    </Button>
                  </form>
                </CardBody>
              </Card>
            </>
          )}
        </div>
      </main>
    </div>
  );
}
