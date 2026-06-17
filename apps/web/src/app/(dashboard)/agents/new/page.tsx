"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useOrganization } from "@/providers/organization-provider";
import { apiFetch } from "@/lib/api";
import { AgentForm } from "@/components/agents/agent-form";

export default function NewAgentPage() {
  const router = useRouter();
  const { currentOrg } = useOrganization();
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (values: Record<string, unknown>) => {
    if (!currentOrg) return;
    setError(null);

    try {
      await apiFetch(`/organizations/${currentOrg.id}/agents`, {
        method: "POST",
        body: JSON.stringify(values),
      });
      router.push("/agents");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erro ao criar agente");
    }
  };

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <h1 className="text-2xl font-bold">Novo Agente</h1>
      {error && (
        <p className="rounded-md border border-destructive/50 bg-destructive/10 px-4 py-3 text-sm text-destructive">
          {error}
        </p>
      )}
      <AgentForm onSubmit={handleSubmit} submitLabel="Criar Agente" />
    </div>
  );
}
