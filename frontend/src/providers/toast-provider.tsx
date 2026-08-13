"use client";

import { Toaster } from "sonner";
import { useTheme } from "@/providers/theme-provider";

/**
 * Toasts follow the active theme. Colours come from the same tokens as the rest
 * of the shell rather than from the hard-coded slate hexes this component used
 * to carry, so a toast can never arrive styled for the wrong theme.
 */
export function ToastProvider() {
  const { theme } = useTheme();

  return (
    <Toaster
      position="top-right"
      theme={theme}
      richColors
      closeButton
      toastOptions={{
        duration: 4000,
        style: {
          background: "rgb(var(--surface-elevated))",
          border: "1px solid rgb(var(--border-strong))",
          color: "rgb(var(--text-primary))",
          boxShadow: "var(--shadow-elevated)",
          fontSize: "0.875rem",
        },
        className: "!rounded-lg",
      }}
    />
  );
}
