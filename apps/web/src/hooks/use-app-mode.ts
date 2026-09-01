import type { HealthResponse } from "@rag/shared";
import { useEffect, useState } from "react";

import { api } from "@/lib/api";

/**
 * Whether this deployment is the public demo or a self-hosted install.
 *
 * The answer decides whether sign-in exists at all, so it is read once from the
 * API rather than compiled into the bundle. That keeps one build able to serve
 * both, which is what makes the demo and the product the same codebase.
 */
export function useAppMode(): {
  mode: HealthResponse["mode"] | null;
  version: string | null;
  reachable: boolean;
  loading: boolean;
} {
  const [state, setState] = useState<{
    mode: HealthResponse["mode"] | null;
    version: string | null;
    reachable: boolean;
    loading: boolean;
  }>({ mode: null, version: null, reachable: false, loading: true });

  useEffect(() => {
    let cancelled = false;
    api
      .health()
      .then((health) => {
        if (!cancelled) {
          setState({
            mode: health.mode,
            version: health.version,
            reachable: true,
            loading: false,
          });
        }
      })
      .catch(() => {
        if (!cancelled) {
          setState({ mode: null, version: null, reachable: false, loading: false });
        }
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return state;
}
