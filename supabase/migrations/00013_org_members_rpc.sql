-- RPC to fetch org members with email (requires SECURITY DEFINER to access auth.users)
CREATE OR REPLACE FUNCTION get_org_members_with_email(p_org_id uuid)
RETURNS TABLE (
  id uuid,
  user_id uuid,
  email text,
  role text,
  created_at timestamptz
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM organization_members
    WHERE organization_id = p_org_id AND user_id = auth.uid()
  ) THEN
    RAISE EXCEPTION 'Acesso negado';
  END IF;

  RETURN QUERY
  SELECT
    om.id,
    om.user_id,
    u.email::text,
    om.role,
    om.created_at
  FROM organization_members om
  JOIN auth.users u ON u.id = om.user_id
  WHERE om.organization_id = p_org_id
  ORDER BY om.created_at;
END;
$$;

GRANT EXECUTE ON FUNCTION get_org_members_with_email(uuid) TO authenticated;
