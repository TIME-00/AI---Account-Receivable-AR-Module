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

const navItems = [
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
      { href: "/journal-entries", label: "Journal Entries", icon: BookOpen },
    ],
  },
  {
    section: "System",
    items: [
      { href: "/settings",           label: "Settings",     icon: Settings },
      { href: "/settings/roles",     label: "Roles",        icon: ShieldCheck },
      { href: "/settings/audit-log", label: "Audit Trail",  icon: Shield },
    ],
  },
];

interface SidebarProps {
  onToggleHelp?: () => void;
}

export function Sidebar({ onToggleHelp }: SidebarProps) {
  const [collapsed, setCollapsed] = useState(false);
  const pathname = usePathname();

  return (
    <aside
      className={cn(
        "relative flex h-screen flex-col border-r border-sidebar-border bg-sidebar-bg transition-all duration-300",
        collapsed ? "w-[68px]" : "w-[240px]"
      )}
    >
      {/* Logo / Brand */}
      <div className="flex h-16 items-center gap-3 border-b border-sidebar-border px-4">
        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-gradient-to-br from-brand-500 to-brand-700 shadow-lg shadow-brand-900/40">
          <Zap className="h-5 w-5 text-white" />
        </div>
        {!collapsed && (
          <div className="animate-fade-in">
            <p className="text-sm font-bold text-white tracking-tight">TSH Synergy</p>
            <p className="text-[10px] font-medium text-brand-400 uppercase tracking-widest">AR Module</p>
          </div>
        )}
      </div>

      {/* Navigation */}
      <nav className="flex-1 overflow-y-auto px-2 py-4 space-y-5">
        {navItems.map((section) => (
          <div key={section.section}>
            {!collapsed && (
              <p className="mb-2 px-3 text-[10px] font-semibold uppercase tracking-widest text-slate-600">
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
                      className={cn(
                        "group flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-all duration-200",
                        isActive
                          ? "bg-sidebar-active text-sidebar-text-active shadow-sm shadow-black/20"
                          : "text-sidebar-text hover:bg-sidebar-hover hover:text-sidebar-text-active",
                        collapsed && "justify-center px-0"
                      )}
                      title={collapsed ? item.label : undefined}
                    >
                      <item.icon
                        className={cn(
                          "h-[18px] w-[18px] shrink-0 transition-colors",
                          isActive
                            ? "text-brand-400"
                            : "text-slate-500 group-hover:text-slate-300"
                        )}
                      />
                      {!collapsed && <span>{item.label}</span>}
                      {isActive && !collapsed && (
                        <div className="ml-auto h-1.5 w-1.5 rounded-full bg-brand-400" />
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
              "flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-all duration-200",
              "bg-sidebar-hover/40 text-slate-300",
              "hover:bg-sidebar-hover hover:text-sidebar-text-active",
              "border border-sidebar-border",
              collapsed && "justify-center px-0"
            )}
            title={collapsed ? "AR Help" : undefined}
          >
            <LifeBuoy className="h-[18px] w-[18px] shrink-0" />
            {!collapsed && <span>AR Help</span>}
          </button>
        </div>
      )}

      {/* Collapse Toggle */}
      <div className="border-t border-sidebar-border p-2">
        <button
          onClick={() => setCollapsed(!collapsed)}
          className="flex w-full items-center justify-center rounded-lg p-2 text-slate-500 transition-colors hover:bg-sidebar-hover hover:text-slate-300"
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
