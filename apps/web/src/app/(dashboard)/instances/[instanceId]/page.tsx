"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { apiFetch } from "@/lib/api";
import { createClient } from "@/lib/supabase/client";
import { QrCodeDialog } from "@/components/instances/qrcode-dialog";
import { PairingCodeDialog } from "@/components/instances/pairing-code-dialog";
import { InstanceStatus } from "@/components/instances/instance-status";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ArrowLeft, Trash2, LogOut } from "lucide-react";
import Link from "next/link";
import { cn } from "@/lib/utils";
import type { Agent, EvolutionInstance, InstanceStatus as InstanceStatusType } from "@aula-agente/shared";
import { ProfileCard } from "@/components/instances/profile-card";
import { SettingsContent } from "@/components/instances/settings-card";
import { PrivacyContent } from "@/components/instances/privacy-card";
import { AdvancedContent } from "@/components/instances/advanced-card";

type TabId = "conexao" | "configuracoes" | "privacidade" | "avancado";

const TABS: { id: TabId; label: string }[] = [
  { id: "conexao", label: "Conexão" },
  { id: "configuracoes", label: "Configurações" },
  { id: "privacidade", label: "Privacidade" },
  { id: "avancado", label: "Avançado" },
];

export default function InstanceDetailPage() {
  const { instanceId } = useParams<{ instanceId: string }>();
  const router = useRouter();
  const [instance, setInstance] = useState<EvolutionInstance | null>(null);
  const [agents, setAgents] = useState<Agent[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<TabId>("conexao");
  const [profileReloadTrigger, setProfileReloadTrigger] = useState(0);

  useEffect(() => {
    const fetchData = async () => {
      const supabase = createClient();

      const { data: inst } = await supabase
        .from("evolution_instances")
        .select("*")
        .eq("id", instanceId)
        .single();

      if (inst) {
        const { data: agentList } = await supabase
          .from("agents")
          .select("*")
          .eq("organization_id", inst.organization_id)
          .eq("is_active", true);
        setAgents((agentList as Agent[]) || []);
      }

      setLoading(false);

      // Sempre sincroniza status e phone_number da Evolution API ao carregar
      try {
        const liveData = await apiFetch(`/instances/${instanceId}/status`);
        setInstance({
          ...(inst as EvolutionInstance),
          status: liveData.status,
          phone_number: liveData.phone_number ?? (inst as EvolutionInstance).phone_number,
        });
        if (liveData.status === "connected") {
          setProfileReloadTrigger((n) => n + 1);
        }
      } catch {
        setInstance(inst as EvolutionInstance);
      }
    };
    fetchData();
  }, [instanceId]);

  const applyInstanceData = (data: Record<string, unknown>) => {
    setInstance((prev) =>
      prev
        ? {
            ...prev,
            status: (data.status as InstanceStatusType) ?? prev.status,
            phone_number: (data.phone_number as string | null) ?? prev.phone_number,
          }
        : null
    );
    setProfileReloadTrigger((n) => n + 1);
  };

  const handleAssignAgent = async (agentId: string) => {
    try {
      await apiFetch(`/instances/${instanceId}`, {
        method: "PATCH",
        body: JSON.stringify({
          active_agent_id: agentId === "none" ? null : agentId,
        }),
      });
      setInstance((prev) =>
        prev ? { ...prev, active_agent_id: agentId === "none" ? null : agentId } : null
      );
    } catch (err) {
      alert(err instanceof Error ? err.message : "Erro ao vincular agente");
    }
  };

  const handleLogout = async () => {
    if (!confirm("Desconectar instância?")) return;
    try {
      await apiFetch(`/instances/${instanceId}/logout`, { method: "POST" });
      setInstance((prev) => (prev ? { ...prev, status: "disconnected" as InstanceStatusType } : null));
    } catch (err) {
      alert(err instanceof Error ? err.message : "Erro ao desconectar instância");
    }
  };

  const handleDelete = async () => {
    if (!confirm("Excluir instância permanentemente?")) return;
    try {
      await apiFetch(`/instances/${instanceId}`, { method: "DELETE" });
      router.push("/instances");
    } catch (err) {
      alert(err instanceof Error ? err.message : "Erro ao excluir instância");
    }
  };

  if (loading) return <div>Carregando...</div>;
  if (!instance) return <div>Instância não encontrada</div>;

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <div className="flex items-center gap-4">
        <Link href="/instances">
          <Button variant="ghost" size="icon">
            <ArrowLeft className="h-4 w-4" />
          </Button>
        </Link>
        <h1 className="text-2xl font-bold">{instance.instance_name}</h1>
        <InstanceStatus
          instanceId={instanceId}
          initialStatus={instance.status}
          onStatusChange={(s, data) => {
            if (data) applyInstanceData(data);
            else setInstance((prev) => (prev ? { ...prev, status: s as InstanceStatusType } : null));
          }}
        />
      </div>

      {/* Card com abas */}
      <Card className="overflow-hidden">
        {/* Abas */}
        <div className="flex overflow-x-auto border-b border-border scrollbar-hide">
          {TABS.map((tab) => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={cn(
                "shrink-0 whitespace-nowrap px-4 py-3 text-sm font-medium transition-colors",
                activeTab === tab.id
                  ? "border-b-2 border-primary text-foreground"
                  : "text-muted-foreground hover:text-foreground"
              )}
            >
              {tab.label}
            </button>
          ))}
        </div>

        <CardContent className="pt-4">
          {activeTab === "conexao" && (
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-medium">Telefone</p>
                  <p className="text-sm text-muted-foreground">
                    {instance.phone_number || "Não conectado"}
                  </p>
                </div>
                <div className="flex gap-2">
                  <QrCodeDialog
                    instanceId={instanceId}
                    onConnected={(data) => applyInstanceData(data)}
                  />
                  <PairingCodeDialog
                    instanceId={instanceId}
                    onConnected={(data) => applyInstanceData(data)}
                  />
                  {instance.status === "connected" && (
                    <Button variant="outline" onClick={handleLogout}>
                      <LogOut className="mr-2 h-4 w-4" />
                      Desconectar
                    </Button>
                  )}
                </div>
              </div>
            </div>
          )}

          {activeTab === "configuracoes" && (
            <SettingsContent instanceId={instanceId} />
          )}

          {activeTab === "privacidade" && (
            <PrivacyContent
              instanceId={instanceId}
              instanceConnected={instance.status === "connected"}
            />
          )}

          {activeTab === "avancado" && (
            <AdvancedContent
              instance={instance}
              onRestart={() =>
                setInstance((prev) =>
                  prev ? { ...prev, status: "connecting" as InstanceStatusType } : null
                )
              }
            />
          )}
        </CardContent>
      </Card>

      <Card>
        <CardContent className="pt-6">
          <p className="mb-2 text-sm font-medium">Agente Vinculado</p>
          <Select
            value={instance.active_agent_id || "none"}
            onValueChange={handleAssignAgent}
          >
            <SelectTrigger>
              <SelectValue placeholder="Selecionar agente" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="none">Nenhum agente</SelectItem>
              {agents.map((agent) => (
                <SelectItem key={agent.id} value={agent.id}>
                  {agent.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <p className="mt-2 text-xs text-muted-foreground">
            O agente vinculado atenderá as mensagens recebidas nesta instância
          </p>
        </CardContent>
      </Card>

      <ProfileCard
        instanceId={instanceId}
        instanceStatus={instance.status}
        reloadTrigger={profileReloadTrigger}
      />

      <div className="flex justify-end">
        <Button variant="destructive" onClick={handleDelete}>
          <Trash2 className="mr-2 h-4 w-4" />
          Excluir Instância
        </Button>
      </div>
    </div>
  );
}
