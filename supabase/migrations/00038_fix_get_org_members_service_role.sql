-- Fix: get_org_members_with_email fails with 500 when called from service_role client.
--
-- Root cause: the function uses auth.uid() to guard access. When called via the
-- admin/service_role client (which the API uses), auth.uid() returns NULL, causing
-- the NOT EXISTS check to always fail and raise 'Acesso negado'.
--
-- Security model:
-- This function is SECURITY DEFINER and joins auth.users — it must not be callable
-- directly by authenticated end-users or it becomes an IDOR vector (any user could
-- read members of any org by calling the RPC directly). The correct approach is to
-- restrict EXECUTE to service_role only, and enforce membership access control at the
-- API route level (apps/api/src/routes/members/index.ts already does this via
-- request.user.memberships before the DB call).
--
-- Changes:
-- 1. Remove the auth.uid() guard (was broken for service_role; redundant given API-level check)
-- 2. REVOKE EXECUTE from authenticated (closes the IDOR: unauthenticated RPC calls blocked)
-- 3. GRANT EXECUTE to service_role only

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

-- Close the IDOR: authenticated users cannot call this function directly.
-- Access is exclusively through the API backend (service_role), which enforces
-- membership checks before invoking this function.
REVOKE EXECUTE ON FUNCTION get_org_members_with_email(uuid) FROM authenticated;
GRANT EXECUTE ON FUNCTION get_org_members_with_email(uuid) TO service_role;
