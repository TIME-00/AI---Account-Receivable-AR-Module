-- Post-Gate-E account-level UI preference authority.
-- Theme is presentation-only and cannot affect company or financial settings.

BEGIN;

CREATE TABLE public.user_ui_preferences (
  user_id UUID PRIMARY KEY,
  theme_preference TEXT NOT NULL DEFAULT 'dark',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT chk_user_ui_preferences_theme
    CHECK (theme_preference IN ('dark', 'light'))
);

COMMENT ON TABLE public.user_ui_preferences IS
  'Tenant-independent, account-level presentation preferences. Financial and role authority must never depend on this table.';
COMMENT ON COLUMN public.user_ui_preferences.user_id IS
  'Validated Supabase Auth user identity. Deliberately not company-scoped so an explicit preference follows the account across company contexts.';
COMMENT ON COLUMN public.user_ui_preferences.theme_preference IS
  'Explicit user selection: dark or light. Absence of a row resolves to dark in the authenticated API.';

CREATE TRIGGER trg_user_ui_preferences_updated_at
  BEFORE UPDATE ON public.user_ui_preferences
  FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();

ALTER TABLE public.user_ui_preferences ENABLE ROW LEVEL SECURITY;

CREATE POLICY user_ui_preferences_self_select
  ON public.user_ui_preferences FOR SELECT
  TO authenticated
  USING ((SELECT auth.uid()) = user_id);

CREATE POLICY user_ui_preferences_self_insert
  ON public.user_ui_preferences FOR INSERT
  TO authenticated
  WITH CHECK ((SELECT auth.uid()) = user_id);

CREATE POLICY user_ui_preferences_self_update
  ON public.user_ui_preferences FOR UPDATE
  TO authenticated
  USING ((SELECT auth.uid()) = user_id)
  WITH CHECK ((SELECT auth.uid()) = user_id);

-- The browser uses the authenticated auth Edge Function. Direct Data API table
-- access remains closed even though owner-scoped RLS is retained as defense in depth.
REVOKE ALL ON TABLE public.user_ui_preferences FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.user_ui_preferences FROM service_role;
GRANT SELECT, INSERT, UPDATE ON TABLE public.user_ui_preferences TO service_role;

COMMIT;
