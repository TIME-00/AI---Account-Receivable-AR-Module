"use client";

import { BookOpen } from "lucide-react";

export default function JournalEntriesPage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-slate-900">Journal Entries</h1>
        <p className="mt-1 text-sm text-slate-500">View auto-generated accounting journal entries</p>
      </div>
      <div className="glass-card flex flex-col items-center justify-center py-20">
        <BookOpen className="h-12 w-12 text-slate-600" />
        <p className="mt-4 text-sm text-slate-500">Journal Entries module coming soon</p>
      </div>
    </div>
  );
}
