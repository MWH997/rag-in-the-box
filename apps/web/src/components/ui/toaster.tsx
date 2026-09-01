import { Toaster as Sonner } from "sonner";

/** Toasts, themed from the same tokens as everything else. */
export function Toaster() {
  return (
    <Sonner
      position="bottom-right"
      toastOptions={{
        style: {
          background: "var(--bg-raised)",
          border: "1px solid var(--border)",
          color: "var(--text)",
          borderRadius: "12px",
          fontSize: "0.875rem",
        },
      }}
    />
  );
}
