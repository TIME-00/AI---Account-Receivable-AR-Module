-- Batch 9D-B: support locked uppercase real provider identifier MAS
--
-- Batch 9D-A used lowercase deterministic mock provider identifiers only.
-- DG-1 locks the real provider identifier as MAS, matching the official
-- Frankfurter provider key. This forward migration widens the provider
-- identifier checks to accept uppercase letters while preserving bounded,
-- simple provider identifiers.
--
-- This migration does not create scheduler jobs, does not store secrets, does
-- not call any external provider, does not write public.exchange_rates, and
-- does not mutate financial tables.

ALTER TABLE public.fx_sync_runs
  DROP CONSTRAINT IF EXISTS chk_fx_sync_runs_provider_bounded;

ALTER TABLE public.fx_sync_runs
  ADD CONSTRAINT chk_fx_sync_runs_provider_bounded
  CHECK (provider ~ '^[A-Za-z0-9][A-Za-z0-9_-]{1,63}$');

ALTER TABLE public.fx_reference_rates
  DROP CONSTRAINT IF EXISTS chk_fx_reference_rates_provider_bounded;

ALTER TABLE public.fx_reference_rates
  ADD CONSTRAINT chk_fx_reference_rates_provider_bounded
  CHECK (provider ~ '^[A-Za-z0-9][A-Za-z0-9_-]{1,63}$');

ALTER TABLE public.fx_sync_leases
  DROP CONSTRAINT IF EXISTS chk_fx_sync_leases_provider_bounded;

ALTER TABLE public.fx_sync_leases
  ADD CONSTRAINT chk_fx_sync_leases_provider_bounded
  CHECK (provider ~ '^[A-Za-z0-9][A-Za-z0-9_-]{1,63}$');

COMMENT ON CONSTRAINT chk_fx_sync_runs_provider_bounded ON public.fx_sync_runs IS
  'Batch 9D-B provider identifier bound; permits official uppercase provider keys such as MAS.';

COMMENT ON CONSTRAINT chk_fx_reference_rates_provider_bounded ON public.fx_reference_rates IS
  'Batch 9D-B provider identifier bound; permits official uppercase provider keys such as MAS.';

COMMENT ON CONSTRAINT chk_fx_sync_leases_provider_bounded ON public.fx_sync_leases IS
  'Batch 9D-B provider identifier bound; permits official uppercase provider keys such as MAS.';
