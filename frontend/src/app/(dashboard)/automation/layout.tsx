"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";
import { useUserRole } from "@/hooks/use-user-role";
import {
  AutomationLoading,
  AutomationPermissionDenied,
} from "@/components/features/automation/states";
import {
  canAccessAutomationArea,
  canAccessAutomationPath,
  visibleAutomationTabs,
} from "@/lib/automation/navigation";

export default function AutomationLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const { roles, isResolved, isLoading } = useUserRole();

  const tabs = visibleAutomationTabs(roles);
  const areaAllowed = canAccessAutomationArea(roles);
  // Direct-URL access to a tab this role cannot use fails closed with the same
  // permission-denied surface — never a predictable 403 from the data call.
  const pathAllowed = canAccessAutomationPath(roles, pathname);

  return (
    <div className="mx-auto w-full max-w-6xl space-y-6 p-4 sm:p-6">
      <header className="space-y-1">
        <h1 className="text-xl font-bold tracking-tight text-slate-900">
          Autonomous AR Operations
        </h1>
        <p className="text-sm text-slate-500">
          Monitor mailbox automation, document decisions, exceptions, reminders,
          and settings. The backend is the authority for every financial action.
        </p>
      </header>

      {isLoading && !isResolved ? (
        <AutomationLoading label="Checking access" />
      ) : !areaAllowed || !pathAllowed ? (
        <AutomationPermissionDenied
          message={
            !areaAllowed
              ? "The Automation area is not available for your role. Operational monitoring (Overview, Runs, Documents, Commands, Exceptions) is available to AR Supervisor, Finance Manager, and Auditor; System Admin and AR Clerk have limited configuration and directory access only."
              : "This Automation section is not available for your role. System Admin access is configuration-only (Settings, Mailboxes, Sales Representatives); AR Clerk access is limited to Settings, Sales Representatives, and customer ownership; operational monitoring is for AR Supervisor, Finance Manager, and Auditor."
          }
        />
      ) : (
        <>
          <nav
            aria-label="Automation sections"
            className="flex flex-wrap gap-1 overflow-x-auto rounded-xl border border-slate-200 bg-white p-1"
          >
            {tabs.map((tab) => {
              const active = tab.exact
                ? pathname === tab.href
                : pathname === tab.href || pathname.startsWith(`${tab.href}/`);
              return (
                <Link
                  key={tab.href}
                  href={tab.href}
                  aria-current={active ? "page" : undefined}
                  className={cn(
                    "rounded-lg px-3 py-1.5 text-sm font-medium transition-colors",
                    active
                      ? "bg-brand-50 text-brand-700"
                      : "text-slate-600 hover:bg-slate-50 hover:text-slate-900",
                  )}
                >
                  {tab.label}
                </Link>
              );
            })}
          </nav>
          {children}
        </>
      )}
    </div>
  );
}
