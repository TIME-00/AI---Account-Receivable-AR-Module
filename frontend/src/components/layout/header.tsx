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
import { ThemeToggle } from "@/components/ui/theme-toggle";

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
    <header className="ds-glass relative z-30 flex h-16 items-center justify-between border-x-0 border-t-0 px-6">
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
            aria-label="Search invoices, customers and receipts"
            className="input-premium w-72 pl-9 pr-4"
          />

          {showSearchDropdown && (
            <div className="ds-menu-enter ds-surface-elevated absolute left-0 top-full z-50 mt-1 w-96 overflow-hidden py-1">
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
                          className="ds-press flex w-full items-start gap-2.5 px-3 py-2 text-left hover:bg-table-hover"
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
            aria-haspopup="menu"
            aria-expanded={showCompanyMenu}
            className="ds-press flex items-center gap-2 rounded-lg border border-line-strong bg-surface px-3 py-2 text-sm text-slate-700 hover:border-accent/50 hover:bg-nav-hover"
          >
            <Building2 className="h-4 w-4 text-brand-500" />
            <span className="max-w-[160px] truncate font-medium">{companyName}</span>
            <ChevronDown className={cn("h-3.5 w-3.5 transition-transform", showCompanyMenu && "rotate-180")} />
          </button>

          {showCompanyMenu && (
            <div className="ds-menu-enter ds-surface-elevated absolute right-0 top-full z-50 mt-1 w-64 py-1">
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
                      "ds-press flex w-full items-center gap-2 px-3 py-2 text-sm",
                      c.id === companyId
                        ? "bg-accent-muted text-brand-700"
                        : "text-slate-700 hover:bg-table-hover"
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

        {/* Appearance — available to every authenticated user, independent of AR role */}
        <ThemeToggle className="hidden sm:flex" />

        {/* Notifications — self-contained Gate B dropdown (shared data contract) */}
        <NotificationDropdown />

        {/* User Menu */}
        <div className="relative" ref={userMenuRef}>
          <button
            onClick={() => setShowUserMenu(!showUserMenu)}
            aria-haspopup="menu"
            aria-expanded={showUserMenu}
            aria-label="Account menu"
            className="ds-press flex items-center gap-2 rounded-lg px-2 py-1.5 hover:bg-nav-hover"
          >
            <div className="ds-glow-subtle flex h-8 w-8 items-center justify-center rounded-full bg-gradient-to-br from-brand-500 to-brand-700 text-xs font-bold text-white">
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
            <div className="ds-menu-enter ds-surface-elevated absolute right-0 top-full z-50 mt-1 w-56 py-1">
              <div className="border-b border-line px-3 py-2">
                <p className="truncate text-xs font-medium text-slate-700">{user?.email ?? "Signed in"}</p>
                <p className="text-[10px] text-slate-400">{displayRole}</p>
              </div>
              {/* Same control, reachable on viewports where the header rail
                  collapses the segmented toggle. */}
              <div className="border-b border-line sm:hidden">
                <ThemeToggle variant="menu" />
              </div>
              <button
                onClick={() => {
                  setShowUserMenu(false);
                  router.push("/profile");
                }}
                className="ds-press flex w-full items-center gap-2 px-3 py-2 text-sm text-slate-700 hover:bg-table-hover"
              >
                <User className="h-3.5 w-3.5" />
                My Profile
              </button>
              <button
                onClick={signOut}
                className="ds-press flex w-full items-center gap-2 px-3 py-2 text-sm text-red-600 hover:bg-table-hover"
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
