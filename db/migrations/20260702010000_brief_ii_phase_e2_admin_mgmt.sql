-- Brief II Phase E.2.2 - Admin management RPCs
-- list/invite/revoke/change-role with last-active-super_admin lockout guards.

CREATE OR REPLACE FUNCTION public.admin_list_admins()
RETURNS TABLE (
  id uuid,
  user_id uuid,
  email text,
  role text,
  mfa_enforced boolean,
  has_mfa_factor boolean,
  created_at timestamptz,
  created_by_email text,
  revoked_at timestamptz,
  notes text
) LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  PERFORM public.admin_require_role(ARRAY['super_admin']);
  RETURN QUERY
  SELECT
    a.id,
    a.user_id,
    u.email::text,
    a.role::text,
    a.mfa_enforced,
    (a.recovery_code_hash IS NOT NULL OR a.mfa_last_verified_at IS NOT NULL) AS has_mfa_factor,
    a.created_at,
    cu.email::text,
    a.revoked_at,
    a.notes::text
  FROM public.admin_users a
  JOIN auth.users u  ON u.id  = a.user_id
  LEFT JOIN auth.users cu ON cu.id = a.created_by
  ORDER BY a.revoked_at NULLS FIRST, a.created_at DESC;
END;
$$;
GRANT EXECUTE ON FUNCTION public.admin_list_admins() TO authenticated;

-- Invite an existing auth user as an admin. Fails NO_SUCH_USER if the email
-- has never signed up - the UI maps this to "must sign up first".
CREATE OR REPLACE FUNCTION public.admin_invite_admin(
  p_email text,
  p_role text,
  p_notes text DEFAULT NULL
) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_user_id uuid;
  v_admin_id uuid;
BEGIN
  PERFORM public.admin_require_role(ARRAY['super_admin']);
  IF p_role NOT IN ('super_admin','admin','support','read_only') THEN
    RAISE EXCEPTION 'Invalid role';
  END IF;

  SELECT id INTO v_user_id FROM auth.users WHERE lower(email) = lower(p_email);
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'NO_SUCH_USER';
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.admin_users
    WHERE user_id = v_user_id AND revoked_at IS NULL
  ) THEN
    RAISE EXCEPTION 'User is already an admin';
  END IF;

  INSERT INTO public.admin_users (user_id, role, created_by, notes, mfa_enforced)
  VALUES (v_user_id, p_role, auth.uid(), p_notes, p_role IN ('super_admin','admin'))
  RETURNING id INTO v_admin_id;

  PERFORM public.log_admin_action(
    'admin.invite', 'admin', v_user_id,
    NULL,
    jsonb_build_object('role', p_role, 'admin_id', v_admin_id),
    jsonb_build_object('email', p_email)
  );

  RETURN v_admin_id;
END;
$$;
GRANT EXECUTE ON FUNCTION public.admin_invite_admin(text,text,text) TO authenticated;

-- Soft-revoke. Cannot revoke the last active super_admin.
CREATE OR REPLACE FUNCTION public.admin_revoke_admin(
  p_admin_id uuid,
  p_reason text
) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_role text;
  v_user uuid;
  v_super_count int;
BEGIN
  PERFORM public.admin_require_role(ARRAY['super_admin']);

  SELECT role, user_id INTO v_role, v_user
  FROM public.admin_users
  WHERE id = p_admin_id AND revoked_at IS NULL;

  IF v_user IS NULL THEN
    RAISE EXCEPTION 'Admin not found or already revoked';
  END IF;

  IF v_role = 'super_admin' THEN
    SELECT count(*) INTO v_super_count
    FROM public.admin_users
    WHERE role = 'super_admin' AND revoked_at IS NULL;
    IF v_super_count <= 1 THEN
      RAISE EXCEPTION 'Cannot revoke the last active super_admin';
    END IF;
  END IF;

  UPDATE public.admin_users
  SET revoked_at = now()
  WHERE id = p_admin_id;

  PERFORM public.log_admin_action(
    'admin.revoke', 'admin', v_user,
    NULL,
    jsonb_build_object('admin_id', p_admin_id, 'role', v_role),
    jsonb_build_object('reason', p_reason)
  );
END;
$$;
GRANT EXECUTE ON FUNCTION public.admin_revoke_admin(uuid,text) TO authenticated;

-- Change role. Same last-active-super_admin guard if demoting the last one.
CREATE OR REPLACE FUNCTION public.admin_change_role(
  p_admin_id uuid,
  p_new_role text
) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_old text;
  v_user uuid;
  v_super_count int;
BEGIN
  PERFORM public.admin_require_role(ARRAY['super_admin']);

  IF p_new_role NOT IN ('super_admin','admin','support','read_only') THEN
    RAISE EXCEPTION 'Invalid role';
  END IF;

  SELECT role, user_id INTO v_old, v_user
  FROM public.admin_users
  WHERE id = p_admin_id AND revoked_at IS NULL;

  IF v_user IS NULL THEN
    RAISE EXCEPTION 'Admin not found';
  END IF;

  IF v_old = p_new_role THEN
    RETURN;
  END IF;

  IF v_old = 'super_admin' AND p_new_role <> 'super_admin' THEN
    SELECT count(*) INTO v_super_count
    FROM public.admin_users
    WHERE role = 'super_admin' AND revoked_at IS NULL;
    IF v_super_count <= 1 THEN
      RAISE EXCEPTION 'Cannot demote the last active super_admin';
    END IF;
  END IF;

  UPDATE public.admin_users
  SET role = p_new_role,
      mfa_enforced = (p_new_role IN ('super_admin','admin'))
  WHERE id = p_admin_id;

  PERFORM public.log_admin_action(
    'admin.change_role', 'admin', v_user,
    jsonb_build_object('role', v_old),
    jsonb_build_object('role', p_new_role),
    '{}'::jsonb
  );
END;
$$;
GRANT EXECUTE ON FUNCTION public.admin_change_role(uuid,text) TO authenticated;

-- Fetch a single admin row by admin_users.id (for the per-admin audit header).
CREATE OR REPLACE FUNCTION public.admin_get_admin(p_admin_id uuid)
RETURNS TABLE (
  id uuid,
  user_id uuid,
  email text,
  role text,
  revoked_at timestamptz
) LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  PERFORM public.admin_require_role(ARRAY['super_admin']);
  RETURN QUERY
  SELECT a.id, a.user_id, u.email::text, a.role::text, a.revoked_at
  FROM public.admin_users a
  JOIN auth.users u ON u.id = a.user_id
  WHERE a.id = p_admin_id;
END;
$$;
GRANT EXECUTE ON FUNCTION public.admin_get_admin(uuid) TO authenticated;
