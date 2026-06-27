"use client";

import { useState } from "react";
import { ChevronDown, ChevronRight, RefreshCw, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { apiFetch } from "@/lib/api";
import type { Plan } from "@aula-agente/shared";

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
  plan: {
    id: string;
    name: string;
    slug: string;
    price_monthly: number;
    price_yearly: number;
    max_agents: number;
    max_members: number;
    max_instances: number;
  } | null;
}

interface BillingEventRow {
  id: string;
  event_type: string;
  status: string;
  gateway: string | null;
  created_at: string;
  error_message: string | null;
}

export interface AdminOrgRow {
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

interface AdminPanelProps {
  orgs: AdminOrgRow[];
  plans: Plan[];
  onRefresh: () => void;
}

const STATUS_LABEL: Record<string, { text: string; cls: string }> = {
  active:    { text: "Ativa",     cls: "text-green-400 bg-green-400/10 border-green-400/30" },
  trial:     { text: "Trial",    cls: "text-blue-400 bg-blue-400/10 border-blue-400/30" },
  past_due:  { text: "Pendente", cls: "text-amber-400 bg-amber-400/10 border-amber-400/30" },
  paused:    { text: "Pausada",  cls: "text-orange-400 bg-orange-400/10 border-orange-400/30" },
  cancelled: { text: "Cancelada",cls: "text-red-400 bg-red-400/10 border-red-400/30" },
};

const EVENT_STATUS_LABEL: Record<string, { text: string; cls: string }> = {
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
  return new Date(iso).toLocaleString("pt-BR", {
    day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit",
  });
}

function ActionModal({
  title,
  onClose,
  onConfirm,
  loading,
  children,
}: {
  title: string;
  onClose: () => void;
  onConfirm: () => void;
  loading: boolean;
  children: React.ReactNode;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60">
      <div className="w-full max-w-sm rounded-xl border border-border bg-card p-5 shadow-xl">
        <h3 className="mb-4 text-sm font-semibold text-foreground">{title}</h3>
        <div className="space-y-3">{children}</div>
        <div className="mt-5 flex justify-end gap-2">
          <button
            onClick={onClose}
            className="rounded-lg border border-border px-3 py-1.5 text-xs font-medium text-muted-foreground hover:bg-accent transition-colors"
          >
            Cancelar
          </button>
          <button
            onClick={onConfirm}
            disabled={loading}
            className="flex items-center gap-1.5 rounded-lg bg-foreground px-3 py-1.5 text-xs font-medium text-background hover:opacity-80 transition-opacity disabled:opacity-50"
          >
            {loading && <Loader2 className="h-3 w-3 animate-spin" />}
            Confirmar
          </button>
        </div>
      </div>
    </div>
  );
}

function OrgRow({ org, plans, onRefresh }: { org: AdminOrgRow; plans: Plan[]; onRefresh: () => void }) {
  const [expanded, setExpanded] = useState(false);
  const [modal, setModal] = useState<"activate" | "change-plan" | "cancel" | null>(null);
  const [modalLoading, setModalLoading] = useState(false);
  const [selectedPlan, setSelectedPlan] = useState<string>((plans ?? [])[0]?.id ?? "");
  const [selectedInterval, setSelectedInterval] = useState("manual");
  const [actionError, setActionError] = useState<string | null>(null);
  const [actionSuccess, setActionSuccess] = useState<string | null>(null);

  const sub = org.subscription;
  const statusCfg = STATUS_LABEL[sub?.status ?? ""] ?? null;

  const clearFeedback = () => {
    setActionError(null);
    setActionSuccess(null);
  };

  const handleActivate = async () => {
    setModalLoading(true);
    try {
      await apiFetch(`/admin/organizations/${org.id}/subscriptions`, {
        method: "POST",
        body: JSON.stringify({ plan_id: selectedPlan, billing_interval: selectedInterval }),
      });
      setModal(null);
      setActionSuccess("Assinatura criada com sucesso.");
      onRefresh();
    } catch (e) {
      setActionError((e as Error).message);
    } finally {
      setModalLoading(false);
    }
  };

  const handleChangePlan = async () => {
    if (!sub) return;
    setModalLoading(true);
    try {
      await apiFetch(`/admin/subscriptions/${sub.id}`, {
        method: "PATCH",
        body: JSON.stringify({ plan_id: selectedPlan }),
      });
      setModal(null);
      setActionSuccess("Plano atualizado.");
      onRefresh();
    } catch (e) {
      setActionError((e as Error).message);
    } finally {
      setModalLoading(false);
    }
  };

  const handleCancel = async () => {
    if (!sub) return;
    setModalLoading(true);
    try {
      await apiFetch(`/admin/subscriptions/${sub.id}`, { method: "DELETE" });
      setModal(null);
      setActionSuccess("Assinatura cancelada.");
      onRefresh();
    } catch (e) {
      setActionError((e as Error).message);
    } finally {
      setModalLoading(false);
    }
  };

  const handleResend = async () => {
    clearFeedback();
    try {
      const res = await apiFetch(`/admin/organizations/${org.id}/resend-invitation`, {
        method: "POST",
      }) as { message: string };
      setActionSuccess(res.message);
    } catch (e) {
      setActionError((e as Error).message);
    }
  };

  return (
    <>
      <tr
        className="cursor-pointer hover:bg-muted/20 transition-colors"
        onClick={() => { setExpanded((v) => !v); clearFeedback(); }}
      >
        <td className="px-4 py-3">
          {expanded
            ? <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" />
            : <ChevronRight className="h-3.5 w-3.5 text-muted-foreground" />}
        </td>
        <td className="px-4 py-3">
          <p className="text-xs font-medium text-foreground">{org.name}</p>
          <p className="text-[11px] text-muted-foreground font-mono">{org.slug}</p>
        </td>
        <td className="px-4 py-3 text-xs text-muted-foreground">{org.owner_email ?? "—"}</td>
        <td className="px-4 py-3 text-xs text-foreground">{sub?.plan?.name ?? "—"}</td>
        <td className="px-4 py-3">
          {statusCfg ? (
            <span className={cn("rounded border px-2 py-0.5 text-[11px] font-semibold", statusCfg.cls)}>
              {statusCfg.text}
            </span>
          ) : (
            <span className="text-xs text-muted-foreground">Sem assinatura</span>
          )}
        </td>
        <td className="px-4 py-3 text-xs text-foreground capitalize">{sub?.gateway ?? "—"}</td>
        <td className="px-4 py-3 text-xs text-foreground">{fmtDate(sub?.current_period_end ?? null)}</td>
        <td className="px-4 py-3">
          <div className="flex items-center gap-1.5" onClick={(e) => e.stopPropagation()}>
            {!sub ? (
              <button
                onClick={() => { clearFeedback(); setSelectedPlan(plans[0]?.id ?? ""); setSelectedInterval("manual"); setModal("activate"); }}
                className="rounded border border-green-500/40 px-2 py-1 text-[11px] font-medium text-green-400 hover:bg-green-500/10 transition-colors"
              >
                Ativar
              </button>
            ) : (
              <>
                <button
                  onClick={() => { clearFeedback(); setSelectedPlan(sub.plan?.id ?? plans[0]?.id ?? ""); setModal("change-plan"); }}
                  className="rounded border border-blue-500/40 px-2 py-1 text-[11px] font-medium text-blue-400 hover:bg-blue-500/10 transition-colors"
                >
                  Plano
                </button>
                <button
                  onClick={() => { clearFeedback(); setModal("cancel"); }}
                  className="rounded border border-destructive/40 px-2 py-1 text-[11px] font-medium text-destructive hover:bg-destructive/10 transition-colors"
                >
                  Cancelar
                </button>
              </>
            )}
            <button
              onClick={() => { clearFeedback(); void handleResend(); }}
              className="rounded border border-border px-2 py-1 text-[11px] font-medium text-muted-foreground hover:bg-accent transition-colors"
            >
              Reenviar
            </button>
          </div>
        </td>
      </tr>

      {(actionError ?? actionSuccess) && (
        <tr>
          <td colSpan={8} className="px-4 pb-2 pt-0">
            <p className={cn("text-[11px]", actionError ? "text-destructive" : "text-green-400")}>
              {actionError ?? actionSuccess}
            </p>
          </td>
        </tr>
      )}

      {expanded && (
        <tr>
          <td colSpan={8} className="bg-muted/10 px-4 py-3">
            <div className="space-y-3">
              {sub && (
                <div className="rounded-lg border border-border bg-card p-3 text-xs space-y-1">
                  <p className="font-semibold text-foreground mb-2">Assinatura</p>
                  <div className="grid grid-cols-2 gap-x-8 gap-y-1">
                    <span className="text-muted-foreground">ID</span>
                    <span className="font-mono text-[11px]">{sub.id}</span>
                    <span className="text-muted-foreground">Gateway Sub ID</span>
                    <span className="font-mono text-[11px]">{sub.gateway_subscription_id ?? "—"}</span>
                    <span className="text-muted-foreground">Intervalo</span>
                    <span>{sub.billing_interval}</span>
                    <span className="text-muted-foreground">Início</span>
                    <span>{fmtDate(sub.current_period_start)}</span>
                    <span className="text-muted-foreground">Fim</span>
                    <span>{fmtDate(sub.current_period_end)}</span>
                    <span className="text-muted-foreground">Trial até</span>
                    <span>{fmtDate(sub.trial_end)}</span>
                    <span className="text-muted-foreground">Cancelado em</span>
                    <span>{fmtDate(sub.cancelled_at)}</span>
                    <span className="text-muted-foreground">Cancel no fim</span>
                    <span>{sub.cancel_at_period_end ? "Sim" : "Não"}</span>
                  </div>
                  {Object.keys(sub.metadata).length > 0 && (
                    <div className="mt-2">
                      <p className="text-muted-foreground mb-1">Metadata</p>
                      <pre className="rounded bg-muted p-2 text-[10px] overflow-x-auto">
                        {JSON.stringify(sub.metadata, null, 2)}
                      </pre>
                    </div>
                  )}
                </div>
              )}

              <div className="rounded-lg border border-border bg-card overflow-hidden">
                <p className="border-b border-border px-3 py-2 text-[11px] font-semibold text-foreground">
                  Últimos eventos ({org.billing_events.length})
                </p>
                {org.billing_events.length === 0 ? (
                  <p className="p-3 text-xs text-muted-foreground">Nenhum evento.</p>
                ) : (
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="border-b border-border bg-muted/30">
                        {["Data", "Tipo", "Gateway", "Status", "Erro"].map((h) => (
                          <th
                            key={h}
                            className="px-3 py-1.5 text-left text-[10px] font-medium uppercase tracking-wider text-muted-foreground"
                          >
                            {h}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border">
                      {org.billing_events.map((ev) => {
                        const s = EVENT_STATUS_LABEL[ev.status] ?? {
                          text: ev.status,
                          cls: "text-muted-foreground border-border",
                        };
                        return (
                          <tr key={ev.id} className="hover:bg-muted/20">
                            <td className="px-3 py-1.5 whitespace-nowrap">{fmtDateTime(ev.created_at)}</td>
                            <td className="px-3 py-1.5">{ev.event_type.replace(/_/g, " ")}</td>
                            <td className="px-3 py-1.5 capitalize">{ev.gateway ?? "—"}</td>
                            <td className="px-3 py-1.5">
                              <span className={cn("rounded border px-1.5 py-0.5 text-[10px] font-semibold", s.cls)}>
                                {s.text}
                              </span>
                            </td>
                            <td className="px-3 py-1.5 text-destructive text-[10px] max-w-[200px] truncate">
                              {ev.error_message ?? "—"}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                )}
              </div>
            </div>
          </td>
        </tr>
      )}

      {modal === "activate" && (
        <ActionModal
          title="Ativar assinatura manual"
          onClose={() => setModal(null)}
          onConfirm={() => { void handleActivate(); }}
          loading={modalLoading}
        >
          <div className="space-y-2">
            <label className="block text-xs text-muted-foreground">Plano</label>
            <select
              value={selectedPlan}
              onChange={(e) => setSelectedPlan(e.target.value)}
              className="w-full rounded-lg border border-border bg-muted px-3 py-2 text-xs text-foreground"
            >
              {plans.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          </div>
          <div className="space-y-2">
            <label className="block text-xs text-muted-foreground">Intervalo</label>
            <select
              value={selectedInterval}
              onChange={(e) => setSelectedInterval(e.target.value)}
              className="w-full rounded-lg border border-border bg-muted px-3 py-2 text-xs text-foreground"
            >
              {["manual", "monthly", "yearly", "lifetime"].map((i) => (
                <option key={i} value={i}>{i}</option>
              ))}
            </select>
          </div>
          {actionError && <p className="text-[11px] text-destructive">{actionError}</p>}
        </ActionModal>
      )}

      {modal === "change-plan" && (
        <ActionModal
          title="Mudar plano"
          onClose={() => setModal(null)}
          onConfirm={() => { void handleChangePlan(); }}
          loading={modalLoading}
        >
          <div className="space-y-2">
            <label className="block text-xs text-muted-foreground">Novo plano</label>
            <select
              value={selectedPlan}
              onChange={(e) => setSelectedPlan(e.target.value)}
              className="w-full rounded-lg border border-border bg-muted px-3 py-2 text-xs text-foreground"
            >
              {plans.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          </div>
          {actionError && <p className="text-[11px] text-destructive">{actionError}</p>}
        </ActionModal>
      )}

      {modal === "cancel" && (
        <ActionModal
          title="Cancelar assinatura"
          onClose={() => setModal(null)}
          onConfirm={() => { void handleCancel(); }}
          loading={modalLoading}
        >
          <p className="text-xs text-muted-foreground">
            Tem certeza que deseja cancelar a assinatura de{" "}
            <strong className="text-foreground">{org.name}</strong>?
            Esta ação define status = "cancelled" imediatamente.
          </p>
          {actionError && <p className="text-[11px] text-destructive">{actionError}</p>}
        </ActionModal>
      )}
    </>
  );
}

export function AdminPanel({ orgs, plans, onRefresh }: AdminPanelProps) {
  const safeOrgs = (orgs ?? []).filter((o): o is AdminOrgRow => !!o);
  const safePlans = (plans ?? []).filter((p): p is Plan => !!p);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-sm font-semibold text-foreground">Todas as organizações</h2>
          <p className="text-xs text-muted-foreground mt-0.5">
            {safeOrgs.length} organização{safeOrgs.length !== 1 ? "s" : ""}
          </p>
        </div>
        <button
          onClick={onRefresh}
          className="flex items-center gap-1.5 rounded-lg border border-border bg-card px-3 py-1.5 text-xs font-medium text-foreground hover:bg-accent transition-colors"
        >
          <RefreshCw className="h-3 w-3" /> Atualizar
        </button>
      </div>

      <div className="rounded-xl border border-border bg-card overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-border bg-muted/30">
                <th className="w-6 px-4 py-2.5" />
                {["Organização", "Owner", "Plano", "Status", "Gateway", "Vencimento", "Ações"].map((h) => (
                  <th
                    key={h}
                    className="px-4 py-2.5 text-left text-[10px] font-medium uppercase tracking-wider text-muted-foreground whitespace-nowrap"
                  >
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {safeOrgs.map((org) => (
                <OrgRow key={org.id} org={org} plans={safePlans} onRefresh={onRefresh} />
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
