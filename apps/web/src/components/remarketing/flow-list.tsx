"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { Edit, Copy, Trash2, ToggleLeft, ToggleRight } from "lucide-react";
import { cn } from "@/lib/utils";
import type { RemarketingFlow } from "@aula-agente/shared";

interface FlowListProps {
  flows: (RemarketingFlow & { step_count?: number })[];
  onRefresh: () => void;
  apiUrl: string;
  orgId: string;
}

export function FlowList({ flows, onRefresh, apiUrl, orgId }: FlowListProps) {
  const router = useRouter();
  const [loadingId, setLoadingId] = useState<string | null>(null);

  async function getAuthHeaders() {
    const supabase = createClient();
    const { data: { session } } = await supabase.auth.getSession();
    return {
      "Content-Type": "application/json",
      Authorization: `Bearer ${session?.access_token}`,
      "x-organization-id": orgId,
    };
  }

  async function handleToggleStatus(flow: RemarketingFlow) {
    setLoadingId(flow.id);
    try {
      const headers = await getAuthHeaders();
      const newStatus = flow.status === "active" ? "inactive" : "active";
      const res = await fetch(`${apiUrl}/remarketing/flows/${flow.id}/status`, {
        method: "PATCH",
        headers,
        body: JSON.stringify({ status: newStatus }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        alert(body.error || "Erro ao atualizar status do fluxo");
      }
    } catch {
      alert("Erro ao conectar com o servidor");
    } finally {
      onRefresh();
      setLoadingId(null);
    }
  }

  async function handleDuplicate(flow: RemarketingFlow) {
    setLoadingId(flow.id);
    const headers = await getAuthHeaders();
    await fetch(`${apiUrl}/remarketing/flows/${flow.id}/duplicate`, {
      method: "POST",
      headers,
    });
    onRefresh();
    setLoadingId(null);
  }

  async function handleDelete(flow: RemarketingFlow) {
    if (!confirm(`Excluir "${flow.name}"? Esta ação não pode ser desfeita.`)) return;
    setLoadingId(flow.id);
    const headers = await getAuthHeaders();
    const res = await fetch(`${apiUrl}/remarketing/flows/${flow.id}`, {
      method: "DELETE",
      headers,
    });
    if (res.status === 409) {
      const body = await res.json();
      alert(body.error);
    }
    onRefresh();
    setLoadingId(null);
  }

  if (flows.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center gap-4 rounded-xl border border-dashed border-border py-16 text-center">
        <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-muted">
          <span className="text-2xl">📣</span>
        </div>
        <div>
          <h3 className="font-semibold text-foreground">Nenhum fluxo de remarketing</h3>
          <p className="mt-1 text-sm text-muted-foreground">
            Crie seu primeiro fluxo para começar a recuperar clientes
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-border bg-card overflow-hidden">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-border bg-muted/40">
            <th className="px-4 py-3 text-left font-medium text-muted-foreground">Nome</th>
            <th className="px-4 py-3 text-left font-medium text-muted-foreground">Produto</th>
            <th className="px-4 py-3 text-left font-medium text-muted-foreground">Etapas</th>
            <th className="px-4 py-3 text-left font-medium text-muted-foreground">Status</th>
            <th className="px-4 py-3 text-left font-medium text-muted-foreground">Última execução</th>
            <th className="px-4 py-3 text-right font-medium text-muted-foreground">Ações</th>
          </tr>
        </thead>
        <tbody>
          {flows.map((flow) => (
            <tr key={flow.id} className="border-b border-border last:border-0 hover:bg-muted/20">
              <td className="px-4 py-3 font-medium text-foreground">{flow.name}</td>
              <td className="px-4 py-3 text-muted-foreground">{flow.product_campaign || "—"}</td>
              <td className="px-4 py-3 text-muted-foreground">{flow.step_count ?? 0}</td>
              <td className="px-4 py-3">
                <span
                  className={cn(
                    "inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium",
                    flow.status === "active"
                      ? "bg-green-500/10 text-green-400"
                      : "bg-muted text-muted-foreground"
                  )}
                >
                  {flow.status === "active" ? "Ativo" : "Inativo"}
                </span>
              </td>
              <td className="px-4 py-3 text-muted-foreground">
                {flow.last_executed_at
                  ? new Date(flow.last_executed_at).toLocaleString("pt-BR")
                  : "Nunca"}
              </td>
              <td className="px-4 py-3">
                <div className="flex items-center justify-end gap-2">
                  <button
                    onClick={() => router.push(`/remarketing/${flow.id}/edit`)}
                    className="rounded p-1 text-muted-foreground hover:text-foreground hover:bg-accent"
                    title="Editar"
                  >
                    <Edit className="h-4 w-4" />
                  </button>
                  <button
                    onClick={() => handleDuplicate(flow)}
                    disabled={loadingId === flow.id}
                    className="rounded p-1 text-muted-foreground hover:text-foreground hover:bg-accent"
                    title="Duplicar"
                  >
                    <Copy className="h-4 w-4" />
                  </button>
                  <button
                    onClick={() => handleToggleStatus(flow)}
                    disabled={loadingId === flow.id}
                    className="rounded p-1 text-muted-foreground hover:text-foreground hover:bg-accent"
                    title={flow.status === "active" ? "Desativar" : "Ativar"}
                  >
                    {flow.status === "active"
                      ? <ToggleRight className="h-4 w-4 text-green-400" />
                      : <ToggleLeft className="h-4 w-4" />}
                  </button>
                  <button
                    onClick={() => handleDelete(flow)}
                    disabled={loadingId === flow.id}
                    className="rounded p-1 text-muted-foreground hover:text-destructive hover:bg-destructive/10"
                    title="Excluir"
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
