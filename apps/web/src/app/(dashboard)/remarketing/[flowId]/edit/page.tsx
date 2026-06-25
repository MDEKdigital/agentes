"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { useOrganization } from "@/providers/organization-provider";
import { apiFetch } from "@/lib/api";
import { FlowForm } from "@/components/remarketing/flow-form";
import { StepsEditor } from "@/components/remarketing/steps-editor";
import { Loader2 } from "lucide-react";
import type { RemarketingFlow, RemarketingStep } from "@aula-agente/shared";

type StepDraft = Omit<RemarketingStep, "id" | "flow_id" | "created_at"> & { _tempId?: string; id?: string; step_order: number };

const DEFAULT_FLOW: Partial<RemarketingFlow> = {
  name: "",
  product_campaign: "",
  status: "inactive",
  entry_silence_minutes: 15,
  cancel_on_reply: true,
  cancel_on_resolved: true,
  cancel_on_opt_out: true,
};

export default function FlowEditPage() {
  const params = useParams<{ flowId: string }>();
  const router = useRouter();
  const { currentOrg } = useOrganization();
  const isNew = params.flowId === "new";

  const [flowData, setFlowData] = useState<Partial<RemarketingFlow>>(DEFAULT_FLOW);
  const [steps, setSteps] = useState<StepDraft[]>([]);
  const [agents, setAgents] = useState<{ id: string; name: string }[]>([]);
  const [instances, setInstances] = useState<{ id: string; instance_name: string }[]>([]);
  const [loading, setLoading] = useState(!isNew);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!currentOrg) return;

    const load = async () => {
      try {
        const [agData, instData] = await Promise.all([
          apiFetch(`/organizations/${currentOrg.id}/agents`),
          apiFetch(`/organizations/${currentOrg.id}/instances`),
        ]);
        setAgents(((agData as { agents: { id: string; name: string }[] })?.agents) ?? []);
        setInstances((instData as { id: string; instance_name: string }[]) ?? []);

        if (!isNew) {
          const orgHeader = { headers: { "x-organization-id": currentOrg.id } };
          const [allFlows, stepsData] = await Promise.all([
            apiFetch(`/remarketing/flows`, orgHeader),
            apiFetch(`/remarketing/flows/${params.flowId}/steps`, orgHeader),
          ]);
          const flow = (allFlows as RemarketingFlow[] | null)?.find((f) => f.id === params.flowId);
          if (flow) setFlowData(flow);
          setSteps(((stepsData as RemarketingStep[] | null) ?? []).map((s) => ({ ...s, _tempId: s.id })));
        }
      } catch (err) {
        setLoadError(err instanceof Error ? err.message : "Erro ao carregar fluxo");
      } finally {
        setLoading(false);
      }
    };

    load();
  }, [currentOrg, isNew, params.flowId]);

  async function handleSave() {
    if (!currentOrg) return;
    setSaving(true);

    try {
      let flowId = params.flowId;
      const orgHeader = { "x-organization-id": currentOrg.id };

      if (isNew) {
        const created = await apiFetch(`/remarketing/flows`, {
          method: "POST",
          headers: orgHeader,
          body: JSON.stringify(flowData),
        }) as { id: string };
        flowId = created.id;
      } else {
        await apiFetch(`/remarketing/flows/${flowId}`, {
          method: "PUT",
          headers: orgHeader,
          body: JSON.stringify(flowData),
        });
      }

      const currentStepIds = new Set(steps.filter((s) => s.id).map((s) => s.id!));

      const dbSteps = await apiFetch(`/remarketing/flows/${flowId}/steps`, { headers: orgHeader }) as { id: string }[];
      for (const dbStep of dbSteps) {
        if (!currentStepIds.has(dbStep.id)) {
          await apiFetch(`/remarketing/flows/${flowId}/steps/${dbStep.id}`, { method: "DELETE", headers: orgHeader });
        }
      }

      for (const step of steps) {
        const { _tempId, id, ...body } = step;
        if (id) {
          await apiFetch(`/remarketing/flows/${flowId}/steps/${id}`, {
            method: "PUT",
            headers: orgHeader,
            body: JSON.stringify(body),
          });
        } else {
          await apiFetch(`/remarketing/flows/${flowId}/steps`, {
            method: "POST",
            headers: orgHeader,
            body: JSON.stringify(body),
          });
        }
      }

      router.push("/remarketing");
    } catch (err) {
      console.error("Erro ao salvar:", err);
      alert("Erro ao salvar o fluxo. Verifique os campos e tente novamente.");
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (loadError) {
    return (
      <div className="flex flex-col items-center justify-center gap-3 py-20 text-center">
        <p className="text-sm text-destructive">{loadError}</p>
        <button
          onClick={() => router.push("/remarketing")}
          className="text-xs text-muted-foreground underline hover:text-foreground"
        >
          Voltar para Remarketing
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold text-foreground">
          {isNew ? "Novo fluxo de remarketing" : "Editar fluxo"}
        </h1>
        <div className="flex gap-2">
          <button
            onClick={() => router.push("/remarketing")}
            className="rounded-lg border border-border px-4 py-2 text-sm font-medium text-muted-foreground hover:bg-accent"
          >
            Cancelar
          </button>
          <button
            onClick={handleSave}
            disabled={saving}
            className="flex items-center gap-2 rounded-lg bg-amber-fire-500 px-4 py-2 text-sm font-semibold text-[#0F1219] hover:bg-amber-fire-400 disabled:opacity-60"
          >
            {saving && <Loader2 className="h-4 w-4 animate-spin" />}
            Salvar
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <div className="rounded-xl border border-border bg-card p-5">
          <h2 className="text-sm font-semibold text-foreground mb-4">Configurações do fluxo</h2>
          <FlowForm
            data={flowData}
            agents={agents}
            instances={instances}
            onChange={(updates) => setFlowData((prev) => ({ ...prev, ...updates }))}
          />
        </div>

        <div className="rounded-xl border border-border bg-card p-5">
          <h2 className="text-sm font-semibold text-foreground mb-4">Etapas</h2>
          <StepsEditor steps={steps} onChange={setSteps} />
        </div>
      </div>
    </div>
  );
}
