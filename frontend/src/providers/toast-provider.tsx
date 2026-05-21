"use client";

import { Toaster } from "sonner";

export function ToastProvider() {
  return (
    <Toaster
      position="top-right"
      theme="dark"
      richColors
      closeButton
      toastOptions={{
        duration: 4000,
        style: {
          background: "#1e293b",
          border: "1px solid #334155",
          color: "#e2e8f0",
          fontSize: "0.875rem",
        },
        className: "!rounded-lg",
      }}
    />
  );
}
