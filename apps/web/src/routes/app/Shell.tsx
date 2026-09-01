import { BarChart3, FileText, LogOut, Menu, MessageSquare, Settings, X } from "lucide-react";
import { useEffect, useState } from "react";
import { Link, NavLink, Outlet, useLocation, useNavigate } from "react-router";

import { Wordmark } from "@/components/Logo";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useAppMode } from "@/hooks/use-app-mode";
import { api } from "@/lib/api";
import { onTierChange } from "@/lib/events";
import { signOut, useSession } from "@/lib/session";
import { cn } from "@/lib/utils";

const NAV = [
  { to: "/app", label: "Documents", icon: FileText, end: true },
  { to: "/app/chat", label: "Answers", icon: MessageSquare, end: false },
  { to: "/app/usage", label: "Usage", icon: BarChart3, end: false },
  { to: "/app/settings", label: "Settings", icon: Settings, end: false },
];

/**
 * The signed-in layout.
 *
 * The navigation is a rail from 768 px up and a drawer below it. The drawer
 * closes on navigation, which is the behaviour a reader expects and the thing
 * most often forgotten.
 */
export function AppShell() {
  const navigate = useNavigate();
  const location = useLocation();
  const { data: session, isPending } = useSession();
  const { mode, loading: modeLoading } = useAppMode();
  const [menuOpen, setMenuOpen] = useState(false);
  const [tier, setTier] = useState<string | null>(null);

  useEffect(() => {
    setMenuOpen(false);
  }, [location.pathname]);

  useEffect(() => {
    if (!modeLoading && mode === "demo") void navigate("/demo", { replace: true });
  }, [mode, modeLoading, navigate]);

  useEffect(() => {
    if (!isPending && !session && mode !== "demo") void navigate("/login", { replace: true });
  }, [isPending, session, mode, navigate]);

  useEffect(() => {
    api
      .me()
      .then((me) => setTier(me.tier))
      .catch(() => setTier(null));
  }, [location.pathname]);

  // The badge follows a change made on the settings screen without waiting for
  // the next navigation.
  useEffect(() => onTierChange(setTier), []);

  if (isPending || (!session && mode !== "demo")) {
    return (
      <div className="flex h-dvh items-center justify-center bg-bg">
        <p className="text-sm text-muted">Loading your workspace</p>
      </div>
    );
  }

  return (
    <div className="flex h-dvh min-w-0 overflow-hidden bg-bg">
      {/* Rail, from tablet up */}
      <aside className="hidden w-56 shrink-0 flex-col border-r border-line bg-raised md:flex">
        <div className="flex h-14 shrink-0 items-center border-b border-line px-4">
          <Link to="/" className="-mx-1 min-w-0 rounded-lg px-1 py-1.5">
            <Wordmark />
          </Link>
        </div>
        <nav className="flex min-h-0 flex-1 flex-col gap-0.5 overflow-y-auto p-2.5">
          {NAV.map((item) => (
            <NavItem key={item.to} {...item} />
          ))}
        </nav>
        <div className="shrink-0 border-t border-line p-3">
          {tier && (
            <Badge tone={tier === "paid" ? "accent" : "neutral"} className="mb-2">
              {tier === "paid" ? "Paid tier" : "Free tier"}
            </Badge>
          )}
          <p className="truncate text-[0.75rem] text-faint" title={session?.user.email}>
            {session?.user.email}
          </p>
          <Button
            variant="ghost"
            size="sm"
            className="mt-2 w-full justify-start"
            onClick={() => {
              void signOut().then(() => navigate("/login", { replace: true }));
            }}
          >
            <LogOut className="h-3.5 w-3.5" aria-hidden />
            Sign out
          </Button>
        </div>
      </aside>

      <div className="flex min-h-0 min-w-0 flex-1 flex-col">
        {/* Bar, below tablet */}
        <header className="flex h-14 shrink-0 items-center gap-2 border-b border-line bg-raised px-4 md:hidden">
          <Link to="/" className="-mx-1 min-w-0 shrink rounded-lg px-1 py-1.5">
            <Wordmark />
          </Link>
          <div className="ml-auto flex shrink-0 items-center gap-2">
            {tier && (
              <Badge tone={tier === "paid" ? "accent" : "neutral"}>
                {tier === "paid" ? "Paid" : "Free"}
              </Badge>
            )}
            <Button
              variant="ghost"
              size="icon"
              aria-label={menuOpen ? "Close menu" : "Open menu"}
              aria-expanded={menuOpen}
              onClick={() => setMenuOpen((open) => !open)}
            >
              {menuOpen ? (
                <X className="h-4 w-4" aria-hidden />
              ) : (
                <Menu className="h-4 w-4" aria-hidden />
              )}
            </Button>
          </div>
        </header>

        {menuOpen && (
          <div className="shrink-0 border-b border-line bg-raised p-2.5 md:hidden">
            <nav className="flex flex-col gap-0.5">
              {NAV.map((item) => (
                <NavItem key={item.to} {...item} />
              ))}
            </nav>
            <div className="mt-2 flex min-w-0 items-center gap-2 border-t border-line pt-2">
              <p className="min-w-0 flex-1 truncate text-[0.75rem] text-faint">
                {session?.user.email}
              </p>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => {
                  void signOut().then(() => navigate("/login", { replace: true }));
                }}
              >
                <LogOut className="h-3.5 w-3.5" aria-hidden />
                Sign out
              </Button>
            </div>
          </div>
        )}

        <main className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
          <Outlet />
        </main>
      </div>
    </div>
  );
}

function NavItem({
  to,
  label,
  icon: Icon,
  end,
}: {
  to: string;
  label: string;
  icon: typeof FileText;
  end: boolean;
}) {
  return (
    <NavLink
      to={to}
      end={end}
      className={({ isActive }) =>
        cn(
          "flex min-w-0 items-center gap-2.5 rounded-lg px-3 py-2 text-sm transition-colors",
          isActive ? "bg-sunken font-medium text-ink" : "text-muted hover:bg-sunken hover:text-ink",
        )
      }
    >
      <Icon className="h-4 w-4 shrink-0" aria-hidden />
      <span className="truncate">{label}</span>
    </NavLink>
  );
}
