"use client";

import { useState, useEffect } from "react";
import { apiFetch } from "@/lib/api";
import { Switch } from "@/components/ui/switch";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Loader2 } from "lucide-react";

interface InstanceSettings {
  reject_call: boolean;
  msg_call: string;
  groups_ignore: boolean;
  always_online: boolean;
  read_messages: boolean;
  read_status: boolean;
  sync_full_history: boolean;
}

const DEFAULTS: InstanceSettings = {
  reject_call: false,
  msg_call: "",
  groups_ignore: false,
  always_online: false,
  read_messages: false,
  read_status: false,
  sync_full_history: false,
};

const TOGGLES: { key: keyof Omit<InstanceSettings, "msg_call">; label: string; description: string }[] = [
  { key: "reject_call", label: "Rejeitar chamadas", description: "Rejeita automaticamente chamadas recebidas" },
  { key: "groups_ignore", label: "Ignorar grupos", description: "Não processa mensagens de grupos" },
  { key: "always_online", label: "Sempre online", description: "Mantém o status como online permanentemente" },
  { key: "read_messages", label: "Marcar mensagens como lidas", description: "Visualiza mensagens automaticamente" },
  { key: "read_status", label: "Marcar status como lido", description: "Visualiza status automaticamente" },
  { key: "sync_full_history", label: "Sincronizar histórico completo", description: "Sincroniza todo o histórico ao conectar" },
];

export function SettingsContent({ instanceId }: { instanceId: string }) {
  const [settings, setSettings] = useState<InstanceSettings>(DEFAULTS);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    apiFetch(`/instances/${instanceId}/settings`)
      .then((data) => setSettings({ ...DEFAULTS, ...(data as Partial<InstanceSettings>) }))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [instanceId]);

  const handleSave = async () => {
    setSaving(true);
    try {
      await apiFetch(`/instances/${instanceId}/settings`, {
        method: "POST",
        body: JSON.stringify(settings),
      });
    } catch (err) {
      alert(err instanceof Error ? err.message : "Erro ao salvar configurações");
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="flex justify-center py-8">
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {TOGGLES.map(({ key, label, description }) => (
        <div key={key} className="flex items-center justify-between gap-4">
          <div>
            <p className="text-sm font-medium">{label}</p>
            <p className="text-xs text-muted-foreground">{description}</p>
          </div>
          <Switch
            checked={settings[key] as boolean}
            onCheckedChange={(v) => setSettings((prev) => ({ ...prev, [key]: v }))}
          />
        </div>
      ))}

      {settings.reject_call && (
        <div className="space-y-1.5">
          <Label className="text-xs">Mensagem ao rejeitar chamada</Label>
          <Input
            value={settings.msg_call}
            onChange={(e) => setSettings((prev) => ({ ...prev, msg_call: e.target.value }))}
            placeholder="Estou ocupado no momento..."
          />
        </div>
      )}

      <button
        onClick={handleSave}
        disabled={saving}
        className="w-full rounded-lg bg-primary py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-blue-electric-400 disabled:opacity-50"
      >
        {saving ? "Salvando..." : "Salvar configurações"}
      </button>
    </div>
  );
}
