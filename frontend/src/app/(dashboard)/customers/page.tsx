"use client";

import { Users, Plus } from "lucide-react";
import { LoadingButton } from "@/components/ui/loading-button";

export default function CustomersPage() {
  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-slate-900">Customer Management</h1>
          <p className="mt-1 text-sm text-slate-500">Customer master data, credit management & account mapping</p>
        </div>
        <LoadingButton variant="primary" size="md">
          <Plus className="h-4 w-4" />
          New Customer
        </LoadingButton>
      </div>

      <div className="glass-card flex flex-col items-center justify-center py-20">
        <Users className="h-12 w-12 text-slate-600" />
        <p className="mt-4 text-sm text-slate-500">Customer management module coming soon</p>
      </div>
    </div>
  );
}
