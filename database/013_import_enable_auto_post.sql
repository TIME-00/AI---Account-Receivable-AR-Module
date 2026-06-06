-- ============================================================================
-- 013_import_enable_auto_post.sql
-- Sprint F4 Phase E: Enable auto_post for receipt import allocation
--
-- Allows explicit auto_post only for receipt import batches.
-- Invoice imports remain blocked from auto-posting, and auto_allocate remains
-- disabled for all import types.
-- ============================================================================

ALTER TABLE public.import_batches
  DROP CONSTRAINT IF EXISTS chk_import_batches_phase_a_no_auto;

ALTER TABLE public.import_batches
  DROP CONSTRAINT IF EXISTS chk_import_batches_phase_e_auto_controls;

ALTER TABLE public.import_batches
  ADD CONSTRAINT chk_import_batches_phase_e_auto_controls CHECK (
    auto_allocate = FALSE
    AND (auto_post = FALSE OR import_type = 'receipt')
  );

COMMENT ON CONSTRAINT chk_import_batches_phase_e_auto_controls ON public.import_batches IS
  'Phase E: auto_post is allowed only for receipt imports. Invoice imports remain blocked from auto_post. auto_allocate remains disabled until a future phase.';
