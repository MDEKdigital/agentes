"use client";

import { createContext, useContext, useState, useEffect, useCallback, useMemo, useRef } from "react";
import { useRouter, usePathname } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import type { Organization } from "@aula-agente/shared";

interface OrganizationContextType {
  organizations: Organization[];
  currentOrg: Organization | null;
  setCurrentOrg: (org: Organization) => void;
  loading: boolean;
  refetch: () => Promise<void>;
}

const OrganizationContext = createContext<OrganizationContextType>({
  organizations: [],
  currentOrg: null,
  setCurrentOrg: () => {},
  loading: true,
  refetch: async () => {},
});

export function OrganizationProvider({ children }: { children: React.ReactNode }) {
  const [organizations, setOrganizations] = useState<Organization[]>([]);
  const [currentOrg, setCurrentOrg] = useState<Organization | null>(null);
  const [loading, setLoading] = useState(true);
  const supabase = useMemo(() => createClient(), []);
  const router = useRouter();
  const pathname = usePathname();
  // Generation counter to discard stale concurrent fetches
  const fetchGen = useRef(0);

  const fetchOrgs = useCallback(async () => {
    const gen = ++fetchGen.current;
    setLoading(true);

    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (gen !== fetchGen.current) return;

    if (!user) {
      setLoading(false);
      return;
    }

    const { data: memberships } = await supabase
      .from("organization_members")
      .select("organization_id, role, organizations(*)")
      .eq("user_id", user.id);

    if (gen !== fetchGen.current) return;

    if (memberships && memberships.length > 0) {
      const orgs = memberships
        .map((m) => m.organizations as unknown as Organization)
        .filter(Boolean);
      setOrganizations(orgs);

      let savedOrgId: string | null = null;
      try {
        savedOrgId = localStorage.getItem("currentOrgId");
      } catch {
        // localStorage unavailable in SSR or browsers with storage blocked
      }
      const savedOrg = orgs.find((o) => o.id === savedOrgId);
      setCurrentOrg(savedOrg || orgs[0]);
    } else {
      setOrganizations([]);
      setCurrentOrg(null);
    }

    setLoading(false);
  }, [supabase]);

  useEffect(() => {
    fetchOrgs();
  }, [fetchOrgs]);

  // Redirect logic is isolated here so pathname changes don't re-trigger fetchOrgs
  useEffect(() => {
    if (!loading && organizations.length === 0 && pathname !== "/onboarding") {
      router.replace("/onboarding");
    }
  }, [loading, organizations.length, pathname, router]);

  const handleSetCurrentOrg = (org: Organization) => {
    setCurrentOrg(org);
    try {
      localStorage.setItem("currentOrgId", org.id);
    } catch {
      // localStorage unavailable
    }
  };

  return (
    <OrganizationContext.Provider
      value={{
        organizations,
        currentOrg,
        setCurrentOrg: handleSetCurrentOrg,
        loading,
        refetch: fetchOrgs,
      }}
    >
      {children}
    </OrganizationContext.Provider>
  );
}

export function useOrganization() {
  return useContext(OrganizationContext);
}
