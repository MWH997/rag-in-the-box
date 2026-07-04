import { Navigate, useNavigate } from "react-router";
import { motion } from "framer-motion";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { signOut, useSession } from "@/lib/auth-client";

export function App() {
  const { data: session, isPending } = useSession();
  const navigate = useNavigate();

  if (isPending) {
    return null;
  }

  if (!session) {
    return <Navigate to="/login" replace />;
  }

  async function handleLogout() {
    await signOut();
    navigate("/login");
  }

  return (
    <main className="p-8">
      <h1 className="text-2xl font-semibold">App</h1>
      <p className="text-muted-foreground text-sm">{session.user.email}</p>
      <Button variant="outline" className="mt-2" onClick={handleLogout}>
        Log out
      </Button>
      <motion.div
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.3 }}
        className="mt-4 max-w-sm"
      >
        <Card>
          <CardHeader>
            <CardTitle>Framer Motion placeholder</CardTitle>
          </CardHeader>
          <CardContent>This card fades and slides in on mount.</CardContent>
        </Card>
      </motion.div>
    </main>
  );
}
