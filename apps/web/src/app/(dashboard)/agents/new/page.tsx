"use client";

import { useState, useEffect, Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useOrganization } from "@/providers/organization-provider";
import { apiFetch } from "@/lib/api";
import { AgentForm } from "@/components/agents/agent-form";

function NewAgentForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { currentOrg } = useOrganization();
  const [error, setError] = useState<string | null>(null);
  const [salomaoPrompt] = useState<string>(() => {
    if (typeof window === "undefined") return "";
    if (searchParams.get("from") !== "salomao") return "";
    return sessionStorage.getItem("salomao_prompt_draft") ?? "";
  });

  useEffect(() => {
    if (searchParams.get("from") === "salomao") {
      sessionStorage.removeItem("salomao_prompt_draft");
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const promptFromUrl = searchParams.get("prompt") || salomaoPrompt;

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
      <AgentForm
        defaultValues={{ system_prompt: promptFromUrl }}
        onSubmit={handleSubmit}
        submitLabel="Criar Agente"
      />
    </div>
  );
}

export default function NewAgentPage() {
  return (
    <Suspense>
      <NewAgentForm />
    </Suspense>
  );
}
