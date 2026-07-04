import { useState } from "react";
import type { FormEvent } from "react";
import { useNavigate } from "react-router";
import { toast } from "sonner";
import { signIn, signUp, useSession } from "@/lib/auth-client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Navigate } from "react-router";

export function Login() {
  const { data: session, isPending } = useSession();
  const navigate = useNavigate();
  const [loading, setLoading] = useState(false);

  if (isPending) {
    return null;
  }

  if (session) {
    return <Navigate to="/app" replace />;
  }

  async function handleLogin(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setLoading(true);
    const { error } = await signIn.email({
      email: String(form.get("email")),
      password: String(form.get("password")),
    });
    setLoading(false);
    if (error) {
      toast.error(error.message ?? "Could not sign in");
      return;
    }
    navigate("/app");
  }

  async function handleSignup(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setLoading(true);
    const { error } = await signUp.email({
      name: String(form.get("name")),
      email: String(form.get("email")),
      password: String(form.get("password")),
    });
    setLoading(false);
    if (error) {
      toast.error(error.message ?? "Could not sign up");
      return;
    }
    navigate("/app");
  }

  return (
    <main className="flex min-h-svh items-center justify-center p-4">
      <Card className="w-full max-w-sm">
        <CardHeader>
          <CardTitle>RAG-in-a-Box</CardTitle>
        </CardHeader>
        <CardContent>
          <Tabs defaultValue="login">
            <TabsList className="w-full">
              <TabsTrigger value="login">Log in</TabsTrigger>
              <TabsTrigger value="signup">Sign up</TabsTrigger>
            </TabsList>
            <TabsContent value="login">
              <form className="flex flex-col gap-4" onSubmit={handleLogin}>
                <div className="flex flex-col gap-2">
                  <Label htmlFor="login-email">Email</Label>
                  <Input id="login-email" name="email" type="email" required />
                </div>
                <div className="flex flex-col gap-2">
                  <Label htmlFor="login-password">Password</Label>
                  <Input id="login-password" name="password" type="password" required />
                </div>
                <Button type="submit" disabled={loading}>
                  Log in
                </Button>
              </form>
            </TabsContent>
            <TabsContent value="signup">
              <form className="flex flex-col gap-4" onSubmit={handleSignup}>
                <div className="flex flex-col gap-2">
                  <Label htmlFor="signup-name">Name</Label>
                  <Input id="signup-name" name="name" required />
                </div>
                <div className="flex flex-col gap-2">
                  <Label htmlFor="signup-email">Email</Label>
                  <Input id="signup-email" name="email" type="email" required />
                </div>
                <div className="flex flex-col gap-2">
                  <Label htmlFor="signup-password">Password</Label>
                  <Input id="signup-password" name="password" type="password" required minLength={8} />
                </div>
                <Button type="submit" disabled={loading}>
                  Sign up
                </Button>
              </form>
            </TabsContent>
          </Tabs>
        </CardContent>
      </Card>
    </main>
  );
}
