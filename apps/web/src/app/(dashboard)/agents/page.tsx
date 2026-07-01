"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useOrganization } from "@/providers/organization-provider";
import { apiFetch } from "@/lib/api";
import { AgentCard } from "@/components/agents/agent-card";
import { Plus, Bot } from "lucide-react";
import type { Agent } from "@aula-agente/shared";

export default function AgentsPage() {
  const router = useRouter();
  const { currentOrg, currentRole, loading: orgLoading } = useOrganization();
  const canCreate = currentRole !== "agent";
  const [agents, setAgents] = useState<Agent[]>([]);
  const [agentsLoading, setAgentsLoading] = useState(false);

  useEffect(() => {
    if (!currentOrg) return;

    const fetchAgents = async () => {
      setAgentsLoading(true);
      const data = await apiFetch(`/organizations/${currentOrg.id}/agents`);
      setAgents((data.agents as Agent[]) || []);
      setAgentsLoading(false);
    };

    fetchAgents();
  }, [currentOrg]);

  if (orgLoading || agentsLoading) {
    return (
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <div className="h-7 w-24 animate-pulse rounded-lg bg-muted" />
          <div className="h-9 w-36 animate-pulse rounded-lg bg-muted" />
        </div>
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {[...Array(3)].map((_, i) => (
            <div key={i} className="rounded-xl border border-border bg-card p-5 space-y-4">
              <div className="flex items-start justify-between">
                <div className="h-10 w-10 animate-pulse rounded-lg bg-muted" />
                <div className="h-4 w-16 animate-pulse rounded bg-muted" />
              </div>
              <div className="space-y-2">
                <div className="h-4 animate-pulse rounded bg-muted w-3/4" />
                <div className="h-3 animate-pulse rounded bg-muted w-full" />
                <div className="h-3 animate-pulse rounded bg-muted w-2/3" />
              </div>
            </div>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold text-foreground">Agentes</h1>
          <p className="text-xs text-muted-foreground mt-0.5">
            {agents.length} {agents.length === 1 ? "agente configurado" : "agentes configurados"}
          </p>
        </div>
        {canCreate && (
          <button
            onClick={() => router.push("/agents/new")}
            className="flex items-center gap-2 rounded-lg bg-amber-fire-500 px-4 py-2 text-sm font-semibold text-[#0F1219] transition-colors hover:bg-amber-fire-400"
          >
            <Plus className="h-4 w-4" />
            Criar Agente
          </button>
        )}
      </div>

      {/* Grid */}
      {agents.length === 0 ? (
        <div className="flex flex-col items-center justify-center gap-4 rounded-xl border border-dashed border-border py-16 text-center">
          <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-muted">
            <Bot className="h-7 w-7 text-muted-foreground" />
          </div>
          <div>
            <h3 className="font-semibold text-foreground">Nenhum agente</h3>
            <p className="mt-1 text-sm text-muted-foreground">
              Crie seu primeiro agente para começar a atender
            </p>
          </div>
          {canCreate && (
            <button
              onClick={() => router.push("/agents/new")}
              className="flex items-center gap-2 rounded-lg bg-amber-fire-500 px-4 py-2 text-sm font-semibold text-[#0F1219] transition-colors hover:bg-amber-fire-400"
            >
              <Plus className="h-4 w-4" />
              Criar Agente
            </button>
          )}
        </div>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {agents.map((agent) => (
            <AgentCard key={agent.id} agent={agent} />
          ))}
          {canCreate && (
            <div
              onClick={() => router.push("/agents/new")}
              className="flex h-full min-h-[160px] flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed border-border transition-all hover:border-primary/40 hover:bg-primary/5 cursor-pointer"
            >
              <div className="flex h-9 w-9 items-center justify-center rounded-lg border border-dashed border-border">
                <Plus className="h-4 w-4 text-muted-foreground" />
              </div>
              <p className="text-sm font-medium text-muted-foreground">Criar Agente</p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
