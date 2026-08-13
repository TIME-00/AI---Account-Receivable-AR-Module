import type { Metadata } from "next";
import "./globals.css";
import { QueryProvider } from "@/providers/query-provider";
import { ToastProvider } from "@/providers/toast-provider";
import { AuthProvider } from "@/providers/auth-provider";
import { ThemeProvider } from "@/providers/theme-provider";
import { THEME_BOOTSTRAP_SCRIPT } from "@/lib/theme/bootstrap";

export const metadata: Metadata = {
  title: "TSH Synergy AR — Accounts Receivable Module",
  description: "Professional accounts receivable management system powered by GenAI. Manage invoices, receipts, allocations, and credit control.",
  keywords: ["AR", "Accounts Receivable", "ERP", "TSH Synergy", "Invoice Management"],
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    // Dark is rendered on the server and defined on `:root`, so the document's
    // first paint is dark before any script runs. `suppressHydrationWarning` is
    // retained because the authenticated provider may reconcile an account's
    // saved Light preference immediately after identity resolution.
    <html lang="en" className="dark" suppressHydrationWarning>
      <head>
        <script
          // Runs synchronously in <head> and enforces the safe Dark default.
          // No account preference is read until authenticated identity resolves.
          dangerouslySetInnerHTML={{ __html: THEME_BOOTSTRAP_SCRIPT }}
        />
      </head>
      <body className="min-h-screen" suppressHydrationWarning>
        <AuthProvider>
          <QueryProvider>
            <ThemeProvider>
              {children}
              <ToastProvider />
            </ThemeProvider>
          </QueryProvider>
        </AuthProvider>
      </body>
    </html>
  );
}
