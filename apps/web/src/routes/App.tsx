import { Link } from "react-router";
import { motion } from "framer-motion";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export function App() {
  return (
    <main className="p-8">
      <h1 className="text-2xl font-semibold">App</h1>
      <Link to="/login">Log out</Link>
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
