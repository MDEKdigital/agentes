-- RPC to create organization + owner membership atomically.
-- Uses SECURITY DEFINER to bypass the PostgREST ES256 JWT / RLS quirk
-- where direct INSERT WITH CHECK (true) fails for authenticated users.
-- Auth guard: RAISE EXCEPTION if auth.uid() IS NULL.
CREATE OR REPLACE FUNCTION create_organization(p_name text, p_slug text)
RETURNS TABLE (
  id uuid,
  name text,
  slug text,
  plan text,
  created_at timestamptz
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id uuid;
  v_org_id uuid;
BEGIN
  v_user_id := auth.uid();
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Usuário não autenticado';
  END IF;

  IF p_name IS NULL OR trim(p_name) = '' THEN
    RAISE EXCEPTION 'Nome da organização é obrigatório';
  END IF;

  IF p_slug IS NULL OR trim(p_slug) = '' THEN
    RAISE EXCEPTION 'Slug é obrigatório';
  END IF;

  INSERT INTO organizations (name, slug, plan)
  VALUES (trim(p_name), trim(p_slug), 'free')
  RETURNING organizations.id INTO v_org_id;

  INSERT INTO organization_members (organization_id, user_id, role)
  VALUES (v_org_id, v_user_id, 'owner');

  RETURN QUERY
    SELECT o.id, o.name, o.slug, o.plan, o.created_at
    FROM organizations o WHERE o.id = v_org_id;
END;
$$;

GRANT EXECUTE ON FUNCTION create_organization(text, text) TO authenticated;

-- Cleanup: remove debug helper created during investigation
DROP FUNCTION IF EXISTS get_my_uid();
