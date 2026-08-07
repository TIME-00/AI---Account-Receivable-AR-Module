// ============================================================================
// Gate E — role-aware Automation navigation policy.
//
// The visible tabs and direct-URL access rules mirror the frozen gate-e.1
// role matrix EXACTLY (docs/contracts/GATE_E_AUTOMATION_API_CONTRACT.md). This
// is a UX gate only — the backend remains the final authority — but it ensures
// System Admin is configuration-only (no operational tabs) and read-only/other
// roles never see a tab they cannot use or hit a predictable 403.
// ============================================================================

export interface AutomationTab {
  href: string;
  label: string;
  exact?: boolean;
  /** Roles permitted to open this tab (per the frozen GET role matrix). */
  roles: readonly string[];
  /** Grouping for the nav — operational monitoring vs. configuration. */
  group: "operational" | "configuration";
}

const OPERATIONAL_READ = ["AR Supervisor", "Finance Manager", "Auditor"] as const;
const SETTINGS_READ = [
  "AR Clerk",
  "AR Supervisor",
  "Finance Manager",
  "Auditor",
  "System Admin",
] as const;
const DIRECTORY_READ = SETTINGS_READ;
const MAILBOX_READ = ["Finance Manager", "Auditor", "System Admin"] as const;

/** Every Automation tab with its exact permitted roles. */
export const AUTOMATION_TABS: readonly AutomationTab[] = [
  { href: "/automation", label: "Overview", exact: true, roles: OPERATIONAL_READ, group: "operational" },
  { href: "/automation/runs", label: "Runs", roles: OPERATIONAL_READ, group: "operational" },
  { href: "/automation/documents", label: "Documents", roles: OPERATIONAL_READ, group: "operational" },
  { href: "/automation/commands", label: "Commands", roles: OPERATIONAL_READ, group: "operational" },
  { href: "/automation/exceptions", label: "Exceptions", roles: OPERATIONAL_READ, group: "operational" },
  { href: "/automation/mailboxes", label: "Mailboxes", roles: MAILBOX_READ, group: "configuration" },
  { href: "/automation/sales-representatives", label: "Sales Representatives", roles: DIRECTORY_READ, group: "configuration" },
  { href: "/automation/settings", label: "Settings", roles: SETTINGS_READ, group: "configuration" },
];

function hasAnyRole(userRoles: readonly string[], allowed: readonly string[]) {
  return userRoles.some((role) => allowed.includes(role));
}

/**
 * Read-capability → permitted roles, mirroring the frozen GET route matrix
 * EXACTLY (docs/contracts/GATE_E_AUTOMATION_API_CONTRACT.md "Frozen routes").
 * Detail-page hooks consult this so an unauthorized role never fires a
 * predictable 401/403 request. The backend remains the final authority.
 *
 * Note: `customerAssignment` includes AR Clerk (customer-scoped read) but
 * EXCLUDES System Admin; `audit`/`reminders` are operational-read only and
 * exclude BOTH System Admin and AR Clerk.
 */
export const GATE_E_READ_ROLES = {
  overview: OPERATIONAL_READ,
  runs: OPERATIONAL_READ,
  documents: OPERATIONAL_READ,
  commands: OPERATIONAL_READ,
  exceptions: OPERATIONAL_READ,
  reminders: OPERATIONAL_READ,
  reminderAttempts: OPERATIONAL_READ,
  audit: OPERATIONAL_READ,
  settings: SETTINGS_READ,
  salesRepresentatives: DIRECTORY_READ,
  mailboxes: MAILBOX_READ,
  customerAssignment: ["AR Clerk", "AR Supervisor", "Finance Manager", "Auditor"],
} as const satisfies Record<string, readonly string[]>;

export type GateEReadCapability = keyof typeof GATE_E_READ_ROLES;

/** Whether the given roles may issue the read for `capability`. */
export function hasAutomationReadCapability(
  userRoles: readonly string[],
  capability: GateEReadCapability,
): boolean {
  return hasAnyRole(userRoles, GATE_E_READ_ROLES[capability]);
}

/** Tabs the given roles may see, in nav order. */
export function visibleAutomationTabs(userRoles: readonly string[]): AutomationTab[] {
  return AUTOMATION_TABS.filter((tab) => hasAnyRole(userRoles, tab.roles));
}

/** The tab whose href matches a pathname (longest, most-specific match wins). */
export function matchAutomationTab(pathname: string): AutomationTab | undefined {
  const matches = AUTOMATION_TABS.filter((tab) =>
    tab.exact ? pathname === tab.href : pathname === tab.href || pathname.startsWith(`${tab.href}/`)
  );
  // Prefer the most specific (longest href) so "/automation" doesn't shadow
  // "/automation/runs".
  return matches.sort((a, b) => b.href.length - a.href.length)[0];
}

/** Whether the given roles may open the page at `pathname`. */
export function canAccessAutomationPath(
  userRoles: readonly string[],
  pathname: string,
): boolean {
  const tab = matchAutomationTab(pathname);
  if (!tab) return userRoles.length > 0; // unknown sub-path: any authenticated automation user
  return hasAnyRole(userRoles, tab.roles);
}

/** Whether the given roles may see the Automation area at all. */
export function canAccessAutomationArea(userRoles: readonly string[]): boolean {
  return visibleAutomationTabs(userRoles).length > 0;
}
