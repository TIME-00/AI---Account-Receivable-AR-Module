import { SupabaseClient } from 'supabase';
import { NotFoundError } from './errors.ts';

export async function getVisibleCustomerIds(
  client: SupabaseClient,
  companyId: string,
): Promise<string[]> {
  const { data, error } = await client
    .from('customers')
    .select('id')
    .eq('company_id', companyId)
    .eq('is_deleted', false)
    .eq('is_hidden', false);

  if (error) throw new Error(`Failed to fetch visible customers: ${error.message}`);
  return (data ?? []).map((customer) => customer.id as string);
}

export async function assertCustomerVisible(
  client: SupabaseClient,
  companyId: string,
  customerId: string,
): Promise<void> {
  const { data, error } = await client
    .from('customers')
    .select('id')
    .eq('id', customerId)
    .eq('company_id', companyId)
    .eq('is_deleted', false)
    .eq('is_hidden', false)
    .maybeSingle();

  if (error) throw new Error(`Failed to check customer visibility: ${error.message}`);
  if (!data) throw new NotFoundError('Customer', customerId);
}
