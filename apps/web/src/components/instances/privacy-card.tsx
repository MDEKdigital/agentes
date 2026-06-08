"use client";

import { useState, useEffect } from "react";
import { apiFetch } from "@/lib/api";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Loader2, AlertTriangle } from "lucide-react";

interface PrivacySettings {
  readreceipts: string;
  profile: string;
  status: string;
  online: string;
  last: string;
  groupadd: string;
  calladd: string;
}

const DEFAULTS: PrivacySettings = {
  readreceipts: "all",
  profile: "all",
  status: "all",
  online: "all",
  last: "all",
  groupadd: "all",
  calladd: "all",
};

const AUDIENCE = [
  { value: "all", label: "Todos" },
  { value: "contacts", label: "Contatos" },
  { value: "contact_blacklist", label: "Lista negra" },
  { value: "none", label: "Ninguém" },
];

const FIELDS: { key: keyof PrivacySettings; label: string; options: { value: string; label: string }[] }[] = [
  { key: "readreceipts", label: "Confirmações de leitura", options: [{ value: "all", label: "Ativado" }, { value: "none", label: "Desativado" }] },
  { key: "profile", label: "Foto de perfil", options: AUDIENCE },
  { key: "status", label: "Recados", options: AUDIENCE },
  { key: "online", label: "Online", options: [{ value: "all", label: "Todos" }, { value: "match_last_seen", label: "Igual ao visto por último" }] },
  { key: "last", label: "Visto por último", options: AUDIENCE },
  { key: "groupadd", label: "Adicionar a grupos", options: AUDIENCE },
  { key: "calladd", label: "Chamadas", options: AUDIENCE },
];

export function PrivacyContent({
  instanceId,
  instanceConnected,
}: {
  instanceId: string;
  instanceConnected: boolean;
}) {
  const [privacy, setPrivacy] = useState<PrivacySettings>(DEFAULTS);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!instanceConnected) {
      setLoading(false);
      return;
    }
    apiFetch(`/instances/${instanceId}/privacy`)
      .then((data) => setPrivacy({ ...DEFAULTS, ...(data as Partial<PrivacySettings>) }))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [instanceId, instanceConnected]);

  const handleSave = async () => {
    setSaving(true);
    try {
      await apiFetch(`/instances/${instanceId}/privacy`, {
        method: "PUT",
        body: JSON.stringify(privacy),
      });
    } catch (err) {
      alert(err instanceof Error ? err.message : "Erro ao salvar privacidade");
    } finally {
      setSaving(false);
    }
  };

  if (!instanceConnected) {
    return (
      <div className="flex items-center gap-2 rounded-lg bg-muted px-4 py-3 text-sm text-muted-foreground">
        <AlertTriangle className="h-4 w-4 shrink-0" />
        Conecte a instância para gerenciar as configurações de privacidade
      </div>
    );
  }

  if (loading) {
    return (
      <div className="flex justify-center py-8">
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3">
        {FIELDS.map(({ key, label, options }) => (
          <div key={key} className="space-y-1.5">
            <p className="text-xs font-medium text-muted-foreground">{label}</p>
            <Select
              value={privacy[key]}
              onValueChange={(v) => setPrivacy((prev) => ({ ...prev, [key]: v }))}
            >
              <SelectTrigger className="h-8 text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {options.map((opt) => (
                  <SelectItem key={opt.value} value={opt.value} className="text-xs">
                    {opt.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        ))}
      </div>

      <button
        onClick={handleSave}
        disabled={saving}
        className="w-full rounded-lg bg-primary py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-blue-electric-400 disabled:opacity-50"
      >
        {saving ? "Salvando..." : "Salvar privacidade"}
      </button>
    </div>
  );
}
