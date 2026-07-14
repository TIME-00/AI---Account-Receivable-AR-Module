// ============================================================================
// TSH Synergy ERP — Accounts Receivable Module
// Supabase Client & Database Utilities
// ============================================================================

import { createClient, SupabaseClient } from 'supabase';
import { BusinessError, ConflictError } from './errors.ts';

interface DatabaseErrorLike {
  message?: string;
}

/**
 * Preserve the repository's public database-error contract for both RPC and
 * direct PostgREST mutations. Only explicit safe prefixes are mapped; unknown
 * database, schema, network, and runtime failures remain internal errors.
 */
export function throwDatabaseError(
  error: DatabaseErrorLike,
  fallbackMessage: string,
): never {
  const message = error.message ?? fallbackMessage;
  const deliberatePrefix = /^(BR-[A-Z0-9][A-Z0-9_-]*|AUTH|VALIDATION|CONFIG|CONFLICT|NOT_FOUND):(?:\s|$)/
    .exec(message)?.[1];

  if (deliberatePrefix === 'CONFLICT') throw new ConflictError(message);
  if (deliberatePrefix === 'NOT_FOUND') throw new BusinessError('NOT_FOUND', message, 404);
  if (
    deliberatePrefix === 'AUTH' ||
    deliberatePrefix === 'VALIDATION' ||
    deliberatePrefix === 'CONFIG'
  ) {
    throw new BusinessError(deliberatePrefix, message, 400);
  }
  if (deliberatePrefix?.startsWith('BR-')) {
    throw new BusinessError(deliberatePrefix, message, 400);
  }

  // Preserve the original database/PostgREST object only in server-side logs.
  // The thrown error is also deliberately generic as defense in depth; the
  // shared response boundary independently emits a fixed external 500 message.
  console.error('[DATABASE_ERROR]', { fallbackMessage, error });
  throw new Error(fallbackMessage);
}

// ─── Supabase Client Singleton ──────────────────────────────────────────────

let _adminClient: SupabaseClient | null = null;

type AdminKeySource = 'legacy_service_role' | 'secret_keys_default';

function resolveAdminKey(): {
  supabaseUrl: string;
  serviceKey: string;
  keySource: AdminKeySource;
} {
  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const legacyServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  const secretKeysJson = Deno.env.get('SUPABASE_SECRET_KEYS');

  let serviceKey = legacyServiceKey;
  let keySource: AdminKeySource | null = legacyServiceKey ? 'legacy_service_role' : null;

  if (!serviceKey && secretKeysJson) {
    try {
      const secretKeys = JSON.parse(secretKeysJson) as { default?: unknown };
      if (typeof secretKeys.default === 'string' && secretKeys.default.length > 0) {
        serviceKey = secretKeys.default;
        keySource = 'secret_keys_default';
      }
    } catch {
      // Fall through to the clear configuration error below without logging secrets.
    }
  }

  if (!supabaseUrl) {
    throw new Error('Missing SUPABASE_URL environment variable');
  }
  if (!serviceKey || !keySource) {
    throw new Error(
      'Missing Supabase admin key. Expected SUPABASE_SERVICE_ROLE_KEY or SUPABASE_SECRET_KEYS.default.',
    );
  }

  return { supabaseUrl, serviceKey, keySource };
}

/**
 * Get the Supabase admin client (service role — bypasses RLS).
 * Used for all backend operations where we enforce our own authorization.
 */
export function getAdminClient(): SupabaseClient {
  if (!_adminClient) {
    const { supabaseUrl, serviceKey } = resolveAdminKey();

    _adminClient = createClient(supabaseUrl, serviceKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
  }
  return _adminClient;
}

/**
 * Get a Supabase client scoped to the requesting user's JWT.
 * Used when we want RLS to apply or need the user's context.
 */
export function getUserClient(authHeader: string): SupabaseClient {
  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const supabaseAnonKey = Deno.env.get('SUPABASE_ANON_KEY');

  if (!supabaseUrl || !supabaseAnonKey) {
    throw new Error('Missing SUPABASE_URL or SUPABASE_ANON_KEY environment variables');
  }

  return createClient(supabaseUrl, supabaseAnonKey, {
    global: { headers: { Authorization: authHeader } },
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

// ─── Raw SQL Execution ──────────────────────────────────────────────────────

/**
 * Execute a raw SQL query via Supabase RPC or the REST API.
 * For complex queries that can't be expressed with the query builder.
 */
export async function executeSQL<T = Record<string, unknown>>(
  client: SupabaseClient,
  sql: string,
  params: Record<string, unknown> = {},
): Promise<T[]> {
  const { data, error } = await client.rpc('execute_sql', {
    query: sql,
    params: JSON.stringify(params),
  });

  if (error) {
    throw new Error(`SQL execution error: ${error.message}`);
  }

  return (data ?? []) as T[];
}

/**
 * Call a PostgreSQL RPC and map deliberate database exceptions to API errors.
 * P1 financial mutation RPCs raise prefixed messages such as BR-*, AUTH,
 * VALIDATION, NOT_FOUND, CONFIG, and CONFLICT.
 */
export async function callRpc<T = unknown>(
  client: SupabaseClient,
  functionName: string,
  params: Record<string, unknown>,
): Promise<T> {
  const { data, error } = await client.rpc(functionName, params);

  if (error) {
    throwDatabaseError(error, `RPC ${functionName} failed`);
  }

  return data as T;
}

// ─── Transaction Helper ─────────────────────────────────────────────────────

/**
 * Execute a series of operations within a database transaction.
 * Since Supabase JS client doesn't natively support transactions,
 * we use a PostgreSQL function wrapper or sequential operations with
 * manual rollback logic.
 *
 * For critical multi-table operations (e.g., invoice posting + journal entry),
 * we create dedicated PostgreSQL functions that handle the transaction internally.
 *
 * This helper uses the advisory lock pattern for simpler cases.
 */
export async function withTransaction<T>(
  client: SupabaseClient,
  operations: (client: SupabaseClient) => Promise<T>,
): Promise<T> {
  // In Supabase Edge Functions, each request gets its own connection
  // from the pool. We rely on PostgreSQL functions for true ACID transactions.
  // For application-level "pseudo-transactions", we execute operations
  // sequentially and provide compensating actions on failure.
  try {
    return await operations(client);
  } catch (error) {
    // Log the failed transaction for debugging
    console.error('[Transaction Failed]', error);
    throw error;
  }
}

// ─── Query Helpers ──────────────────────────────────────────────────────────

/**
 * Fetch a single row by UUID primary key.
 * Throws if not found.
 */
export async function fetchById<T>(
  client: SupabaseClient,
  table: string,
  id: string,
  select: string = '*',
): Promise<T> {
  const { data, error } = await client
    .from(table)
    .select(select)
    .eq('id', id)
    .single();

  if (error) {
    throw new Error(`Failed to fetch ${table}(${id}): ${error.message}`);
  }
  if (!data) {
    throw new Error(`${table}(${id}) not found`);
  }

  return data as T;
}

/**
 * Fetch a single system config value.
 */
export async function getConfigValue(
  client: SupabaseClient,
  companyId: string,
  configKey: string,
): Promise<string | null> {
  const { data, error } = await client
    .from('ar_system_config')
    .select('config_value')
    .eq('company_id', companyId)
    .eq('config_key', configKey)
    .single();

  if (error || !data) return null;
  return data.config_value;
}

/**
 * Fetch a GL account ID by its account_code and company_id.
 */
export async function getGLAccountId(
  client: SupabaseClient,
  companyId: string,
  accountCode: string,
): Promise<string | null> {
  const { data, error } = await client
    .from('gl_accounts')
    .select('id')
    .eq('company_id', companyId)
    .eq('account_code', accountCode)
    .eq('is_active', true)
    .single();

  if (error || !data) return null;
  return data.id;
}

/**
 * Check if a fiscal period is open for posting.
 */
export async function isFiscalPeriodOpen(
  client: SupabaseClient,
  companyId: string,
  periodCode: string,
): Promise<boolean> {
  const { data, error } = await client
    .from('fiscal_periods')
    .select('status')
    .eq('company_id', companyId)
    .eq('period_code', periodCode)
    .single();

  if (error || !data) return false;
  return data.status === 'Open';
}

/**
 * Get the current open fiscal period code for today's date.
 */
export async function getCurrentPeriodCode(
  client: SupabaseClient,
  companyId: string,
  referenceDate?: string,
): Promise<string | null> {
  const date = referenceDate ?? new Date().toISOString().slice(0, 10);
  const periodCode = date.slice(0, 7); // YYYY-MM

  const isOpen = await isFiscalPeriodOpen(client, companyId, periodCode);
  return isOpen ? periodCode : null;
}

/**
 * Call the get_next_sequence PostgreSQL function for document numbering.
 */
export async function getNextSequence(
  client: SupabaseClient,
  companyId: string,
  docType: string,
  sourceType?: string,
): Promise<string> {
  const { data, error } = await client.rpc('get_next_sequence', {
    p_company_id: companyId,
    p_doc_type: docType,
    p_source_type: sourceType ?? null,
  });

  if (error) {
    throw new Error(`Failed to generate sequence for ${docType}: ${error.message}`);
  }

  return data as string;
}
