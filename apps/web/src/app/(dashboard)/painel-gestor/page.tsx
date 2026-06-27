"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2, ChevronDown, ChevronRight, RefreshCw } from "lucide-react";
import { cn } from "@/lib/utils";
import { apiFetch } from "@/lib/api";
import type { Plan } from "@aula-agente/shared";

// ─── Types ───────────────────────────────────────────────────────────────────

interface SubInfo {
  id: string;
  status: string;
  gateway: string | null;
  gateway_subscription_id: string | null;
  billing_interval: string;
  current_period_start: string | null;
  current_period_end: string | null;
  trial_end: string | null;
  cancelled_at: string | null;
  cancel_at_period_end: boolean;
  metadata: Record<string, unknown>;
  plan: { id: string; name: string; slug: string; price_monthly: number; price_yearly: number; max_agents: number; max_members: number; max_instances: number } | null;
}

interface BillingEventRow {
  id: string;
  event_type: string;
  status: string;
  gateway: string | null;
  created_at: string;
  error_message: string | null;
}

interface OrgRow {
  id: string;
  name: string;
  slug: string;
  onboarding_status: string;
  created_at: string;
  plan_id: string | null;
  owner_email: string | null;
  subscription: SubInfo | null;
  billing_events: BillingEventRow[];
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

const STATUS_LABEL: Record<string, { text: string; cls: string }> = {
  active:    { text: "Ativa",     cls: "text-green-400 bg-green-400/10 border-green-400/30" },
  trial:     { text: "Trial",    cls: "text-blue-400 bg-blue-400/10 border-blue-400/30" },
  past_due:  { text: "Pendente", cls: "text-amber-400 bg-amber-400/10 border-amber-400/30" },
  paused:    { text: "Pausada",  cls: "text-orange-400 bg-orange-400/10 border-orange-400/30" },
  cancelled: { text: "Cancelada",cls: "text-red-400 bg-red-400/10 border-red-400/30" },
};

const EVENT_STATUS: Record<string, { text: string; cls: string }> = {
  processed:  { text: "Ok",          cls: "text-green-400 bg-green-400/10 border-green-400/30" },
  pending:    { text: "Pendente",    cls: "text-amber-400 bg-amber-400/10 border-amber-400/30" },
  processing: { text: "Processando", cls: "text-amber-400 bg-amber-400/10 border-amber-400/30" },
  failed:     { text: "Falhou",      cls: "text-red-400 bg-red-400/10 border-red-400/30" },
  ignored:    { text: "Ignorado",    cls: "text-muted-foreground bg-muted border-border" },
};

function fmtDate(iso: string | null) {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("pt-BR", { day: "2-digit", month: "short", year: "numeric" });
}

function fmtDateTime(iso: string) {
  return new Date(iso).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" });
}

// ─── Modal ───────────────────────────────────────────────────────────────────

function Modal({ title, onClose, onConfirm, loading, children }: {
  title: string; onClose: () => void; onConfirm: () => void; loading: boolean; children: React.ReactNode;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60">
      <div className="w-full max-w-sm rounded-xl border border-border bg-card p-5 shadow-xl">
        <h3 className="mb-4 text-sm font-semibold text-foreground">{title}</h3>
        <div className="space-y-3">{children}</div>
        <div className="mt-5 flex justify-end gap-2">
          <button onClick={onClose} className="rounded-lg border border-border px-3 py-1.5 text-xs font-medium text-muted-foreground hover:bg-accent transition-colors">
            Cancelar
          </button>
          <button onClick={onConfirm} disabled={loading} className="flex items-center gap-1.5 rounded-lg bg-foreground px-3 py-1.5 text-xs font-medium text-background hover:opacity-80 disabled:opacity-50 transition-opacity">
            {loading && <Loader2 className="h-3 w-3 animate-spin" />} Confirmar
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── OrgRow ──────────────────────────────────────────────────────────────────

function OrgRow({ org, plans, onRefresh }: { org: OrgRow; plans: Plan[]; onRefresh: () => void }) {
  const [expanded, setExpanded] = useState(false);
  const [modal, setModal] = useState<"activate" | "plan" | "cancel" | "delete" | null>(null);
  const [busy, setBusy] = useState(false);
  const [planId, setPlanId] = useState(plans[0]?.id ?? "");
  const [interval, setInterval] = useState("manual");
  const [msg, setMsg] = useState<{ text: string; ok: boolean } | null>(null);

  const sub = org.subscription;
  const statusCfg = STATUS_LABEL[sub?.status ?? ""] ?? null;

  const act = async (fn: () => Promise<void>) => {
    setBusy(true);
    setMsg(null);
    try {
      await fn();
      setModal(null);
      onRefresh();
    } catch (e) {
      setMsg({ text: (e as Error).message, ok: false });
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <tr className="cursor-pointer hover:bg-muted/20 transition-colors" onClick={() => { setExpanded(v => !v); setMsg(null); }}>
        <td className="px-4 py-3">
          {expanded ? <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" /> : <ChevronRight className="h-3.5 w-3.5 text-muted-foreground" />}
        </td>
        <td className="px-4 py-3">
          <p className="text-xs font-medium text-foreground">{org.name}</p>
          <p className="text-[11px] text-muted-foreground font-mono">{org.slug}</p>
        </td>
        <td className="px-4 py-3 text-xs text-muted-foreground">{org.owner_email ?? "—"}</td>
        <td className="px-4 py-3 text-xs text-foreground">{sub?.plan?.name ?? "—"}</td>
        <td className="px-4 py-3">
          {statusCfg
            ? <span className={cn("rounded border px-2 py-0.5 text-[11px] font-semibold", statusCfg.cls)}>{statusCfg.text}</span>
            : <span className="text-xs text-muted-foreground">Sem assinatura</span>}
        </td>
        <td className="px-4 py-3 text-xs capitalize">{sub?.gateway ?? "—"}</td>
        <td className="px-4 py-3 text-xs">{fmtDate(sub?.current_period_end ?? null)}</td>
        <td className="px-4 py-3" onClick={e => e.stopPropagation()}>
          <div className="flex items-center gap-1.5">
            {!sub
              ? <button onClick={() => { setPlanId(plans[0]?.id ?? ""); setInterval("manual"); setModal("activate"); }} className="rounded border border-green-500/40 px-2 py-1 text-[11px] font-medium text-green-400 hover:bg-green-500/10 transition-colors">Ativar</button>
              : <>
                  <button onClick={() => { setPlanId(sub.plan?.id ?? plans[0]?.id ?? ""); setModal("plan"); }} className="rounded border border-blue-500/40 px-2 py-1 text-[11px] font-medium text-blue-400 hover:bg-blue-500/10 transition-colors">Plano</button>
                  <button onClick={() => setModal("cancel")} className="rounded border border-orange-500/40 px-2 py-1 text-[11px] font-medium text-orange-400 hover:bg-orange-500/10 transition-colors">Desativar</button>
                </>
            }
            <button
              onClick={() => act(async () => {
                const r = await apiFetch(`/admin/organizations/${org.id}/resend-invitation`, { method: "POST" }) as { message: string } | null;
                setMsg({ text: r?.message ?? "Convite reenviado.", ok: true });
              })}
              className="rounded border border-border px-2 py-1 text-[11px] font-medium text-muted-foreground hover:bg-accent transition-colors"
            >
              Reenviar
            </button>
            <button
              onClick={() => setModal("delete")}
              className="rounded border border-destructive/40 px-2 py-1 text-[11px] font-medium text-destructive hover:bg-destructive/10 transition-colors"
            >
              Apagar
            </button>
          </div>
        </td>
      </tr>

      {msg && (
        <tr>
          <td colSpan={8} className="px-4 pb-2 pt-0">
            <p className={cn("text-[11px]", msg.ok ? "text-green-400" : "text-destructive")}>{msg.text}</p>
          </td>
        </tr>
      )}

      {expanded && (
        <tr>
          <td colSpan={8} className="bg-muted/10 px-4 py-3">
            <div className="space-y-3">
              {sub && (
                <div className="rounded-lg border border-border bg-card p-3 text-xs">
                  <p className="font-semibold text-foreground mb-2">Assinatura</p>
                  <div className="grid grid-cols-2 gap-x-8 gap-y-1">
                    {[
                      ["ID", sub.id],
                      ["Gateway Sub ID", sub.gateway_subscription_id ?? "—"],
                      ["Intervalo", sub.billing_interval],
                      ["Início", fmtDate(sub.current_period_start)],
                      ["Fim", fmtDate(sub.current_period_end)],
                      ["Trial até", fmtDate(sub.trial_end)],
                      ["Cancelado em", fmtDate(sub.cancelled_at)],
                      ["Cancel no fim", sub.cancel_at_period_end ? "Sim" : "Não"],
                    ].map(([l, v]) => (
                      <><span key={`l-${l}`} className="text-muted-foreground">{l}</span><span key={`v-${l}`} className="font-mono text-[11px]">{v}</span></>
                    ))}
                  </div>
                  {Object.keys(sub.metadata).length > 0 && (
                    <pre className="mt-2 rounded bg-muted p-2 text-[10px] overflow-x-auto">{JSON.stringify(sub.metadata, null, 2)}</pre>
                  )}
                </div>
              )}

              <div className="rounded-lg border border-border bg-card overflow-hidden">
                <p className="border-b border-border px-3 py-2 text-[11px] font-semibold text-foreground">
                  Eventos ({org.billing_events.length})
                </p>
                {org.billing_events.length === 0
                  ? <p className="p-3 text-xs text-muted-foreground">Nenhum evento.</p>
                  : <table className="w-full text-xs">
                      <thead>
                        <tr className="border-b border-border bg-muted/30">
                          {["Data", "Tipo", "Gateway", "Status", "Erro"].map(h => (
                            <th key={h} className="px-3 py-1.5 text-left text-[10px] font-medium uppercase tracking-wider text-muted-foreground">{h}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-border">
                        {org.billing_events.map(ev => {
                          const s = EVENT_STATUS[ev.status] ?? { text: ev.status, cls: "text-muted-foreground border-border" };
                          return (
                            <tr key={ev.id} className="hover:bg-muted/20">
                              <td className="px-3 py-1.5 whitespace-nowrap">{fmtDateTime(ev.created_at)}</td>
                              <td className="px-3 py-1.5">{ev.event_type.replace(/_/g, " ")}</td>
                              <td className="px-3 py-1.5 capitalize">{ev.gateway ?? "—"}</td>
                              <td className="px-3 py-1.5"><span className={cn("rounded border px-1.5 py-0.5 text-[10px] font-semibold", s.cls)}>{s.text}</span></td>
                              <td className="px-3 py-1.5 text-destructive text-[10px] max-w-[200px] truncate">{ev.error_message ?? "—"}</td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                }
              </div>
            </div>
          </td>
        </tr>
      )}

      {modal === "activate" && (
        <Modal title="Ativar assinatura manual" onClose={() => setModal(null)} onConfirm={() => act(() => apiFetch(`/admin/organizations/${org.id}/subscriptions`, { method: "POST", body: JSON.stringify({ plan_id: planId, billing_interval: interval }) }).then(() => {}))} loading={busy}>
          <div className="space-y-2">
            <label className="block text-xs text-muted-foreground">Plano</label>
            <select value={planId} onChange={e => setPlanId(e.target.value)} className="w-full rounded-lg border border-border bg-muted px-3 py-2 text-xs text-foreground">
              {plans.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          </div>
          <div className="space-y-2">
            <label className="block text-xs text-muted-foreground">Intervalo</label>
            <select value={interval} onChange={e => setInterval(e.target.value)} className="w-full rounded-lg border border-border bg-muted px-3 py-2 text-xs text-foreground">
              {["manual", "monthly", "yearly", "lifetime"].map(i => <option key={i} value={i}>{i}</option>)}
            </select>
          </div>
          {msg && !msg.ok && <p className="text-[11px] text-destructive">{msg.text}</p>}
        </Modal>
      )}

      {modal === "plan" && sub && (
        <Modal title="Mudar plano" onClose={() => setModal(null)} onConfirm={() => act(() => apiFetch(`/admin/subscriptions/${sub.id}`, { method: "PATCH", body: JSON.stringify({ plan_id: planId }) }).then(() => {}))} loading={busy}>
          <div className="space-y-2">
            <label className="block text-xs text-muted-foreground">Novo plano</label>
            <select value={planId} onChange={e => setPlanId(e.target.value)} className="w-full rounded-lg border border-border bg-muted px-3 py-2 text-xs text-foreground">
              {plans.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          </div>
          {msg && !msg.ok && <p className="text-[11px] text-destructive">{msg.text}</p>}
        </Modal>
      )}

      {modal === "cancel" && sub && (
        <Modal title="Cancelar assinatura" onClose={() => setModal(null)} onConfirm={() => act(() => apiFetch(`/admin/subscriptions/${sub.id}`, { method: "DELETE" }).then(() => {}))} loading={busy}>
          <p className="text-xs text-muted-foreground">
            Cancelar a assinatura de <strong className="text-foreground">{org.name}</strong> imediatamente?
          </p>
          {msg && !msg.ok && <p className="text-[11px] text-destructive">{msg.text}</p>}
        </Modal>
      )}

      {modal === "delete" && (
        <Modal title="Apagar organização" onClose={() => setModal(null)} onConfirm={() => act(() => apiFetch(`/admin/organizations/${org.id}`, { method: "DELETE" }).then(() => {}))} loading={busy}>
          <p className="text-xs text-muted-foreground">
            Apagar <strong className="text-foreground">{org.name}</strong> permanentemente?
            Isso remove a organização e todos os dados associados. Não tem volta.
          </p>
          {msg && !msg.ok && <p className="text-[11px] text-destructive">{msg.text}</p>}
        </Modal>
      )}
    </>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function AdminPage() {
  const router = useRouter();
  const [orgs, setOrgs] = useState<OrgRow[]>([]);
  const [plans, setPlans] = useState<Plan[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = () => {
    setLoading(true);
    setError(null);
    apiFetch("/admin/organizations")
      .then((res) => {
        const d = res as { orgs: OrgRow[]; plans: Plan[] } | null;
        if (!d || !Array.isArray(d.orgs) || !Array.isArray(d.plans)) {
          throw new Error("Resposta inesperada da API.");
        }
        setOrgs(d.orgs.filter(Boolean));
        setPlans(d.plans.filter(Boolean));
        setLoading(false);
      })
      .catch((err: Error) => {
        if (err.message.includes("403") || err.message.toLowerCase().includes("restrito")) {
          router.replace("/inbox");
          return;
        }
        setError(err.message);
        setLoading(false);
      });
  };

  useEffect(() => { load(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  if (loading) {
    return (
      <div className="flex items-center justify-center py-24">
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="mx-auto max-w-xl pt-6">
        <div className="rounded-xl border border-destructive/30 bg-destructive/5 p-5">
          <p className="text-sm font-medium text-destructive">Erro ao carregar</p>
          <p className="text-xs text-muted-foreground mt-1">{error}</p>
          <button onClick={load} className="mt-3 flex items-center gap-1.5 rounded-lg border border-border bg-card px-3 py-1.5 text-xs font-medium text-foreground hover:bg-accent transition-colors">
            <RefreshCw className="h-3 w-3" /> Tentar novamente
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-6xl space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-lg font-semibold text-foreground">Admin — Organizações</h1>
          <p className="text-xs text-muted-foreground mt-0.5">{orgs.length} organização{orgs.length !== 1 ? "s" : ""}</p>
        </div>
        <button onClick={load} className="flex items-center gap-1.5 rounded-lg border border-border bg-card px-3 py-1.5 text-xs font-medium text-foreground hover:bg-accent transition-colors">
          <RefreshCw className="h-3 w-3" /> Atualizar
        </button>
      </div>

      <div className="rounded-xl border border-border bg-card overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-border bg-muted/30">
                <th className="w-6 px-4 py-2.5" />
                {["Organização", "Owner", "Plano", "Status", "Gateway", "Vencimento", "Ações"].map(h => (
                  <th key={h} className="px-4 py-2.5 text-left text-[10px] font-medium uppercase tracking-wider text-muted-foreground whitespace-nowrap">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {orgs.map(org => (
                <OrgRow key={org.id} org={org} plans={plans} onRefresh={load} />
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
