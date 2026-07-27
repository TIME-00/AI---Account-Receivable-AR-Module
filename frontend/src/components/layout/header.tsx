"use client";

import { useAuth } from "@/providers/auth-provider";
import { useCompanyStore } from "@/stores/company-store";
import { useUserRole } from "@/hooks/use-user-role";
import { useGlobalSearch } from "@/hooks/use-global-search";
import { cn } from "@/lib/utils";
import { useRouter } from "next/navigation";
import {
  Building2,
  ChevronDown,
  LogOut,
  User,
  Search,
  Loader2,
  FileText,
  Receipt,
  Users,
} from "lucide-react";
import { useState, useRef, useEffect } from "react";
import type { GlobalSearchResult } from "@/types";
import { NotificationDropdown } from "@/components/features/notifications/notification-dropdown";

const SEARCH_TYPE_ICON: Record<GlobalSearchResult["type"], typeof FileText> = {
  customer: Users,
  invoice: FileText,
  receipt: Receipt,
};

export function Header() {
  const router = useRouter();
  const { user, signOut } = useAuth();
  const { companyName, companies, companyId, setCompany } = useCompanyStore();
  const { role, isLoading: roleLoading } = useUserRole();
  const displayRole = roleLoading ? "Loading…" : role ?? "Read-only";

  const [showCompanyMenu, setShowCompanyMenu] = useState(false);
  const [showUserMenu, setShowUserMenu] = useState(false);

  // ─── Global Search ──────────────────────────────────────────────────────
  const [searchQuery, setSearchQuery] = useState("");
  const [searchFocused, setSearchFocused] = useState(false);
  const trimmedQuery = searchQuery.trim();
  const {
    data: searchResults,
    isFetching: searchFetching,
    isError: searchError,
  } = useGlobalSearch(searchQuery);
  const showSearchDropdown = searchFocused && trimmedQuery.length >= 2;

  const companyMenuRef = useRef<HTMLDivElement>(null);
  const userMenuRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLDivElement>(null);

  // Close menus on outside click
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      const t = e.target as Node;
      if (companyMenuRef.current && !companyMenuRef.current.contains(t)) setShowCompanyMenu(false);
      if (userMenuRef.current && !userMenuRef.current.contains(t)) setShowUserMenu(false);
      if (searchRef.current && !searchRef.current.contains(t)) setSearchFocused(false);
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const goTo = (route: string) => {
    setSearchFocused(false);
    setSearchQuery("");
    router.push(route);
  };

  return (
    <header className="relative z-30 flex h-16 items-center justify-between border-b border-slate-200 bg-white/80 px-6 backdrop-blur-xl">
      {/* Left: Global Search */}
      <div className="flex items-center gap-3">
        <div className="relative" ref={searchRef}>
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            onFocus={() => setSearchFocused(true)}
            placeholder="Search invoices, customers, receipts..."
            className="h-9 w-72 rounded-lg border border-slate-300 bg-white pl-9 pr-4 text-sm text-slate-700 placeholder:text-slate-400 transition-colors focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500/30"
          />

          {showSearchDropdown && (
            <div className="absolute left-0 top-full z-50 mt-1 w-96 animate-fade-in overflow-hidden rounded-lg border border-slate-200 bg-white py-1 shadow-xl shadow-slate-200/50">
              {searchFetching ? (
                <div className="flex items-center gap-2 px-3 py-3 text-sm text-slate-500">
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Searching…
                </div>
              ) : searchError ? (
                <div className="px-3 py-3 text-sm text-red-500">
                  Search is unavailable right now. Please try again.
                </div>
              ) : !searchResults || searchResults.length === 0 ? (
                <div className="px-3 py-3 text-sm text-slate-500">
                  No matches for “{trimmedQuery}”.
                </div>
              ) : (
                <ul className="max-h-80 overflow-y-auto">
                  {searchResults.map((r) => {
                    const Icon = SEARCH_TYPE_ICON[r.type];
                    return (
                      <li key={`${r.type}-${r.id}`}>
                        <button
                          onClick={() => goTo(r.route)}
                          className="flex w-full items-start gap-2.5 px-3 py-2 text-left transition-colors hover:bg-slate-50"
                        >
                          <Icon className="mt-0.5 h-4 w-4 shrink-0 text-slate-400" />
                          <div className="min-w-0">
                            <p className="truncate text-sm font-medium text-slate-700">{r.title}</p>
                            <p className="truncate text-xs text-slate-400">{r.subtitle}</p>
                          </div>
                          <span className="ml-auto shrink-0 rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-medium uppercase text-slate-400">
                            {r.type}
                          </span>
                        </button>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
          )}
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

        {/* Notifications — self-contained Gate B dropdown (shared data contract) */}
        <NotificationDropdown />

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
              <p className="text-[10px] text-slate-400">{displayRole}</p>
            </div>
          </button>

          {showUserMenu && (
            <div className="absolute right-0 top-full z-50 mt-1 w-48 animate-fade-in rounded-lg border border-slate-200 bg-white py-1 shadow-xl shadow-slate-200/50">
              <div className="border-b border-slate-200 px-3 py-2">
                <p className="truncate text-xs font-medium text-slate-700">{user?.email ?? "Signed in"}</p>
                <p className="text-[10px] text-slate-400">{displayRole}</p>
              </div>
              <button
                onClick={() => {
                  setShowUserMenu(false);
                  router.push("/profile");
                }}
                className="flex w-full items-center gap-2 px-3 py-2 text-sm text-slate-700 transition-colors hover:bg-slate-50"
              >
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
