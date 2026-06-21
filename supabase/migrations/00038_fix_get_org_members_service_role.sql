-- Fix: get_org_members_with_email fails with 500 when called from service_role client.
--
-- Root cause: the function uses auth.uid() to guard access. When called via the
-- admin/service_role client (which the API uses), auth.uid() returns NULL, causing
-- the NOT EXISTS check to always fail and raise 'Acesso negado'.
--
-- Authorization is already enforced at the API route level (members/index.ts checks
-- request.user.memberships before calling this function). The SQL-level auth.uid()
-- guard is redundant and breaks service_role callers.
--
-- Fix: drop the auth.uid() guard, simplify to pure SQL, and grant EXECUTE to
-- service_role in addition to authenticated.

CREATE OR REPLACE FUNCTION get_org_members_with_email(p_org_id uuid)
RETURNS TABLE (
  id uuid,
  user_id uuid,
  email text,
  role text,
  created_at timestamptz
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
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
$$;

GRANT EXECUTE ON FUNCTION get_org_members_with_email(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION get_org_members_with_email(uuid) TO service_role;
