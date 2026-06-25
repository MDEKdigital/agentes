"use client";

import { useEffect, useState } from "react";
import { useOrganization } from "@/providers/organization-provider";
import { apiFetch } from "@/lib/api";
import { UserCircle, Phone, MessageSquare, Search, Trash2 } from "lucide-react";

interface Conversation {
  id: string;
  status: string;
  created_at: string;
  updated_at: string;
}

interface Lead {
  id: string;
  phone: string;
  name: string | null;
  photo_url: string | null;
  created_at: string;
  updated_at: string;
  conversations: Conversation[];
}

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  });
}

function formatPhone(phone: string) {
  const digits = phone.replace(/\D/g, "");
  if (digits.length === 13) {
    return `+${digits.slice(0, 2)} (${digits.slice(2, 4)}) ${digits.slice(4, 9)}-${digits.slice(9)}`;
  }
  if (digits.length === 12) {
    return `+${digits.slice(0, 2)} (${digits.slice(2, 4)}) ${digits.slice(4, 8)}-${digits.slice(8)}`;
  }
  return phone;
}

export default function LeadsPage() {
  const { currentOrg, loading: orgLoading } = useOrganization();
  const [leads, setLeads] = useState<Lead[]>([]);
  const [loading, setLoading] = useState(false);
  const [search, setSearch] = useState("");
  const [confirmDelete, setConfirmDelete] = useState<Lead | null>(null);
  const [deleting, setDeleting] = useState(false);

  useEffect(() => {
    if (!currentOrg) return;
    setLoading(true);
    apiFetch(`/organizations/${currentOrg.id}/contacts`)
      .then((data) => setLeads((data.contacts as Lead[]) || []))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [currentOrg]);

  const handleDeleteConfirm = async () => {
    if (!currentOrg || !confirmDelete) return;
    setDeleting(true);
    try {
      await apiFetch(`/organizations/${currentOrg.id}/contacts/${confirmDelete.id}`, {
        method: "DELETE",
      });
      setLeads((prev) => prev.filter((l) => l.id !== confirmDelete.id));
      setConfirmDelete(null);
    } catch (err) {
      alert(err instanceof Error ? err.message : "Erro ao apagar lead");
    } finally {
      setDeleting(false);
    }
  };

  const filtered = leads.filter((l) => {
    const q = search.toLowerCase();
    return (
      !q ||
      l.phone.includes(q) ||
      (l.name ?? "").toLowerCase().includes(q)
    );
  });

  if (orgLoading || loading) {
    return (
      <div className="flex h-full items-center justify-center">
        <div className="h-5 w-5 animate-spin rounded-full border-2 border-primary border-t-transparent" />
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-border px-6 py-4">
        <div>
          <h1 className="text-lg font-semibold text-foreground">Leads</h1>
          <p className="text-sm text-muted-foreground">
            {leads.length} {leads.length === 1 ? "contato capturado" : "contatos capturados"}
          </p>
        </div>
      </div>

      {/* Search */}
      <div className="border-b border-border px-6 py-3">
        <div className="relative max-w-sm">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <input
            type="text"
            placeholder="Buscar por nome ou telefone..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full rounded-md border border-border bg-background pl-9 pr-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/50"
          />
        </div>
      </div>

      {/* Table */}
      <div className="flex-1 overflow-auto px-6 py-4">
        {filtered.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-20 text-center">
            <UserCircle className="h-12 w-12 text-muted-foreground/40 mb-3" />
            <p className="text-sm font-medium text-muted-foreground">
              {search ? "Nenhum lead encontrado" : "Nenhum lead capturado ainda"}
            </p>
            <p className="text-xs text-muted-foreground/60 mt-1">
              {!search && "Os leads aparecem aqui quando interagem pelo WhatsApp"}
            </p>
          </div>
        ) : (
          <div className="overflow-hidden rounded-lg border border-border">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border bg-muted/30">
                  <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-muted-foreground">
                    Lead
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-muted-foreground">
                    Telefone
                  </th>
                  <th className="px-4 py-3 text-center text-xs font-medium uppercase tracking-wider text-muted-foreground">
                    Conversas
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-muted-foreground">
                    Primeiro contato
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-muted-foreground">
                    Última atividade
                  </th>
                  <th className="px-4 py-3 text-center text-xs font-medium uppercase tracking-wider text-muted-foreground">
                    Ações
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {filtered.map((lead) => {
                  const lastConv = lead.conversations
                    .slice()
                    .sort((a, b) => new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime())[0];
                  const openConvs = lead.conversations.filter((c) => c.status !== "resolved").length;

                  return (
                    <tr key={lead.id} className="bg-card hover:bg-accent/40 transition-colors">
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-3">
                          {lead.photo_url ? (
                            <img
                              src={lead.photo_url}
                              alt={lead.name ?? lead.phone}
                              className="h-8 w-8 rounded-full object-cover"
                            />
                          ) : (
                            <div className="flex h-8 w-8 items-center justify-center rounded-full bg-primary/10 text-xs font-semibold text-blue-electric-300">
                              {(lead.name ?? lead.phone).slice(0, 2).toUpperCase()}
                            </div>
                          )}
                          <span className="font-medium text-foreground">
                            {lead.name ?? <span className="text-muted-foreground italic">Sem nome</span>}
                          </span>
                        </div>
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-1.5 text-muted-foreground">
                          <Phone className="h-3.5 w-3.5" />
                          <span>{formatPhone(lead.phone)}</span>
                        </div>
                      </td>
                      <td className="px-4 py-3 text-center">
                        <div className="flex items-center justify-center gap-1.5">
                          <MessageSquare className="h-3.5 w-3.5 text-muted-foreground" />
                          <span className="text-foreground">{lead.conversations.length}</span>
                          {openConvs > 0 && (
                            <span className="rounded-full bg-primary/15 px-1.5 py-0.5 text-[10px] font-medium text-blue-electric-300">
                              {openConvs} aberta{openConvs > 1 ? "s" : ""}
                            </span>
                          )}
                        </div>
                      </td>
                      <td className="px-4 py-3 text-muted-foreground">
                        {formatDate(lead.created_at)}
                      </td>
                      <td className="px-4 py-3 text-muted-foreground">
                        {lastConv ? formatDate(lastConv.updated_at) : "—"}
                      </td>
                      <td className="px-4 py-3 text-center">
                        <button
                          onClick={() => setConfirmDelete(lead)}
                          className="inline-flex items-center justify-center rounded-md p-1.5 text-muted-foreground hover:bg-destructive/10 hover:text-destructive transition-colors"
                          title="Apagar lead"
                        >
                          <Trash2 className="h-4 w-4" />
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Confirmation dialog */}
      {confirmDelete && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
          <div className="mx-4 w-full max-w-sm rounded-xl border border-border bg-card p-6 shadow-xl">
            <h2 className="text-base font-semibold text-foreground">Apagar lead?</h2>
            <p className="mt-2 text-sm text-muted-foreground">
              Você está prestes a excluir{" "}
              <span className="font-medium text-foreground">
                {confirmDelete.name || formatPhone(confirmDelete.phone)}
              </span>
              . Isso vai apagar permanentemente o contato,{" "}
              <span className="font-medium text-foreground">
                {confirmDelete.conversations.length}{" "}
                {confirmDelete.conversations.length === 1 ? "conversa" : "conversas"}
              </span>{" "}
              e todas as mensagens associadas.
            </p>
            <p className="mt-2 text-xs font-medium text-destructive">
              Esta ação não pode ser desfeita.
            </p>
            <div className="mt-5 flex gap-3">
              <button
                onClick={() => setConfirmDelete(null)}
                disabled={deleting}
                className="flex-1 rounded-md border border-border px-4 py-2 text-sm font-medium text-muted-foreground hover:bg-accent disabled:opacity-50"
              >
                Cancelar
              </button>
              <button
                onClick={handleDeleteConfirm}
                disabled={deleting}
                className="flex-1 rounded-md bg-destructive px-4 py-2 text-sm font-medium text-destructive-foreground hover:bg-destructive/90 disabled:opacity-50"
              >
                {deleting ? "Apagando..." : "Sim, excluir tudo"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
