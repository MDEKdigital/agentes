"use client";

import { Trash2, ChevronUp, ChevronDown } from "lucide-react";
import type { RemarketingStep, RemarketingDelayUnit } from "@aula-agente/shared";

type StepDraft = Omit<RemarketingStep, "id" | "flow_id" | "created_at"> & { _tempId?: string };

interface StepsEditorProps {
  steps: StepDraft[];
  onChange: (steps: StepDraft[]) => void;
}

const DELAY_UNITS: { value: RemarketingDelayUnit; label: string }[] = [
  { value: "minutes", label: "Minutos" },
  { value: "hours",   label: "Horas"   },
  { value: "days",    label: "Dias"    },
];

export function StepsEditor({ steps, onChange }: StepsEditorProps) {
  function addStep() {
    const maxOrder = steps.reduce((max, s) => Math.max(max, s.step_order), 0);
    onChange([
      ...steps,
      {
        _tempId: crypto.randomUUID(),
        step_order: maxOrder + 1,
        delay_value: 60,
        delay_unit: "minutes",
        message_type: "text",
        message_content: "",
        is_active: true,
      },
    ]);
  }

  function removeStep(index: number) {
    onChange(
      steps
        .filter((_, i) => i !== index)
        .map((s, i) => ({ ...s, step_order: i + 1 }))
    );
  }

  function moveStep(index: number, direction: "up" | "down") {
    const target = direction === "up" ? index - 1 : index + 1;
    if (target < 0 || target >= steps.length) return;
    const next = [...steps];
    [next[index], next[target]] = [next[target], next[index]];
    onChange(next.map((s, i) => ({ ...s, step_order: i + 1 })));
  }

  function updateStep(index: number, updates: Partial<StepDraft>) {
    onChange(steps.map((s, i) => (i === index ? { ...s, ...updates } : s)));
  }

  return (
    <div className="space-y-4">
      {steps.map((step, index) => (
        <div
          key={step._tempId ?? step.step_order}
          className="rounded-lg border border-border bg-card p-4 space-y-3"
        >
          {/* Header da etapa */}
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-blue-electric-400">
              Etapa {index + 1}
            </span>
            <div className="flex items-center gap-1">
              {/* Reordenação */}
              <button
                onClick={() => moveStep(index, "up")}
                disabled={index === 0}
                className="rounded p-1 text-muted-foreground hover:text-foreground hover:bg-accent disabled:opacity-30 disabled:cursor-not-allowed"
                title="Mover para cima"
              >
                <ChevronUp className="h-3.5 w-3.5" />
              </button>
              <button
                onClick={() => moveStep(index, "down")}
                disabled={index === steps.length - 1}
                className="rounded p-1 text-muted-foreground hover:text-foreground hover:bg-accent disabled:opacity-30 disabled:cursor-not-allowed"
                title="Mover para baixo"
              >
                <ChevronDown className="h-3.5 w-3.5" />
              </button>

              {/* Ativo */}
              <label className="flex items-center gap-1.5 text-xs text-muted-foreground cursor-pointer ml-1">
                <input
                  type="checkbox"
                  checked={step.is_active}
                  onChange={(e) => updateStep(index, { is_active: e.target.checked })}
                  className="h-3.5 w-3.5"
                />
                Ativa
              </label>

              {/* Excluir */}
              <button
                onClick={() => removeStep(index)}
                className="rounded p-1 text-muted-foreground hover:text-destructive hover:bg-destructive/10 ml-1"
                title="Excluir etapa"
              >
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            </div>
          </div>

          {/* Tempo + Unidade + Tipo */}
          <div className="grid grid-cols-3 gap-3">
            <div>
              <label className="block text-xs text-muted-foreground mb-1">Aguardar</label>
              <input
                type="number"
                min={1}
                value={step.delay_value}
                onChange={(e) =>
                  updateStep(index, { delay_value: parseInt(e.target.value) || 1 })
                }
                className="w-full rounded-md border border-border bg-background px-2.5 py-1.5 text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-blue-electric-400"
              />
            </div>
            <div>
              <label className="block text-xs text-muted-foreground mb-1">Unidade</label>
              <select
                value={step.delay_unit}
                onChange={(e) =>
                  updateStep(index, { delay_unit: e.target.value as RemarketingDelayUnit })
                }
                className="w-full rounded-md border border-border bg-background px-2.5 py-1.5 text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-blue-electric-400"
              >
                {DELAY_UNITS.map((u) => (
                  <option key={u.value} value={u.value}>{u.label}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-xs text-muted-foreground mb-1">Tipo</label>
              <select
                value={step.message_type}
                onChange={(e) =>
                  updateStep(index, { message_type: e.target.value as "text" | "audio" | "image" })
                }
                className="w-full rounded-md border border-border bg-background px-2.5 py-1.5 text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-blue-electric-400"
              >
                <option value="text">Texto</option>
                <option value="audio">Áudio</option>
                <option value="image">Imagem</option>
              </select>
            </div>
          </div>

          {/* Conteúdo */}
          <div>
            <label className="block text-xs text-muted-foreground mb-1">
              {step.message_type === "text" ? "Mensagem" : "URL do arquivo"}
            </label>
            {step.message_type === "text" ? (
              <textarea
                rows={3}
                value={step.message_content}
                onChange={(e) => updateStep(index, { message_content: e.target.value })}
                placeholder="Digite a mensagem..."
                className="w-full rounded-md border border-border bg-background px-2.5 py-1.5 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-blue-electric-400 resize-none"
              />
            ) : (
              <input
                value={step.message_content}
                onChange={(e) => updateStep(index, { message_content: e.target.value })}
                placeholder="https://..."
                className="w-full rounded-md border border-border bg-background px-2.5 py-1.5 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-blue-electric-400"
              />
            )}
          </div>
        </div>
      ))}

      <button
        onClick={addStep}
        className="w-full rounded-lg border-2 border-dashed border-border py-3 text-sm font-medium text-muted-foreground hover:border-blue-electric-400/40 hover:text-blue-electric-400 transition-colors"
      >
        + Adicionar etapa
      </button>
    </div>
  );
}
