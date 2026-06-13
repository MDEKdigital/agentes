"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { AgentForm } from "@/components/agents/agent-form";
import { Button } from "@/components/ui/button";
import { Trash2 } from "lucide-react";
import type { Agent } from "@aula-agente/shared";
import Link from "next/link";

export default function EditAgentPage() {
  const { agentId } = useParams<{ agentId: string }>();
  const router = useRouter();
  const [agent, setAgent] = useState<Agent | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchAgent = async () => {
      const supabase = createClient();
      const { data } = await supabase.from("agents").select("*").eq("id", agentId).single();
      setAgent(data as Agent);
      setLoading(false);
    };
    fetchAgent();
  }, [agentId]);

  const handleSubmit = async (values: Record<string, unknown>) => {
    const supabase = createClient();
    const { error } = await supabase.from("agents").update(values).eq("id", agentId);
    if (error) {
      alert(`Erro ao salvar: ${error.message}`);
      throw error;
    }
    // When keywords are first added to a previously keywordless agent, activate all
    // existing open conversations so they aren't silently gated by the new keyword check.
    const newKeywords = values.activation_keywords as string[] | undefined;
    if (agent && agent.activation_keywords.length === 0 && newKeywords && newKeywords.length > 0) {
      await supabase
        .from("conversations")
        .update({ is_keyword_activated: true })
        .eq("agent_id", agentId)
        .in("status", ["open", "waiting"]);
    }
    router.push("/agents");
  };

  const handleDelete = async () => {
    if (!confirm("Tem certeza que deseja excluir este agente?")) return;
    const supabase = createClient();
    const { error } = await supabase.from("agents").delete().eq("id", agentId);
    if (error) {
      alert(error.message);
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
