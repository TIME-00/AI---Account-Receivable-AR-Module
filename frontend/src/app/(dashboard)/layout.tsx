"use client";

import { useAuth } from "@/providers/auth-provider";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { Sidebar } from "@/components/layout/sidebar";
import { Header } from "@/components/layout/header";
import { ArCopilotPanel } from "@/components/features/ar-copilot/copilot-panel";
import { CopilotEntityProvider } from "@/providers/copilot-entity-provider";
import { usePathname } from "next/navigation";

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const { user, isLoading } = useAuth();
  const router = useRouter();
  const pathname = usePathname();
  const [copilotOpen, setCopilotOpen] = useState(false);

  useEffect(() => {
    if (!isLoading && !user) {
      router.replace("/login");
    }
  }, [user, isLoading, router]);

  // Show loading state while checking auth
  if (isLoading) {
    return (
      <div className="flex h-screen items-center justify-center bg-app-bg">
        <div className="flex flex-col items-center gap-4">
          <div className="h-10 w-10 animate-spin rounded-full border-2 border-brand-500 border-t-transparent" />
          <p className="text-sm text-slate-500">Loading...</p>
        </div>
      </div>
    );
  }

  // Don't render dashboard if not authenticated
  if (!user) return null;

  return (
    // The provider lets a detail screen tell the Copilot which record it shows.
    // It wraps the whole shell so the panel and the page share one registration.
    <CopilotEntityProvider>
      <div className="flex h-screen overflow-hidden bg-app-bg">
        {/* Sidebar */}
        <Sidebar onToggleHelp={() => setCopilotOpen((v) => !v)} />

        {/* Main Content Area */}
        <div className="flex flex-1 flex-col overflow-hidden">
          <Header />

          {/* Page Content */}
          {/* `key={pathname}` restarts the entry animation on every navigation,
              so a route change reads as the content arriving rather than as an
              instant swap. The shell itself never re-animates. */}
          <main key={pathname} className="ds-page-enter flex-1 overflow-auto p-6">
            {children}
          </main>
        </div>

        {/* AR Copilot — AI assistant plus the preserved Workflow Guide */}
        {copilotOpen && <ArCopilotPanel onClose={() => setCopilotOpen(false)} />}
      </div>
    </CopilotEntityProvider>
  );
}
