"use client";

import { useAuth } from "@/providers/auth-provider";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { Sidebar } from "@/components/layout/sidebar";
import { Header } from "@/components/layout/header";

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const { user, isLoading } = useAuth();
  const router = useRouter();
  const [aiOpen, setAiOpen] = useState(false);

  useEffect(() => {
    if (!isLoading && !user) {
      router.replace("/login");
    }
  }, [user, isLoading, router]);

  // Show loading state while checking auth
  if (isLoading) {
    return (
      <div className="flex h-screen items-center justify-center bg-white">
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
    <div className="flex h-screen overflow-hidden bg-slate-50">
      {/* Sidebar */}
      <Sidebar onToggleAI={() => setAiOpen(!aiOpen)} />

      {/* Main Content Area */}
      <div className="flex flex-1 flex-col overflow-hidden">
        <Header />

        {/* Page Content */}
        <main className="flex-1 overflow-auto p-6">
          {children}
        </main>
      </div>

      {/* AI Chat Sidebar (placeholder — Phase 5) */}
      {aiOpen && (
        <div className="w-[380px] animate-slide-in-right border-l border-slate-200 bg-white/95 backdrop-blur-xl">
          <div className="flex h-16 items-center justify-between border-b border-slate-200 px-4">
            <div className="flex items-center gap-2">
              <div className="h-2 w-2 animate-pulse-subtle rounded-full bg-purple-500" />
              <h3 className="text-sm font-semibold text-slate-900">AI Assistant</h3>
            </div>
            <button
              onClick={() => setAiOpen(false)}
              className="text-sm text-slate-500 hover:text-slate-700 transition-colors"
            >
              Close
            </button>
          </div>
          <div className="flex flex-1 flex-col items-center justify-center p-6">
            <p className="text-xs text-slate-500 text-center">
              AI Assistant coming soon.<br />
              Try commands like &quot;Analyze ABC customer repayment trend&quot;.
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
