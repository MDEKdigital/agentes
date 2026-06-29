"use client";

import { useEffect, useState, useCallback } from "react";
import Link from "next/link";
import { useOrganization } from "@/providers/organization-provider";
import { apiFetch } from "@/lib/api";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Eye, EyeOff, Save, CheckCircle, Building2, Key, AlertTriangle, CreditCard, ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";
import type { LLMProvider } from "@aula-agente/shared";

const PROVIDERS: { id: LLMProvider; name: string; placeholder: string; logo: string }[] = [
  { id: "openai", name: "OpenAI", placeholder: "sk-...", logo: "O" },
  { id: "anthropic", name: "Anthropic", placeholder: "sk-ant-...", logo: "A" },
  { id: "google", name: "Google AI", placeholder: "AI...", logo: "G" },
];

export default function SettingsPage() {
  const { currentOrg, refetch, loading: orgLoading } = useOrganization();
  const [name, setName] = useState("");
  const [saving, setSaving] = useState(false);
  const [deletingOrg, setDeletingOrg] = useState(false);
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
      (data || []).forEach((s) => { configured[s.provider] = s.has_key; });
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
      await apiFetch(`/organizations/${currentOrg.id}`, {
        method: "PATCH",
        body: JSON.stringify({ name }),
      });
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

  const handleDeleteOrg = async () => {
    if (!currentOrg) return;
    const confirmed = confirm(
      `Tem certeza que deseja excluir a organização "${currentOrg.name}"? Esta ação é irreversível e apagará todos os dados, agentes e instâncias.`
    );
    if (!confirmed) return;
    const secondConfirm = confirm(`Digite OK para confirmar a exclusão de "${currentOrg.name}".`);
    if (!secondConfirm) return;

    setDeletingOrg(true);
    try {
      await apiFetch(`/organizations/${currentOrg.id}`, { method: "DELETE" });
      await refetch();
      // Navigation is handled by the redirect effect in OrganizationProvider
      // when organizations becomes empty — no explicit push needed here
    } catch (err) {
      alert(err instanceof Error ? err.message : "Erro ao excluir organização");
    } finally {
      setDeletingOrg(false);
    }
  };

  const handleRemoveApiKey = async (provider: LLMProvider) => {
    if (!currentOrg || !confirm(`Remover chave de API do ${provider}?`)) return;
    setSavingKey(provider);
    try {
      await apiFetch(`/organizations/${currentOrg.id}/secrets/${provider}`, { method: "DELETE" });
      setConfiguredProviders((prev) => ({ ...prev, [provider]: false }));
    } catch (err) {
      alert(err instanceof Error ? err.message : "Erro ao remover chave");
    } finally {
      setSavingKey(null);
      fetchApiKeys().catch(() => {});
    }
  };

  if (orgLoading) {
    return (
      <div className="mx-auto max-w-2xl space-y-6">
        <div className="h-7 w-40 animate-pulse rounded-lg bg-muted" />
        {[...Array(2)].map((_, i) => (
          <div key={i} className="rounded-xl border border-border bg-card p-6 space-y-4">
            <div className="h-5 w-32 animate-pulse rounded bg-muted" />
            <div className="h-9 animate-pulse rounded-lg bg-muted" />
          </div>
        ))}
      </div>
    );
  }

  if (!currentOrg) return <div className="text-muted-foreground">Nenhuma organização encontrada.</div>;

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <div>
        <h1 className="text-xl font-semibold text-foreground">Configurações</h1>
        <p className="text-xs text-muted-foreground mt-0.5">Gerencie sua organização e integrações</p>
      </div>

      {/* Organização */}
      <div className="rounded-xl border border-border bg-card overflow-hidden">
        <div className="flex items-center gap-2 border-b border-border px-6 py-4">
          <Building2 className="h-4 w-4 text-blue-electric-400" />
          <h2 className="text-sm font-semibold text-foreground">Organização</h2>
        </div>
        <div className="space-y-4 p-6">
          <div className="space-y-1.5">
            <Label className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
              Nome
            </Label>
            <div className="flex gap-2">
              <Input
                value={name}
                onChange={(e) => setName(e.target.value)}
                className="bg-muted border-border"
              />
              <button
                onClick={handleSaveName}
                disabled={saving}
                className="flex shrink-0 items-center gap-1.5 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-blue-electric-400 disabled:opacity-50"
              >
                <Save className="h-3.5 w-3.5" />
                {saving ? "Salvando..." : "Salvar"}
              </button>
            </div>
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
              Slug
            </Label>
            <Input value={currentOrg.slug} disabled className="bg-muted border-border opacity-60 font-mono text-sm" />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
              Plano
            </Label>
            <div>
              {currentOrg.plan_id ? (
                <Link
                  href="/settings/billing"
                  className="inline-flex items-center gap-1 rounded-md px-2.5 py-0.5 text-xs font-semibold bg-amber-fire-500/10 text-amber-fire-400 border border-amber-fire-500/30 hover:opacity-80 transition-opacity"
                >
                  Ver plano
                  <ChevronRight className="h-3 w-3" />
                </Link>
              ) : (
                <span className={cn(
                  "inline-flex rounded-md px-2.5 py-0.5 text-xs font-semibold capitalize",
                  currentOrg.plan === "free"
                    ? "bg-muted text-muted-foreground border border-border"
                    : "bg-amber-fire-500/10 text-amber-fire-400 border border-amber-fire-500/30"
                )}>
                  {currentOrg.plan}
                </span>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Assinatura */}
      <Link
        href="/settings/billing"
        className="rounded-xl border border-border bg-card overflow-hidden flex items-center justify-between px-6 py-4 transition-colors hover:bg-accent group"
      >
        <div className="flex items-center gap-2">
          <CreditCard className="h-4 w-4 text-blue-electric-400" />
          <div>
            <p className="text-sm font-semibold text-foreground">Assinatura</p>
            <p className="text-xs text-muted-foreground">Plano atual, uso e histórico de pagamentos</p>
          </div>
        </div>
        <ChevronRight className="h-4 w-4 text-muted-foreground transition-transform group-hover:translate-x-0.5" />
      </Link>

      {/* API Keys */}
      <div className="rounded-xl border border-border bg-card overflow-hidden">
        <div className="flex items-center gap-2 border-b border-border px-6 py-4">
          <Key className="h-4 w-4 text-blue-electric-400" />
          <div>
            <h2 className="text-sm font-semibold text-foreground">API Keys dos Providers</h2>
            <p className="text-[11px] text-muted-foreground">
              Se não configurado, será usado o fallback global da plataforma.
            </p>
          </div>
        </div>
        <div className="divide-y divide-border">
          {PROVIDERS.map((provider) => (
            <div key={provider.id} className="space-y-3 p-6">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <div className="flex h-7 w-7 items-center justify-center rounded-md bg-muted text-xs font-bold text-foreground">
                    {provider.logo}
                  </div>
                  <span className="text-sm font-medium text-foreground">{provider.name}</span>
                </div>
                {configuredProviders[provider.id] ? (
                  <span className="flex items-center gap-1 text-[11px] font-medium text-green-400">
                    <CheckCircle className="h-3 w-3" />
                    Configurada
                  </span>
                ) : (
                  <span className="text-[11px] text-muted-foreground">Não configurada</span>
                )}
              </div>
              <div className="flex gap-2">
                <div className="relative flex-1">
                  <Input
                    type="text"
                    value={
                      showKeys[provider.id]
                        ? keyInputs[provider.id] || ""
                        : keyInputs[provider.id]?.replace(/./g, "•") || ""
                    }
                    onChange={(e) => {
                      if (!showKeys[provider.id]) return;
                      setKeyInputs((prev) => ({ ...prev, [provider.id]: e.target.value }));
                    }}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") handleSaveApiKey(provider.id);
                    }}
                    placeholder={
                      configuredProviders[provider.id]
                        ? "Nova chave para substituir..."
                        : provider.placeholder
                    }
                    autoComplete="off"
                    className="bg-muted border-border pr-9 font-mono text-xs"
                  />
                  <button
                    type="button"
                    onClick={() =>
                      setShowKeys((prev) => ({ ...prev, [provider.id]: !prev[provider.id] }))
                    }
                    className="absolute right-2.5 top-2.5 text-muted-foreground hover:text-foreground"
                  >
                    {showKeys[provider.id] ? (
                      <EyeOff className="h-3.5 w-3.5" />
                    ) : (
                      <Eye className="h-3.5 w-3.5" />
                    )}
                  </button>
                </div>
                <button
                  type="button"
                  onClick={() => handleSaveApiKey(provider.id)}
                  disabled={savingKey === provider.id || !keyInputs[provider.id]?.trim()}
                  className="rounded-lg border border-border bg-muted px-3 text-xs font-medium text-foreground transition-colors hover:bg-elevated disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {savingKey === provider.id ? "..." : "Salvar"}
                </button>
                {/* Remoção de chave gerenciada pelo admin */}
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Danger Zone */}
      <div className="rounded-xl border border-destructive/20 bg-destructive/5 overflow-hidden">
        <div className="flex items-center gap-2 border-b border-destructive/20 px-6 py-4">
          <AlertTriangle className="h-4 w-4 text-destructive" />
          <h2 className="text-sm font-semibold text-destructive">Zona de Perigo</h2>
        </div>
        <div className="p-6 space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium text-foreground">Excluir organização</p>
              <p className="text-xs text-muted-foreground mt-0.5">
                Remove permanentemente todos os dados, agentes, instâncias e histórico de conversas.
              </p>
            </div>
            <button
              onClick={handleDeleteOrg}
              disabled={deletingOrg}
              className="shrink-0 rounded-lg border border-destructive/50 bg-destructive/10 px-4 py-2 text-xs font-semibold text-destructive transition-colors hover:bg-destructive/20 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {deletingOrg ? "Excluindo..." : "Excluir organização"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
