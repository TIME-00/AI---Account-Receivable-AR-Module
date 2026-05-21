"use client";

import { useAuth } from "@/providers/auth-provider";
import { useCompanyStore } from "@/stores/company-store";
import { cn } from "@/lib/utils";
import {
  Building2,
  ChevronDown,
  LogOut,
  User,
  Bell,
  Search,
} from "lucide-react";
import { useState, useRef, useEffect } from "react";

export function Header() {
  const { user, signOut } = useAuth();
  const { companyName, companies, companyId, setCompany } = useCompanyStore();
  const [showCompanyMenu, setShowCompanyMenu] = useState(false);
  const [showUserMenu, setShowUserMenu] = useState(false);
  const companyMenuRef = useRef<HTMLDivElement>(null);
  const userMenuRef = useRef<HTMLDivElement>(null);

  // Close menus on outside click
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (companyMenuRef.current && !companyMenuRef.current.contains(e.target as Node)) {
        setShowCompanyMenu(false);
      }
      if (userMenuRef.current && !userMenuRef.current.contains(e.target as Node)) {
        setShowUserMenu(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  return (
    <header className="flex h-16 items-center justify-between border-b border-slate-200 bg-white/80 px-6 backdrop-blur-xl">
      {/* Left: Search (placeholder for future) */}
      <div className="flex items-center gap-3">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
          <input
            type="text"
            placeholder="Search invoices, customers, receipts..."
            className="h-9 w-72 rounded-lg border border-slate-300 bg-white pl-9 pr-4 text-sm text-slate-700 placeholder:text-slate-400 transition-colors focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500/30"
          />
        </div>
      </div>

      {/* Right: Company Switcher + Notifications + User */}
      <div className="flex items-center gap-3">
        {/* Company Switcher */}
        <div className="relative" ref={companyMenuRef}>
          <button
            onClick={() => setShowCompanyMenu(!showCompanyMenu)}
            className="flex items-center gap-2 rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-700 transition-all hover:border-slate-400 hover:bg-slate-50"
          >
            <Building2 className="h-4 w-4 text-brand-500" />
            <span className="max-w-[160px] truncate font-medium">{companyName}</span>
            <ChevronDown className={cn("h-3.5 w-3.5 transition-transform", showCompanyMenu && "rotate-180")} />
          </button>

          {showCompanyMenu && (
            <div className="absolute right-0 top-full z-50 mt-1 w-64 animate-fade-in rounded-lg border border-slate-200 bg-white py-1 shadow-xl shadow-slate-200/50">
              <div className="px-3 py-2 text-[10px] font-semibold uppercase tracking-widest text-slate-400">
                Select Company
              </div>
              {companies.length > 0 ? (
                companies.map((c) => (
                  <button
                    key={c.id}
                    onClick={() => {
                      setCompany(c.id, c.name, c.currency);
                      setShowCompanyMenu(false);
                    }}
                    className={cn(
                      "flex w-full items-center gap-2 px-3 py-2 text-sm transition-colors",
                      c.id === companyId
                        ? "bg-brand-50 text-brand-600"
                        : "text-slate-700 hover:bg-slate-50"
                    )}
                  >
                    <Building2 className="h-3.5 w-3.5 shrink-0" />
                    <div className="text-left">
                      <p className="font-medium">{c.name}</p>
                      <p className="text-[11px] text-slate-400">{c.code} · {c.currency}</p>
                    </div>
                    {c.id === companyId && (
                      <div className="ml-auto h-2 w-2 rounded-full bg-brand-500" />
                    )}
                  </button>
                ))
              ) : (
                <div className="px-3 py-3 text-xs text-slate-500">
                  Current company: {companyName}
                </div>
              )}
            </div>
          )}
        </div>

        {/* Notifications */}
        <button className="relative flex h-9 w-9 items-center justify-center rounded-lg text-slate-500 transition-colors hover:bg-slate-100 hover:text-slate-700">
          <Bell className="h-4 w-4" />
          <span className="absolute -right-0.5 -top-0.5 flex h-4 w-4 items-center justify-center rounded-full bg-red-500 text-[10px] font-bold text-white">
            3
          </span>
        </button>

        {/* User Menu */}
        <div className="relative" ref={userMenuRef}>
          <button
            onClick={() => setShowUserMenu(!showUserMenu)}
            className="flex items-center gap-2 rounded-lg px-2 py-1.5 transition-colors hover:bg-slate-100"
          >
            <div className="flex h-8 w-8 items-center justify-center rounded-full bg-gradient-to-br from-brand-500 to-brand-700 text-xs font-bold text-white">
              {user?.email?.charAt(0).toUpperCase() ?? "U"}
            </div>
            <div className="hidden text-left md:block">
              <p className="text-xs font-medium text-slate-700">
                {user?.email?.split("@")[0] ?? "User"}
              </p>
              <p className="text-[10px] text-slate-400">AR Clerk</p>
            </div>
          </button>

          {showUserMenu && (
            <div className="absolute right-0 top-full z-50 mt-1 w-48 animate-fade-in rounded-lg border border-slate-200 bg-white py-1 shadow-xl shadow-slate-200/50">
              <div className="border-b border-slate-200 px-3 py-2">
                <p className="text-xs font-medium text-slate-700">{user?.email ?? "user@example.com"}</p>
              </div>
              <button className="flex w-full items-center gap-2 px-3 py-2 text-sm text-slate-700 transition-colors hover:bg-slate-50">
                <User className="h-3.5 w-3.5" />
                My Profile
              </button>
              <button
                onClick={signOut}
                className="flex w-full items-center gap-2 px-3 py-2 text-sm text-red-500 transition-colors hover:bg-slate-50"
              >
                <LogOut className="h-3.5 w-3.5" />
                Sign Out
              </button>
            </div>
          )}
        </div>
      </div>
    </header>
  );
}
