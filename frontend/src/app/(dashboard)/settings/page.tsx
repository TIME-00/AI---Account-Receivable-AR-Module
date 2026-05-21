"use client";

import { Settings } from "lucide-react";

export default function SettingsPage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-slate-900">System Settings</h1>
        <p className="mt-1 text-sm text-slate-500">GL Account Configuration, Tax Code Management & System Parameters</p>
      </div>
      <div className="glass-card flex flex-col items-center justify-center py-20">
        <Settings className="h-12 w-12 text-slate-600" />
        <p className="mt-4 text-sm text-slate-500">System Settings module coming soon</p>
      </div>
    </div>
  );
}
