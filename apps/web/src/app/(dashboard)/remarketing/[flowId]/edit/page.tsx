"use client";

import { useEffect, useState, useCallback } from "react";
import { useParams, useRouter } from "next/navigation";
import { useOrganization } from "@/providers/organization-provider";
import { createClient } from "@/lib/supabase/client";
import { FlowForm } from "@/components/remarketing/flow-form";
import { StepsEditor } from "@/components/remarketing/steps-editor";
import { Loader2 } from "lucide-react";
import type { RemarketingFlow, RemarketingStep } from "@aula-agente/shared";

const API_URL = process.env.NEXT_PUBLIC_API_URL!;

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
  const [saving, setSaving] = useState(false);

  const getHeaders = useCallback(async () => {
    const supabase = createClient();
    const { data: { session } } = await supabase.auth.getSession();
    return {
      "Content-Type": "application/json",
      Authorization: `Bearer ${session?.access_token}`,
      "x-organization-id": currentOrg?.id ?? "",
    };
  }, [currentOrg]);

  useEffect(() => {
    if (!currentOrg) return;
    const supabase = createClient();

    Promise.all([
      supabase.from("agents").select("id, name").eq("organization_id", currentOrg.id),
      supabase.from("evolution_instances").select("id, instance_name").eq("organization_id", currentOrg.id),
    ]).then(([{ data: ag }, { data: inst }]) => {
      setAgents(ag ?? []);
      setInstances(inst ?? []);
    });

    if (!isNew) {
      getHeaders().then(async (headers) => {
        const [flowRes, stepsRes] = await Promise.all([
          fetch(`${API_URL}/remarketing/flows`, { headers }),
          fetch(`${API_URL}/remarketing/flows/${params.flowId}/steps`, { headers }),
        ]);
        if (flowRes.ok) {
          const allFlows: RemarketingFlow[] = await flowRes.json();
          const flow = allFlows.find((f) => f.id === params.flowId);
          if (flow) setFlowData(flow);
        }
        if (stepsRes.ok) {
          const data: RemarketingStep[] = await stepsRes.json();
          setSteps(data.map((s) => ({ ...s, _tempId: s.id })));
        }
        setLoading(false);
      });
    }
  }, [currentOrg, isNew, params.flowId, getHeaders]);

  async function handleSave() {
    if (!currentOrg) return;
    setSaving(true);
    const headers = await getHeaders();

    try {
      let flowId = params.flowId;

      if (isNew) {
        const res = await fetch(`${API_URL}/remarketing/flows`, {
          method: "POST",
          headers,
          body: JSON.stringify(flowData),
        });
        if (!res.ok) throw new Error(await res.text());
        const created = await res.json();
        flowId = created.id;
      } else {
        const res = await fetch(`${API_URL}/remarketing/flows/${flowId}`, {
          method: "PUT",
          headers,
          body: JSON.stringify(flowData),
        });
        if (!res.ok) throw new Error(await res.text());
      }

      // Salvar etapas: atualizar existentes, criar novas, deletar removidas
      const currentStepIds = new Set(steps.filter((s) => s.id).map((s) => s.id!));

      const existingRes = await fetch(`${API_URL}/remarketing/flows/${flowId}/steps`, { headers });
      if (existingRes.ok) {
        const dbSteps: { id: string }[] = await existingRes.json();
        for (const dbStep of dbSteps) {
          if (!currentStepIds.has(dbStep.id)) {
            await fetch(`${API_URL}/remarketing/flows/${flowId}/steps/${dbStep.id}`, {
              method: "DELETE",
              headers,
            });
          }
        }
      }

      for (const step of steps) {
        const { _tempId, id, ...body } = step;
        if (id) {
          await fetch(`${API_URL}/remarketing/flows/${flowId}/steps/${id}`, {
            method: "PUT",
            headers,
            body: JSON.stringify(body),
          });
        } else {
          await fetch(`${API_URL}/remarketing/flows/${flowId}/steps`, {
            method: "POST",
            headers,
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
