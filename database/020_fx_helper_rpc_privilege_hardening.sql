-- Batch 9D-A Fix3: explicit anonymous RPC privilege revocation
--
-- Staging runtime verification showed that revoking EXECUTE from PUBLIC and
-- authenticated was not sufficient for the final privileged FX helper RPCs:
-- the anon role retained direct EXECUTE. This forward migration explicitly
-- revokes anon EXECUTE on the exact final helper signatures and preserves
-- service_role-only backend execution.
--
-- Scope: privilege hardening only. No function bodies, lease/concurrency
-- semantics, RLS policies, reference-rate data, exchange_rates rows, or
-- financial tables are modified.

-- Atomic acquire/start helper.
REVOKE EXECUTE ON FUNCTION public.fx_acquire_sync_lease(
  UUID, TEXT, TEXT, DATE, INTEGER, UUID, INTEGER
) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.fx_acquire_sync_lease(
  UUID, TEXT, TEXT, DATE, INTEGER, UUID, INTEGER
) FROM anon;
REVOKE EXECUTE ON FUNCTION public.fx_acquire_sync_lease(
  UUID, TEXT, TEXT, DATE, INTEGER, UUID, INTEGER
) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.fx_acquire_sync_lease(
  UUID, TEXT, TEXT, DATE, INTEGER, UUID, INTEGER
) TO service_role;

-- Owner-checked renewal helper.
REVOKE EXECUTE ON FUNCTION public.fx_renew_sync_lease(
  UUID, TEXT, UUID, UUID, INTEGER
) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.fx_renew_sync_lease(
  UUID, TEXT, UUID, UUID, INTEGER
) FROM anon;
REVOKE EXECUTE ON FUNCTION public.fx_renew_sync_lease(
  UUID, TEXT, UUID, UUID, INTEGER
) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.fx_renew_sync_lease(
  UUID, TEXT, UUID, UUID, INTEGER
) TO service_role;

-- Owner-checked terminal completion/release helper.
REVOKE EXECUTE ON FUNCTION public.fx_complete_sync_run(
  UUID, TEXT, UUID, UUID, TEXT, INTEGER, INTEGER, TEXT, TEXT
) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.fx_complete_sync_run(
  UUID, TEXT, UUID, UUID, TEXT, INTEGER, INTEGER, TEXT, TEXT
) FROM anon;
REVOKE EXECUTE ON FUNCTION public.fx_complete_sync_run(
  UUID, TEXT, UUID, UUID, TEXT, INTEGER, INTEGER, TEXT, TEXT
) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.fx_complete_sync_run(
  UUID, TEXT, UUID, UUID, TEXT, INTEGER, INTEGER, TEXT, TEXT
) TO service_role;

-- Final 11-argument, transactionally lease-fenced reference-rate upsert helper.
REVOKE EXECUTE ON FUNCTION public.fx_upsert_reference_rate(
  UUID, CHAR(3), CHAR(3), NUMERIC, DATE, TEXT, TEXT, TIMESTAMPTZ, TIMESTAMPTZ, UUID, UUID
) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.fx_upsert_reference_rate(
  UUID, CHAR(3), CHAR(3), NUMERIC, DATE, TEXT, TEXT, TIMESTAMPTZ, TIMESTAMPTZ, UUID, UUID
) FROM anon;
REVOKE EXECUTE ON FUNCTION public.fx_upsert_reference_rate(
  UUID, CHAR(3), CHAR(3), NUMERIC, DATE, TEXT, TEXT, TIMESTAMPTZ, TIMESTAMPTZ, UUID, UUID
) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.fx_upsert_reference_rate(
  UUID, CHAR(3), CHAR(3), NUMERIC, DATE, TEXT, TEXT, TIMESTAMPTZ, TIMESTAMPTZ, UUID, UUID
) TO service_role;
