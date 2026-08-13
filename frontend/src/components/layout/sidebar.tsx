"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";
import {
  LayoutDashboard,
  Users,
  FileText,
  Receipt,
  ArrowLeftRight,
  BarChart3,
  BookOpen,
  CreditCard,
  Workflow,
  ChevronLeft,
  ChevronRight,
  LifeBuoy,
  Settings,
  Zap,
  ShieldCheck,
  Shield,
} from "lucide-react";
import { useUserRole } from "@/hooks/use-user-role";
import {
  AUDIT_VIEWER_ROLES,
  JOURNAL_VIEWER_ROLES,
} from "@/lib/journal-audit/contract";

/**
 * Navigation items. `visibleTo` is an optional UX gate: a role that cannot use
 * a destination does not see it, so nobody navigates into a predictable
 * permission-denied page. It is presentation only — the Edge Function and the
 * database role checks remain the security authority, and a direct URL visit
 * still fails closed on its own page.
 */
const navItems: Array<{
  section: string;
  items: Array<{
    href: string;
    label: string;
    icon: typeof LayoutDashboard;
    visibleTo?: readonly string[];
  }>;
}> = [
  {
    section: "Main Menu",
    items: [
      { href: "/",             label: "Dashboard",    icon: LayoutDashboard },
      { href: "/customers",    label: "Customers",    icon: Users },
      { href: "/invoices",     label: "Invoices",     icon: FileText },
      { href: "/credit-notes", label: "Credit Notes", icon: CreditCard },
      { href: "/receipts",     label: "Receipts",     icon: Receipt },
      { href: "/allocations",  label: "Allocation Wizard", icon: ArrowLeftRight },
      { href: "/automation",   label: "Automation",   icon: Workflow },
    ],
  },
  {
    section: "Reports & Analytics",
    items: [
      { href: "/reports",         label: "Report Center",  icon: BarChart3 },
      {
        href: "/journal-entries",
        label: "Journal Entries",
        icon: BookOpen,
        visibleTo: JOURNAL_VIEWER_ROLES,
      },
    ],
  },
  {
    section: "System",
    items: [
      { href: "/settings",           label: "Settings",     icon: Settings },
      { href: "/settings/roles",     label: "Roles",        icon: ShieldCheck },
      {
        href: "/settings/audit-log",
        label: "Audit Trail",
        icon: Shield,
        visibleTo: AUDIT_VIEWER_ROLES,
      },
    ],
  },
];

interface SidebarProps {
  onToggleHelp?: () => void;
}

export function Sidebar({ onToggleHelp }: SidebarProps) {
  const [collapsed, setCollapsed] = useState(false);
  const pathname = usePathname();
  const { roles } = useUserRole();

  // Until the authenticated context resolves, `roles` is empty and a gated item
  // stays hidden — the conservative direction for a permission gate.
  const visibleSections = navItems
    .map((section) => ({
      ...section,
      items: section.items.filter(
        (item) => !item.visibleTo || item.visibleTo.some((role) => roles.includes(role as never)),
      ),
    }))
    .filter((section) => section.items.length > 0);

  return (
    <aside
      className={cn(
        "relative flex h-screen flex-col border-r border-nav-border bg-nav-bg",
        "transition-[width] duration-slow ease-emphasized",
        collapsed ? "w-[68px]" : "w-[240px]"
      )}
    >
      {/* Logo / Brand */}
      <div className="flex h-16 items-center gap-3 border-b border-nav-border px-4">
        <div className="ds-glow-subtle flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-gradient-to-br from-brand-500 to-brand-700">
          <Zap className="h-5 w-5 text-white" />
        </div>
        {!collapsed && (
          <div className="animate-fade-in">
            <p className="text-sm font-bold tracking-tight text-nav-text-active">TSH Synergy</p>
            <p className="text-[10px] font-medium text-brand-500 uppercase tracking-widest">AR Module</p>
          </div>
        )}
      </div>

      {/* Navigation */}
      <nav className="flex-1 overflow-y-auto px-2 py-4 space-y-5">
        {visibleSections.map((section) => (
          <div key={section.section}>
            {!collapsed && (
              <p className="mb-2 px-3 text-[10px] font-semibold uppercase tracking-widest text-nav-text/70">
                {section.section}
              </p>
            )}
            <ul className="space-y-0.5">
              {section.items.map((item) => {
                const isActive =
                  pathname === item.href ||
                  (item.href !== "/" && pathname.startsWith(item.href));

                return (
                  <li key={item.href}>
                    <Link
                      href={item.href}
                      // `ds-brand-edge` grows a luminous rule on the leading
                      // edge of the active item; `data-active` drives it so the
                      // indicator animates in rather than snapping.
                      data-active={isActive ? "true" : "false"}
                      aria-current={isActive ? "page" : undefined}
                      className={cn(
                        "ds-brand-edge ds-press group flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium",
                        isActive
                          ? "bg-nav-active text-nav-text-active"
                          : "text-nav-text hover:bg-nav-hover hover:text-nav-text-active",
                        collapsed && "justify-center px-0"
                      )}
                      title={collapsed ? item.label : undefined}
                    >
                      <item.icon
                        className={cn(
                          "h-[18px] w-[18px] shrink-0 transition-transform duration-normal ease-emphasized",
                          "group-hover:scale-110",
                          isActive
                            ? "text-brand-500"
                            : "text-nav-text group-hover:text-nav-text-active"
                        )}
                      />
                      {!collapsed && <span>{item.label}</span>}
                      {isActive && !collapsed && (
                        <div className="ds-glow-subtle ml-auto h-1.5 w-1.5 rounded-full bg-brand-500" />
                      )}
                    </Link>
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
      </nav>

      {/* AR Help / Workflow Guide Button (local help — no external AI) */}
      {onToggleHelp && (
        <div className="px-2 pb-2">
          <button
            onClick={onToggleHelp}
            className={cn(
              "ds-press group flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium",
              "bg-nav-hover/50 text-nav-text",
              "hover:bg-nav-hover hover:text-nav-text-active",
              "border border-nav-border",
              collapsed && "justify-center px-0"
            )}
            title={collapsed ? "AR Help" : undefined}
          >
            <LifeBuoy className="h-[18px] w-[18px] shrink-0 transition-transform duration-normal ease-emphasized group-hover:scale-110" />
            {!collapsed && <span>AR Help</span>}
          </button>
        </div>
      )}

      {/* Collapse Toggle */}
      <div className="border-t border-nav-border p-2">
        <button
          onClick={() => setCollapsed(!collapsed)}
          aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
          aria-expanded={!collapsed}
          className="ds-press flex w-full items-center justify-center rounded-lg p-2 text-nav-text hover:bg-nav-hover hover:text-nav-text-active"
        >
          {collapsed ? (
            <ChevronRight className="h-4 w-4" />
          ) : (
            <ChevronLeft className="h-4 w-4" />
          )}
        </button>
      </div>
    </aside>
  );
}
