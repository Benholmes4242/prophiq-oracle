-- AA: Auth foundation.
--
-- Adds the public.profiles table (1:1 with auth.users), a trigger to
-- auto-create profile rows on signup, a submitted_by_user_id column on
-- events, and a new RPC get_usage_today_for_user that mirrors the existing
-- fingerprint-based rate-limit RPC.

-- ============================================================
-- 1. profiles table
-- ============================================================
CREATE TABLE profiles (
  id                  uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  email               text,
  is_anonymous        boolean NOT NULL DEFAULT true,
  display_name        text,
  metadata            jsonb NOT NULL DEFAULT '{}'::jsonb,
  email_upgraded_at   timestamptz,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_profiles_email ON profiles(email) WHERE email IS NOT NULL;
CREATE INDEX idx_profiles_is_anonymous ON profiles(is_anonymous);

COMMENT ON TABLE profiles IS 'App-level user profile, 1:1 with auth.users. Mirrors email + is_anonymous for easy querying. Auto-populated by trigger when auth.users gets a new row.';

-- ============================================================
-- 2. Trigger to create profile row on auth.users insert
-- ============================================================
CREATE OR REPLACE FUNCTION public.handle_new_auth_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.profiles (id, email, is_anonymous, created_at, updated_at)
  VALUES (
    NEW.id,
    NEW.email,
    COALESCE(NEW.is_anonymous, false),
    NEW.created_at,
    NEW.created_at
  )
  ON CONFLICT (id) DO NOTHING;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW
  EXECUTE FUNCTION public.handle_new_auth_user();

-- ============================================================
-- 3. Trigger to sync email + is_anonymous on auth.users update
-- ============================================================
CREATE OR REPLACE FUNCTION public.handle_auth_user_update()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE public.profiles
  SET
    email = NEW.email,
    is_anonymous = COALESCE(NEW.is_anonymous, false),
    email_upgraded_at = CASE
      WHEN OLD.email IS NULL AND NEW.email IS NOT NULL
        THEN now()
      ELSE email_upgraded_at
    END,
    updated_at = now()
  WHERE id = NEW.id;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_auth_user_updated ON auth.users;
CREATE TRIGGER on_auth_user_updated
  AFTER UPDATE ON auth.users
  FOR EACH ROW
  WHEN (OLD.email IS DISTINCT FROM NEW.email OR OLD.is_anonymous IS DISTINCT FROM NEW.is_anonymous)
  EXECUTE FUNCTION public.handle_auth_user_update();

-- ============================================================
-- 4. events.submitted_by_user_id column
-- ============================================================
ALTER TABLE events
  ADD COLUMN IF NOT EXISTS submitted_by_user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_events_submitted_by_user_id
  ON events(submitted_by_user_id)
  WHERE submitted_by_user_id IS NOT NULL;

COMMENT ON COLUMN events.submitted_by_user_id IS 'Supabase auth.users.id of the visitor (anonymous or email) who submitted this event. NULL for events from before Brief AA or discovered events. submitted_by_fingerprint is kept alongside as a secondary signal.';

-- ============================================================
-- 5. get_usage_today_for_user RPC (mirrors fingerprint version)
-- ============================================================
CREATE OR REPLACE FUNCTION public.get_usage_today_for_user(p_user_id uuid)
RETURNS TABLE (
  questions_submitted_today integer
)
LANGUAGE plpgsql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
BEGIN
  RETURN QUERY
  SELECT COUNT(*)::int AS questions_submitted_today
  FROM events
  WHERE submitted_by_user_id = p_user_id
    AND submitted_at >= (now() AT TIME ZONE 'utc')::date
    AND submitted_at < (now() AT TIME ZONE 'utc')::date + interval '1 day';
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_usage_today_for_user(uuid) TO authenticated, service_role;

COMMENT ON FUNCTION public.get_usage_today_for_user IS 'Count of events submitted by the given user in the current UTC day. Used by submit-question for rate-limiting against the free-tier daily cap.';

-- ============================================================
-- 6. RLS on profiles
-- ============================================================
ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;

CREATE POLICY "profiles_own_select"
  ON profiles FOR SELECT
  USING (auth.uid() = id);

CREATE POLICY "profiles_own_update"
  ON profiles FOR UPDATE
  USING (auth.uid() = id)
  WITH CHECK (auth.uid() = id);

CREATE POLICY "profiles_service_role_all"
  ON profiles FOR ALL
  USING (auth.role() = 'service_role');

-- ============================================================
-- 7. Additional RLS policy on events for own submissions
-- ============================================================
-- The existing "events_public_read" policy keeps moderation-approved events
-- publicly readable. This additional policy lets a user query their own
-- pending/rejected submissions too. Policies are OR'd so it stacks cleanly.
DROP POLICY IF EXISTS "events_own_submissions_select" ON events;
CREATE POLICY "events_own_submissions_select"
  ON events FOR SELECT
  USING (submitted_by_user_id = auth.uid());

-- ============================================================
-- 8. Grants
-- ============================================================
GRANT SELECT ON profiles TO authenticated;
GRANT UPDATE ON profiles TO authenticated;
GRANT ALL    ON profiles TO service_role;
