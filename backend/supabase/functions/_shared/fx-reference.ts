import type { SupabaseClient } from 'supabase';
import { BusinessError } from './errors.ts';
import { calculateStaleState } from '../fx-rate-sync/validation.ts';

export interface BookableReferenceRate {
  id: string;
  effectiveDate: string;
  provider: string;
}

/**
 * Resolve the latest active authoritative reference on or before a transaction
 * date. The returned UUID is still revalidated inside PostgreSQL when the
 * document and immutable booking snapshot are created.
 */
export async function resolveBookableReferenceRate(
  client: SupabaseClient,
  companyId: string,
  fromCurrency: string,
  toCurrency: string,
  transactionDate: string,
): Promise<BookableReferenceRate> {
  const { data, error } = await client
    .from('fx_reference_rates')
    .select('id, effective_date, provider')
    .eq('company_id', companyId)
    .eq('from_currency', fromCurrency)
    .eq('to_currency', toCurrency)
    .eq('status', 'Active')
    .lte('effective_date', transactionDate)
    .order('effective_date', { ascending: false })
    .order('fetched_at', { ascending: false })
    .order('created_at', { ascending: false })
    .order('id', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) {
    throw new BusinessError(
      'FX_REFERENCE_UNAVAILABLE',
      'An authoritative transaction-date FX reference could not be verified.',
      409,
      {
        from_currency: fromCurrency,
        to_currency: toCurrency,
        transaction_date: transactionDate,
      },
    );
  }
  if (!data) {
    throw new BusinessError(
      'FX_REFERENCE_UNAVAILABLE',
      'No authoritative FX reference is available on or before the transaction date.',
      409,
      {
        from_currency: fromCurrency,
        to_currency: toCurrency,
        transaction_date: transactionDate,
      },
    );
  }

  const stale = calculateStaleState(
    String(data.effective_date),
    transactionDate,
  );
  if (stale.is_stale) {
    throw new BusinessError(
      'FX_REFERENCE_UNAVAILABLE',
      'The latest authoritative FX reference is outside the permitted business-day window.',
      409,
      {
        from_currency: fromCurrency,
        to_currency: toCurrency,
        transaction_date: transactionDate,
        effective_date: String(data.effective_date),
        age_business_days: stale.age_days,
      },
    );
  }

  return {
    id: String(data.id),
    effectiveDate: String(data.effective_date),
    provider: String(data.provider),
  };
}
