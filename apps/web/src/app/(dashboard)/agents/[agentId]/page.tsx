"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { apiFetch } from "@/lib/api";
import { useOrganization } from "@/providers/organization-provider";
import { AgentForm } from "@/components/agents/agent-form";
import { Button } from "@/components/ui/button";
import { Trash2 } from "lucide-react";
import type { Agent } from "@aula-agente/shared";
import Link from "next/link";

export default function EditAgentPage() {
  const { agentId } = useParams<{ agentId: string }>();
  const router = useRouter();
  const { currentOrg } = useOrganization();
  const [agent, setAgent] = useState<Agent | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!currentOrg) return;
    const fetchAgent = async () => {
      const data = await apiFetch(`/organizations/${currentOrg.id}/agents/${agentId}`);
      setAgent(data as Agent);
      setLoading(false);
    };
    fetchAgent();
  }, [agentId, currentOrg]);

  const handleSubmit = async (values: Record<string, unknown>) => {
    if (!currentOrg) return;
    try {
      await apiFetch(`/organizations/${currentOrg.id}/agents/${agentId}`, {
        method: "PATCH",
        body: JSON.stringify(values),
      });
    } catch (err) {
      alert(err instanceof Error ? err.message : "Erro ao salvar");
      throw err;
    }
    router.push("/agents");
  };

  const handleDelete = async () => {
    if (!currentOrg) return;
    if (!confirm("Tem certeza que deseja excluir este agente?")) return;
    try {
      await apiFetch(`/organizations/${currentOrg.id}/agents/${agentId}`, { method: "DELETE" });
    } catch (err) {
      alert(err instanceof Error ? err.message : "Erro ao excluir");
      return;
    }
    router.push("/agents");
  };

  if (loading) return <div>Carregando...</div>;
  if (!agent) return <div>Agente não encontrado</div>;

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">{agent.name}</h1>
        <div className="flex gap-2">
          <Link href={`/agents/${agentId}/knowledge`}>
            <Button variant="outline">Base de Conhecimento</Button>
          </Link>
          <Button variant="destructive" size="icon" onClick={handleDelete}>
            <Trash2 className="h-4 w-4" />
          </Button>
        </div>
      </div>

      <AgentForm
        defaultValues={agent}
        onSubmit={handleSubmit}
        submitLabel="Salvar Alterações"
      />
    </div>
  );
}
