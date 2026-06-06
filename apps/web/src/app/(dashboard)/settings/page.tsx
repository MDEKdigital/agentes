"use client";

import { useEffect, useState, useCallback } from "react";
import { useOrganization } from "@/providers/organization-provider";
import { createClient } from "@/lib/supabase/client";
import { apiFetch } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Eye, EyeOff, Save, Trash2 } from "lucide-react";
import type { LLMProvider } from "@aula-agente/shared";

const PROVIDERS: { id: LLMProvider; name: string; placeholder: string }[] = [
  { id: "openai", name: "OpenAI", placeholder: "sk-..." },
  { id: "anthropic", name: "Anthropic", placeholder: "sk-ant-..." },
  { id: "google", name: "Google AI", placeholder: "AI..." },
];

export default function SettingsPage() {
  const { currentOrg, refetch } = useOrganization();
  const [name, setName] = useState("");
  const [saving, setSaving] = useState(false);
  const [configuredProviders, setConfiguredProviders] = useState<Record<string, boolean>>({});
  const [keyInputs, setKeyInputs] = useState<Record<string, string>>({});
  const [showKeys, setShowKeys] = useState<Record<string, boolean>>({});
  const [savingKey, setSavingKey] = useState<string | null>(null);

  const fetchApiKeys = useCallback(async () => {
    if (!currentOrg) return;
    try {
      const data: { provider: string; has_key: boolean }[] = await apiFetch(
        `/organizations/${currentOrg.id}/secrets`
      );
      const configured: Record<string, boolean> = {};
      (data || []).forEach((s) => {
        configured[s.provider] = s.has_key;
      });
      setConfiguredProviders(configured);
    } catch (err) {
      alert(err instanceof Error ? err.message : "Erro ao carregar chaves configuradas");
    }
  }, [currentOrg]);

  useEffect(() => {
    if (!currentOrg) return;
    setName(currentOrg.name);
    fetchApiKeys();
  }, [currentOrg, fetchApiKeys]);

  const handleSaveName = async () => {
    if (!currentOrg || !name) return;
    setSaving(true);
    try {
      const supabase = createClient();
      const { error } = await supabase.from("organizations").update({ name }).eq("id", currentOrg.id);
      if (error) throw error;
      await refetch();
    } catch (err) {
      alert(err instanceof Error ? err.message : "Erro ao salvar nome");
    } finally {
      setSaving(false);
    }
  };

  const handleSaveApiKey = async (provider: LLMProvider) => {
    if (!currentOrg) return;
    const newKey = keyInputs[provider]?.trim();
    if (!newKey) return;
    setSavingKey(provider);
    try {
      await apiFetch(`/organizations/${currentOrg.id}/secrets/${provider}`, {
        method: "PUT",
        body: JSON.stringify({ key: newKey }),
      });
      setConfiguredProviders((prev) => ({ ...prev, [provider]: true }));
      setKeyInputs((prev) => ({ ...prev, [provider]: "" }));
    } catch (err) {
      alert(err instanceof Error ? err.message : "Erro ao salvar chave");
    } finally {
      setSavingKey(null);
    }
  };

  const handleRemoveApiKey = async (provider: LLMProvider) => {
    if (!currentOrg || !confirm(`Remover chave de API do ${provider}?`)) return;
    setSavingKey(provider);
    try {
      await apiFetch(`/organizations/${currentOrg.id}/secrets/${provider}`, {
        method: "DELETE",
      });
      setConfiguredProviders((prev) => ({ ...prev, [provider]: false }));
    } catch (err) {
      alert(err instanceof Error ? err.message : "Erro ao remover chave");
    } finally {
      setSavingKey(null);
      fetchApiKeys().catch(() => {}); // sync with server truth regardless of success/failure
    }
  };

  if (!currentOrg) return <div>Carregando...</div>;

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <h1 className="text-2xl font-bold">Configuracoes</h1>

      <Card>
        <CardHeader>
          <CardTitle>Organizacao</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label>Nome</Label>
            <div className="flex gap-2">
              <Input value={name} onChange={(e) => setName(e.target.value)} />
              <Button onClick={handleSaveName} disabled={saving}>
                <Save className="mr-2 h-4 w-4" />
                {saving ? "Salvando..." : "Salvar"}
              </Button>
            </div>
          </div>
          <div className="space-y-2">
            <Label>Slug</Label>
            <Input value={currentOrg.slug} disabled />
          </div>
          <div className="space-y-2">
            <Label>Plano</Label>
            <div>
              <Badge>{currentOrg.plan}</Badge>
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>API Keys dos Providers</CardTitle>
          <CardDescription>
            Configure as chaves de API para cada provider de LLM. Se nao configurado, sera
            usado o fallback global da plataforma.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {PROVIDERS.map((provider) => (
            <div key={provider.id} className="space-y-2">
              <Label className="flex items-center gap-2">
                {provider.name}
                {configuredProviders[provider.id] && (
                  <Badge variant="secondary" className="text-xs font-normal">
                    Configurado
                  </Badge>
                )}
              </Label>
              <div className="flex gap-2">
                <div className="relative flex-1">
                  <Input
                    type={showKeys[provider.id] ? "text" : "password"}
                    value={keyInputs[provider.id] || ""}
                    onChange={(e) =>
                      setKeyInputs((prev) => ({ ...prev, [provider.id]: e.target.value }))
                    }
                    placeholder={
                      configuredProviders[provider.id]
                        ? "Nova chave para substituir..."
                        : provider.placeholder
                    }
                  />
                  <button
                    type="button"
                    onClick={() =>
                      setShowKeys((prev) => ({
                        ...prev,
                        [provider.id]: !prev[provider.id],
                      }))
                    }
                    className="absolute right-2 top-2.5 text-muted-foreground"
                  >
                    {showKeys[provider.id] ? (
                      <EyeOff className="h-4 w-4" />
                    ) : (
                      <Eye className="h-4 w-4" />
                    )}
                  </button>
                </div>
                <Button
                  variant="outline"
                  onClick={() => handleSaveApiKey(provider.id)}
                  disabled={savingKey === provider.id || !keyInputs[provider.id]?.trim()}
                >
                  {savingKey === provider.id ? "Salvando..." : "Salvar"}
                </Button>
                {configuredProviders[provider.id] && (
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={() => handleRemoveApiKey(provider.id)}
                    disabled={savingKey === provider.id}
                    className="text-destructive hover:text-destructive"
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                )}
              </div>
            </div>
          ))}
        </CardContent>
      </Card>
    </div>
  );
}
