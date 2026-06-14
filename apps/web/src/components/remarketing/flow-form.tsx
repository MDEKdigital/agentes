"use client";

import type { RemarketingFlow } from "@aula-agente/shared";

interface Agent { id: string; name: string }
interface Instance { id: string; name: string }

interface FlowFormProps {
  data: Partial<RemarketingFlow>;
  agents: Agent[];
  instances: Instance[];
  onChange: (updates: Partial<RemarketingFlow>) => void;
}

export function FlowForm({ data, agents, instances, onChange }: FlowFormProps) {
  return (
    <div className="space-y-5">
      <div>
        <label className="block text-xs font-medium text-muted-foreground mb-1.5">Nome do fluxo</label>
        <input
          value={data.name ?? ""}
          onChange={(e) => onChange({ name: e.target.value })}
          placeholder="Ex: Remarketing Vector Black"
          className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-blue-electric-400"
        />
      </div>

      <div>
        <label className="block text-xs font-medium text-muted-foreground mb-1.5">Produto / Campanha</label>
        <input
          value={data.product_campaign ?? ""}
          onChange={(e) => onChange({ product_campaign: e.target.value })}
          placeholder="Ex: Vector Black"
          className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-blue-electric-400"
        />
      </div>

      <div>
        <label className="block text-xs font-medium text-muted-foreground mb-1.5">Agente de retorno</label>
        <select
          value={data.agent_id ?? ""}
          onChange={(e) => onChange({ agent_id: e.target.value })}
          className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-blue-electric-400"
        >
          <option value="">Selecione um agente</option>
          {agents.map((a) => (
            <option key={a.id} value={a.id}>{a.name}</option>
          ))}
        </select>
      </div>

      <div>
        <label className="block text-xs font-medium text-muted-foreground mb-1.5">Instância (WhatsApp)</label>
        <select
          value={data.instance_id ?? ""}
          onChange={(e) => onChange({ instance_id: e.target.value })}
          className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-blue-electric-400"
        >
          <option value="">Selecione uma instância</option>
          {instances.map((i) => (
            <option key={i.id} value={i.id}>{i.name}</option>
          ))}
        </select>
      </div>

      <div>
        <label className="block text-xs font-medium text-muted-foreground mb-1.5">
          Critério de entrada (minutos sem resposta do cliente)
        </label>
        <input
          type="number"
          min={1}
          value={data.entry_silence_minutes ?? 15}
          onChange={(e) => onChange({ entry_silence_minutes: parseInt(e.target.value) || 15 })}
          className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-blue-electric-400"
        />
      </div>

      <div>
        <label className="block text-xs font-medium text-muted-foreground mb-2">Cancelar quando</label>
        <div className="space-y-2">
          {[
            { key: "cancel_on_reply" as const, label: "Cliente responder" },
            { key: "cancel_on_resolved" as const, label: "Atendimento finalizar" },
            { key: "cancel_on_opt_out" as const, label: "Cliente pedir para parar" },
          ].map(({ key, label }) => (
            <label key={key} className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={data[key] ?? true}
                onChange={(e) => onChange({ [key]: e.target.checked })}
                className="h-4 w-4 rounded border-border"
              />
              <span className="text-sm text-foreground">{label}</span>
            </label>
          ))}
        </div>
      </div>

      <div className="flex items-center justify-between pt-2 border-t border-border">
        <span className="text-sm text-muted-foreground">Status</span>
        <button
          type="button"
          onClick={() => onChange({ status: data.status === "active" ? "inactive" : "active" })}
          className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors ${
            data.status === "active" ? "bg-blue-electric-400" : "bg-muted"
          }`}
        >
          <span
            className={`inline-block h-3.5 w-3.5 transform rounded-full bg-white transition-transform ${
              data.status === "active" ? "translate-x-4.5" : "translate-x-0.5"
            }`}
          />
        </button>
      </div>
    </div>
  );
}
