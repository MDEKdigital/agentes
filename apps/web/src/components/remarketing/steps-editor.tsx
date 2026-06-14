"use client";

import { Trash2 } from "lucide-react";
import type { RemarketingStep } from "@aula-agente/shared";

type StepDraft = Omit<RemarketingStep, "id" | "flow_id" | "created_at"> & { _tempId?: string };

interface StepsEditorProps {
  steps: StepDraft[];
  onChange: (steps: StepDraft[]) => void;
}

export function StepsEditor({ steps, onChange }: StepsEditorProps) {
  function addStep() {
    const maxOrder = steps.reduce((max, s) => Math.max(max, s.step_order), 0);
    onChange([
      ...steps,
      {
        _tempId: crypto.randomUUID(),
        step_order: maxOrder + 1,
        wait_minutes: 60,
        message_type: "text",
        message_content: "",
        is_active: true,
      },
    ]);
  }

  function removeStep(index: number) {
    onChange(steps.filter((_, i) => i !== index));
  }

  function updateStep(index: number, updates: Partial<StepDraft>) {
    onChange(steps.map((s, i) => (i === index ? { ...s, ...updates } : s)));
  }

  return (
    <div className="space-y-4">
      {steps.map((step, index) => (
        <div key={step._tempId ?? step.step_order} className="rounded-lg border border-border bg-card p-4 space-y-3">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-blue-electric-400">Etapa {index + 1}</span>
            <div className="flex items-center gap-2">
              <label className="flex items-center gap-1.5 text-xs text-muted-foreground cursor-pointer">
                <input
                  type="checkbox"
                  checked={step.is_active}
                  onChange={(e) => updateStep(index, { is_active: e.target.checked })}
                  className="h-3.5 w-3.5"
                />
                Ativa
              </label>
              <button
                onClick={() => removeStep(index)}
                className="rounded p-1 text-muted-foreground hover:text-destructive hover:bg-destructive/10"
              >
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs text-muted-foreground mb-1">Aguardar (minutos)</label>
              <input
                type="number"
                min={0}
                value={step.wait_minutes}
                onChange={(e) => updateStep(index, { wait_minutes: parseInt(e.target.value) || 0 })}
                className="w-full rounded-md border border-border bg-background px-2.5 py-1.5 text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-blue-electric-400"
              />
            </div>
            <div>
              <label className="block text-xs text-muted-foreground mb-1">Tipo</label>
              <select
                value={step.message_type}
                onChange={(e) => updateStep(index, { message_type: e.target.value as "text" | "audio" | "image" })}
                className="w-full rounded-md border border-border bg-background px-2.5 py-1.5 text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-blue-electric-400"
              >
                <option value="text">Texto</option>
                <option value="audio">Áudio</option>
                <option value="image">Imagem</option>
              </select>
            </div>
          </div>

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
