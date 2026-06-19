// ============================================================================
// TSH Synergy ERP — Accounts Receivable Module
// Authentication & Authorization Middleware
// Implements PRD Part 5 §5.1-5.2 Permission Matrix
// ============================================================================

import { getAdminClient, getUserClient } from './db.ts';
import { AuthenticationError, AuthorizationError, NotFoundError } from './errors.ts';
import { ROLE_HIERARCHY } from './constants.ts';
import type { UserRole } from './types.ts';

// ─── Types ──────────────────────────────────────────────────────────────────

export interface AuthContext {
  userId: string;
  companyId: string;
  roles: UserRole[];
  highestRole: UserRole;
  email: string | null;
}

// ─── JWT Token Extraction ───────────────────────────────────────────────────

/**
 * Extract and validate the user's identity from the request.
 * Returns user ID and email from the JWT token.
 */
export async function extractUser(req: Request): Promise<{ userId: string; email: string | null }> {
  const authHeader = req.headers.get('Authorization');
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    throw new AuthenticationError('Missing or invalid Authorization header. Expected: Bearer <token>');
  }

  const token = authHeader.replace('Bearer ', '');

  // Use Supabase to validate the JWT and extract user info
  const userClient = getUserClient(authHeader);
  const { data: { user }, error } = await userClient.auth.getUser(token);

  if (error || !user) {
    throw new AuthenticationError('Invalid or expired authentication token');
  }

  return {
    userId: user.id,
    email: user.email ?? null,
  };
}

// ─── Full Auth Context Builder ──────────────────────────────────────────────

/**
 * Build full authorization context: extract user, load their roles, determine permissions.
 * 
 * @param req - The incoming HTTP request
 * @param companyId - The company context (from URL param or header)
 */
export async function getAuthContext(req: Request, companyId: string): Promise<AuthContext> {
  const { userId, email } = await extractUser(req);
  const adminClient = getAdminClient();

  // Fetch user's active roles for this company
  const { data: roleRecords, error } = await adminClient
    .from('user_roles')
    .select('role')
    .eq('user_id', userId)
    .eq('company_id', companyId)
    .eq('is_active', true);

  if (error) {
    throw new Error(`Failed to fetch user roles: ${error.message}`);
  }

  const roles = (roleRecords ?? []).map((r: { role: string }) => r.role as UserRole);

  if (roles.length === 0) {
    throw new AuthorizationError(
      `User has no assigned roles in company ${companyId}. Please contact your administrator.`,
    );
  }

  // Determine highest role (lowest hierarchy number = highest authority)
  const highestRole = roles.reduce((highest, current) => {
    const currentLevel = ROLE_HIERARCHY[current] ?? 99;
    const highestLevel = ROLE_HIERARCHY[highest] ?? 99;
    return currentLevel < highestLevel ? current : highest;
  });

  return { userId, companyId, roles, highestRole, email };
}

// ─── Permission Check Functions ─────────────────────────────────────────────

/**
 * Check if the user has AT LEAST the required role level.
 * Role hierarchy: Finance Manager > AR Supervisor > AR Clerk > System Admin > Auditor
 * 
 * For operational roles (FM > Supervisor > Clerk), higher means more permissions.
 * System Admin has separate scope (config-only).
 * Auditor is read-only.
 */
export function requireRole(auth: AuthContext, requiredRole: UserRole): void {
  const requiredLevel = ROLE_HIERARCHY[requiredRole];
  const userLevel = ROLE_HIERARCHY[auth.highestRole];

  // Special case: System Admin only has config permissions, not operational
  if (auth.highestRole === 'System Admin' && requiredRole !== 'System Admin') {
    throw new AuthorizationError(
      `This action requires ${requiredRole} or higher. System Admin can only manage system configuration.`,
      { required_role: requiredRole, user_role: auth.highestRole },
    );
  }

  // Special case: Auditor is read-only
  if (auth.highestRole === 'Auditor') {
    throw new AuthorizationError(
      `This action requires ${requiredRole} or higher. Auditor role is read-only.`,
      { required_role: requiredRole, user_role: auth.highestRole },
    );
  }

  // Check operational role hierarchy
  if (userLevel > requiredLevel) {
    throw new AuthorizationError(
      `This action requires ${requiredRole} or higher. Your current role: ${auth.highestRole}`,
      { required_role: requiredRole, user_role: auth.highestRole },
    );
  }
}

/**
 * Check if the user has any of the specified roles.
 */
export function requireAnyRole(auth: AuthContext, roles: UserRole[]): void {
  const hasRole = auth.roles.some(r => roles.includes(r));
  if (!hasRole) {
    throw new AuthorizationError(
      `This action requires one of the following roles: ${roles.join(', ')}. Your current roles: ${auth.roles.join(', ')}`,
      { required_roles: roles, user_roles: auth.roles },
    );
  }
}

/**
 * Check if the user is an operational role (can perform business transactions).
 * Excludes System Admin (config-only) and Auditor (read-only).
 */
export function requireOperationalRole(auth: AuthContext): void {
  const operationalRoles: UserRole[] = ['AR Clerk', 'AR Supervisor', 'Finance Manager'];
  requireAnyRole(auth, operationalRoles);
}

/**
 * Check if the user may read operational AR data.
 * System Admin is configuration-only and is intentionally excluded.
 */
export function requireOperationalReadRole(auth: AuthContext): void {
  const operationalReadRoles: UserRole[] = [
    'AR Clerk',
    'AR Supervisor',
    'Finance Manager',
    'Auditor',
  ];
  requireAnyRole(auth, operationalReadRoles);
}

/**
 * Check if the user can access a specific customer's data.
 * AR Clerk: only assigned customers.
 * AR Supervisor+: all customers.
 * Auditor: all customers (read-only).
 * 
 * PRD Part 5 §5.2
 */
export async function requireCustomerAccess(
  auth: AuthContext,
  customerInternalId: string,  // UUID — customers.id
): Promise<void> {
  requireOperationalReadRole(auth);

  const adminClient = getAdminClient();
  const { data: visibleCustomer, error: visibilityError } = await adminClient
    .from('customers')
    .select('id')
    .eq('id', customerInternalId)
    .eq('company_id', auth.companyId)
    .eq('is_deleted', false)
    .eq('is_hidden', false)
    .maybeSingle();

  if (visibilityError) {
    throw new Error(`Failed to verify customer visibility: ${visibilityError.message}`);
  }
  if (!visibleCustomer) {
    throw new NotFoundError('Customer', customerInternalId);
  }

  // AR Supervisor, Finance Manager, and Auditor can see all operational customers.
  const fullAccessRoles: UserRole[] = ['AR Supervisor', 'Finance Manager', 'Auditor'];
  if (auth.roles.some(r => fullAccessRoles.includes(r))) {
    return; // Full access
  }

  // AR Clerk — check customer assignment
  const { data, error } = await adminClient
    .from('user_customer_assignments')
    .select('id')
    .eq('user_id', auth.userId)
    .eq('customer_id', customerInternalId)
    .eq('company_id', auth.companyId)
    .eq('is_active', true)
    .limit(1);

  if (error || !data || data.length === 0) {
    throw new AuthorizationError(
      'You do not have access to this customer. AR Clerk can only access assigned customers.',
      { customer_id: customerInternalId },
    );
  }
}

/**
 * Build a customer access filter for list queries.
 * Returns customer IDs the user can access, or null for unrestricted.
 */
export async function getCustomerAccessFilter(
  auth: AuthContext,
): Promise<string[] | null> {
  requireOperationalReadRole(auth);

  const fullAccessRoles: UserRole[] = ['AR Supervisor', 'Finance Manager', 'Auditor'];
  if (auth.roles.some(r => fullAccessRoles.includes(r))) {
    return null; // No filter needed — full access
  }

  // AR Clerk — fetch assigned customer IDs
  const adminClient = getAdminClient();
  const { data, error } = await adminClient
    .from('user_customer_assignments')
    .select('customer_id')
    .eq('user_id', auth.userId)
    .eq('company_id', auth.companyId)
    .eq('is_active', true);

  if (error) {
    throw new Error(`Failed to fetch customer assignments: ${error.message}`);
  }

  const assignedIds = (data ?? []).map((r: { customer_id: string }) => r.customer_id);
  if (assignedIds.length === 0) return [];

  const { data: visibleCustomers, error: visibilityError } = await adminClient
    .from('customers')
    .select('id')
    .eq('company_id', auth.companyId)
    .eq('is_deleted', false)
    .eq('is_hidden', false)
    .in('id', assignedIds);

  if (visibilityError) {
    throw new Error(`Failed to filter visible customer assignments: ${visibilityError.message}`);
  }

  return (visibleCustomers ?? []).map((customer: { id: string }) => customer.id);
}

// ─── Convenience: Extract company ID from request ───────────────────────────

/**
 * Extract company_id from the request.
 * It can come from:
 * 1. URL path parameter (e.g., /companies/:companyId/customers)
 * 2. X-Company-Id header
 * 3. Query parameter ?company_id=xxx
 *
 * VULN-C01 FIX: ALL sources are validated as UUID to prevent:
 * - Cross-company data leakage via malformed IDs
 * - SQL injection through header manipulation
 * - Path traversal via crafted URL parameters
 */
export function extractCompanyId(req: Request, urlParams?: Record<string, string>): string {
  let companyId: string | null = null;

  // Check URL params first
  if (urlParams?.companyId) {
    companyId = urlParams.companyId;
  }

  // Check header
  if (!companyId) {
    companyId = req.headers.get('X-Company-Id');
  }

  // Check query params
  if (!companyId) {
    const url = new URL(req.url);
    companyId = url.searchParams.get('company_id');
  }

  if (!companyId) {
    throw new ValidationError('Missing company_id. Provide via X-Company-Id header, URL parameter, or query string.');
  }

  // VULN-C01 FIX: Enforce UUID format on ALL sources.
  // This prevents malformed or malicious values from reaching DB queries.
  validateUUID(companyId, 'company_id');

  return companyId;
}

// Re-export for convenience
import { ValidationError } from './errors.ts';
import { validateUUID } from './validators.ts';
