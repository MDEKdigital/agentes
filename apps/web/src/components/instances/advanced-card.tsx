"use client";

import { useState } from "react";
import { apiFetch } from "@/lib/api";
import { Copy, RotateCw } from "lucide-react";
import type { EvolutionInstance } from "@aula-agente/shared";

export function AdvancedContent({
  instance,
  onRestart,
}: {
  instance: EvolutionInstance;
  onRestart?: () => void;
}) {
  const [restarting, setRestarting] = useState(false);

  const handleRestart = async () => {
    if (!confirm("Reiniciar a instância WhatsApp? A conexão será interrompida brevemente.")) return;
    setRestarting(true);
    try {
      await apiFetch(`/instances/${instance.id}/restart`, { method: "POST" });
      onRestart?.();
    } catch (err) {
      alert(err instanceof Error ? err.message : "Erro ao reiniciar instância");
    } finally {
      setRestarting(false);
    }
  };

  const copy = (text: string) => navigator.clipboard.writeText(text).catch(() => {});

  const FIELDS = [
    { label: "Instance ID", value: instance.instance_id || instance.instance_name },
    { label: "Webhook URL", value: instance.webhook_url || "—" },
    { label: "Criada em", value: new Date(instance.created_at).toLocaleString("pt-BR"), noCopy: true },
  ];

  return (
    <div className="space-y-4">
      <div className="space-y-3">
        {FIELDS.map(({ label, value, noCopy }) => (
          <div key={label} className="space-y-1">
            <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
              {label}
            </p>
            <div className="flex items-center gap-2">
              <p className="flex-1 truncate rounded-md bg-muted px-3 py-1.5 font-mono text-xs text-foreground">
                {value}
              </p>
              {!noCopy && value !== "—" && (
                <button
                  onClick={() => copy(value)}
                  className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                  title="Copiar"
                >
                  <Copy className="h-3.5 w-3.5" />
                </button>
              )}
            </div>
          </div>
        ))}
      </div>

      <button
        onClick={handleRestart}
        disabled={restarting}
        className="flex w-full items-center justify-center gap-2 rounded-lg border border-border bg-muted py-2 text-sm font-medium text-foreground transition-colors hover:bg-elevated disabled:opacity-50"
      >
        <RotateCw className={`h-3.5 w-3.5 ${restarting ? "animate-spin" : ""}`} />
        {restarting ? "Reiniciando..." : "Reiniciar instância"}
      </button>
    </div>
  );
}
