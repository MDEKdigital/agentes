"use client";

import { useEffect, useState, useCallback } from "react";
import Link from "next/link";
import { useOrganization } from "@/providers/organization-provider";
import { createClient } from "@/lib/supabase/client";
import { FlowList } from "@/components/remarketing/flow-list";
import { Plus } from "lucide-react";
import type { RemarketingFlow } from "@aula-agente/shared";

const API_URL = process.env.NEXT_PUBLIC_API_URL!;

type FlowWithCount = RemarketingFlow & { step_count?: number };

export default function RemarketingPage() {
  const { currentOrg, loading: orgLoading } = useOrganization();
  const [flows, setFlows] = useState<FlowWithCount[]>([]);
  const [loading, setLoading] = useState(false);

  const fetchFlows = useCallback(async () => {
    if (!currentOrg) return;
    setLoading(true);
    const supabase = createClient();
    const { data: { session } } = await supabase.auth.getSession();
    const res = await fetch(`${API_URL}/remarketing/flows`, {
      headers: {
        Authorization: `Bearer ${session?.access_token}`,
        "x-organization-id": currentOrg.id,
      },
    });
    if (res.ok) {
      const data = await res.json();
      const withCount = data.map((f: RemarketingFlow & { remarketing_steps?: { count: number }[] }) => ({
        ...f,
        step_count: f.remarketing_steps?.[0]?.count ?? 0,
      }));
      setFlows(withCount);
    }
    setLoading(false);
  }, [currentOrg]);

  useEffect(() => {
    fetchFlows();
  }, [fetchFlows]);

  if (orgLoading || loading) {
    return (
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <div className="h-7 w-32 animate-pulse rounded-lg bg-muted" />
          <div className="h-9 w-48 animate-pulse rounded-lg bg-muted" />
        </div>
        <div className="h-48 animate-pulse rounded-xl bg-muted" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold text-foreground">Remarketing</h1>
          <p className="text-xs text-muted-foreground mt-0.5">
            {flows.length} {flows.length === 1 ? "fluxo configurado" : "fluxos configurados"}
          </p>
        </div>
        <Link href="/remarketing/new/edit">
          <button className="flex items-center gap-2 rounded-lg bg-amber-fire-500 px-4 py-2 text-sm font-semibold text-[#0F1219] transition-colors hover:bg-amber-fire-400">
            <Plus className="h-4 w-4" />
            Novo fluxo de remarketing
          </button>
        </Link>
      </div>

      <FlowList
        flows={flows}
        onRefresh={fetchFlows}
        apiUrl={API_URL}
        orgId={currentOrg?.id ?? ""}
      />
    </div>
  );
}
