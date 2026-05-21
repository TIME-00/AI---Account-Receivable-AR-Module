import type { Metadata } from "next";
import "./globals.css";
import { QueryProvider } from "@/providers/query-provider";
import { ToastProvider } from "@/providers/toast-provider";
import { AuthProvider } from "@/providers/auth-provider";

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
    <html lang="en" suppressHydrationWarning>
      <body className="min-h-screen" suppressHydrationWarning>
        <AuthProvider>
          <QueryProvider>
            {children}
            <ToastProvider />
          </QueryProvider>
        </AuthProvider>
      </body>
    </html>
  );
}
