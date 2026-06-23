"use client";

import { createContext, useContext, useState, useEffect, useCallback, useRef } from "react";
import { useRouter, usePathname } from "next/navigation";
import { apiFetch } from "@/lib/api";
import type { Organization, MemberRole } from "@aula-agente/shared";

interface OrganizationContextType {
  organizations: Organization[];
  currentOrg: Organization | null;
  currentRole: MemberRole | null;
  setCurrentOrg: (org: Organization) => void;
  loading: boolean;
  refetch: () => Promise<void>;
}

const OrganizationContext = createContext<OrganizationContextType>({
  organizations: [],
  currentOrg: null,
  currentRole: null,
  setCurrentOrg: () => {},
  loading: true,
  refetch: async () => {},
});

export function OrganizationProvider({ children }: { children: React.ReactNode }) {
  const [organizations, setOrganizations] = useState<Organization[]>([]);
  const [currentOrg, setCurrentOrg] = useState<Organization | null>(null);
  const [loading, setLoading] = useState(true);
  const router = useRouter();
  const pathname = usePathname();
  // Generation counter to discard stale concurrent fetches
  const fetchGen = useRef(0);

  const fetchOrgs = useCallback(async () => {
    const gen = ++fetchGen.current;
    setLoading(true);

    try {
      const orgs = await apiFetch("/me/organizations") as Organization[];

      if (gen !== fetchGen.current) return;

      if (orgs && orgs.length > 0) {
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
    } catch {
      if (gen !== fetchGen.current) return;
      setOrganizations([]);
      setCurrentOrg(null);
    }

    if (gen !== fetchGen.current) return;
    setLoading(false);
  }, []);

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

  const currentRole = currentOrg?.role ?? null;

  return (
    <OrganizationContext.Provider
      value={{
        organizations,
        currentOrg,
        currentRole,
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
