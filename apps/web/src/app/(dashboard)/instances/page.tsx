"use client";

import { useEffect, useState, useCallback } from "react";
import { useOrganization } from "@/providers/organization-provider";
import { apiFetch } from "@/lib/api";
import { InstanceCard } from "@/components/instances/instance-card";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Plus, Radio } from "lucide-react";

export default function InstancesPage() {
  const { currentOrg } = useOrganization();
  const [instances, setInstances] = useState<{
    id: string;
    instance_name: string;
    status: string;
    phone_number: string | null;
    agents?: { id: string; name: string } | null;
  }[]>([]);
  const [loading, setLoading] = useState(true);
  const [newName, setNewName] = useState("");
  const [creating, setCreating] = useState(false);
  const [dialogOpen, setDialogOpen] = useState(false);

  const fetchInstances = useCallback(async () => {
    if (!currentOrg) { setLoading(false); return; }
    try {
      const data = await apiFetch(`/organizations/${currentOrg.id}/instances`);
      setInstances(data || []);
    } catch (err) {
      alert(err instanceof Error ? err.message : "Erro ao carregar instâncias");
    } finally {
      setLoading(false);
    }
  }, [currentOrg]);

  useEffect(() => { fetchInstances(); }, [fetchInstances]);

  const handleCreate = async () => {
    if (!newName || !currentOrg) return;
    setCreating(true);
    try {
      await apiFetch(`/organizations/${currentOrg.id}/instances`, {
        method: "POST",
        body: JSON.stringify({ instance_name: newName }),
      });
      setNewName("");
      setDialogOpen(false);
      await fetchInstances();
    } catch (err) {
      alert(err instanceof Error ? err.message : "Erro ao criar instância");
    } finally {
      setCreating(false);
    }
  };

  if (loading) {
    return (
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <div className="h-7 w-48 animate-pulse rounded-lg bg-muted" />
          <div className="h-9 w-40 animate-pulse rounded-lg bg-muted" />
        </div>
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {[...Array(3)].map((_, i) => (
            <div key={i} className="rounded-xl border border-border bg-card p-5 space-y-4">
              <div className="flex items-start justify-between">
                <div className="h-10 w-10 animate-pulse rounded-lg bg-muted" />
                <div className="h-4 w-20 animate-pulse rounded bg-muted" />
              </div>
              <div className="space-y-1.5">
                <div className="h-4 animate-pulse rounded bg-muted w-2/3" />
                <div className="h-3 animate-pulse rounded bg-muted w-1/2" />
              </div>
            </div>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold text-foreground">Instâncias WhatsApp</h1>
          <p className="text-xs text-muted-foreground mt-0.5">
            {instances.length} {instances.length === 1 ? "instância" : "instâncias"} configuradas
          </p>
        </div>
        <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
          <DialogTrigger asChild>
            <button className="flex items-center gap-2 rounded-lg bg-amber-fire-500 px-4 py-2 text-sm font-semibold text-[#0F1219] transition-colors hover:bg-amber-fire-400">
              <Plus className="h-4 w-4" />
              Nova Instância
            </button>
          </DialogTrigger>
          <DialogContent className="bg-card border-border">
            <DialogHeader>
              <DialogTitle className="text-foreground">Criar Instância</DialogTitle>
            </DialogHeader>
            <div className="space-y-4">
              <div className="space-y-1.5">
                <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
                  Nome da instância
                </p>
                <Input
                  placeholder="ex: atendimento-principal"
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                  className="bg-muted border-border"
                  onKeyDown={(e) => e.key === "Enter" && handleCreate()}
                />
              </div>
              <button
                onClick={handleCreate}
                disabled={creating || !newName}
                className="w-full rounded-lg bg-amber-fire-500 py-2 text-sm font-semibold text-[#0F1219] transition-colors hover:bg-amber-fire-400 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {creating ? "Criando..." : "Criar Instância"}
              </button>
            </div>
          </DialogContent>
        </Dialog>
      </div>

      {/* Grid */}
      {instances.length === 0 ? (
        <div className="flex flex-col items-center justify-center gap-4 rounded-xl border border-dashed border-border py-16 text-center">
          <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-muted">
            <Radio className="h-7 w-7 text-muted-foreground" />
          </div>
          <div>
            <h3 className="font-semibold text-foreground">Nenhuma instância</h3>
            <p className="mt-1 text-sm text-muted-foreground">
              Conecte seu WhatsApp criando uma instância
            </p>
          </div>
        </div>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {instances.map((instance) => (
            <InstanceCard key={instance.id} instance={instance} />
          ))}
        </div>
      )}
    </div>
  );
}
