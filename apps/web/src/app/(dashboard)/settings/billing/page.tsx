"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useOrganization } from "@/providers/organization-provider";
import { apiFetch } from "@/lib/api";
import { CreditCard, CheckCircle, AlertTriangle, Clock, Activity, Receipt, LayoutGrid } from "lucide-react";
import { cn } from "@/lib/utils";
import type { Subscription, Plan, BillingEvent } from "@aula-agente/shared";

interface BillingData {
  subscription: Subscription | null;
  plan: Plan | null;
  usage: { agents_used: number; members_used: number; instances_used: number };
  limits: { max_agents: number; max_members: number; max_instances: number } | null;
  recentEvents: BillingEvent[];
}

const STATUS_CONFIG: Record<string, { label: string; color: string }> = {
  active:    { label: "Ativa",              color: "text-green-400 bg-green-400/10 border-green-400/30" },
  trial:     { label: "Trial",              color: "text-blue-400 bg-blue-400/10 border-blue-400/30" },
  past_due:  { label: "Pagamento Pendente", color: "text-amber-400 bg-amber-400/10 border-amber-400/30" },
  paused:    { label: "Pausada",            color: "text-orange-400 bg-orange-400/10 border-orange-400/30" },
  cancelled: { label: "Cancelada",          color: "text-destructive bg-destructive/10 border-destructive/30" },
};

const EVENT_STATUS_CONFIG: Record<string, { label: string; color: string }> = {
  processed:  { label: "Processado", color: "text-green-400 bg-green-400/10 border-green-400/30" },
  pending:    { label: "Pendente",   color: "text-amber-400 bg-amber-400/10 border-amber-400/30" },
  processing: { label: "Processando", color: "text-amber-400 bg-amber-400/10 border-amber-400/30" },
  failed:     { label: "Falhou",     color: "text-destructive bg-destructive/10 border-destructive/30" },
  ignored:    { label: "Ignorado",   color: "text-muted-foreground bg-muted border-border" },
};

function formatDate(iso: string | null) {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("pt-BR", { day: "2-digit", month: "short", year: "numeric" });
}

function formatDateTime(iso: string) {
  return new Date(iso).toLocaleString("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function formatCurrency(value: number) {
  return new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(value);
}

function UsageBar({ used, max, label }: { used: number; max: number; label: string }) {
  const pct = max > 0 ? Math.min(100, Math.round((used / max) * 100)) : 0;
  const barColor =
    pct >= 100
      ? "bg-destructive"
      : pct >= 80
        ? "bg-amber-fire-400"
        : "bg-blue-electric-400";

  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between">
        <span className="text-xs font-medium text-foreground">{label}</span>
        <span className="text-xs text-muted-foreground">{pct}%</span>
      </div>
      <div className="h-2 rounded-full bg-muted overflow-hidden">
        <div
          className={cn("h-full rounded-full transition-all", barColor)}
          style={{ width: `${pct}%` }}
        />
      </div>
      <p className="text-xs text-muted-foreground">
        {used} / {max} {label.toLowerCase()}
      </p>
    </div>
  );
}

export default function BillingPage() {
  const { currentOrg, loading: orgLoading } = useOrganization();
  const [data, setData] = useState<BillingData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (orgLoading) return;
    if (!currentOrg) {
      setLoading(false);
      return;
    }

    setLoading(true);
    apiFetch("/billing/subscription", {
      headers: { "x-organization-id": currentOrg.id },
    })
      .then((res) => {
        setData(res as BillingData);
        setLoading(false);
      })
      .catch((err: Error) => {
        setError(err.message);
        setLoading(false);
      });
  }, [currentOrg, orgLoading]);

  if (loading || orgLoading) {
    return (
      <div className="mx-auto max-w-2xl space-y-6">
        <div className="h-7 w-36 animate-pulse rounded-lg bg-muted" />
        <div className="rounded-xl border border-border bg-card overflow-hidden">
          <div className="border-b border-border px-6 py-4">
            <div className="h-4 w-24 animate-pulse rounded bg-muted" />
          </div>
          <div className="p-6 space-y-4">
            {[...Array(5)].map((_, i) => (
              <div key={i} className="h-5 animate-pulse rounded bg-muted" />
            ))}
          </div>
        </div>
        <div className="rounded-xl border border-border bg-card overflow-hidden">
          <div className="border-b border-border px-6 py-4">
            <div className="h-4 w-28 animate-pulse rounded bg-muted" />
          </div>
          <div className="p-6 space-y-4">
            {[...Array(3)].map((_, i) => (
              <div key={i} className="h-8 animate-pulse rounded bg-muted" />
            ))}
          </div>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="mx-auto max-w-2xl">
        <div className="rounded-xl border border-border bg-card p-6 flex items-center gap-2 text-destructive">
          <AlertTriangle className="h-4 w-4 shrink-0" />
          <p className="text-sm">{error}</p>
        </div>
      </div>
    );
  }

  const sub = data?.subscription ?? null;
  const plan = data?.plan ?? null;
  const usage = data?.usage ?? { agents_used: 0, members_used: 0, instances_used: 0 };
  const limits = data?.limits ?? null;
  const recentEvents = data?.recentEvents ?? [];
  const statusConfig = STATUS_CONFIG[sub?.status ?? ""] ?? null;

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold text-foreground">Assinatura</h1>
          <p className="text-xs text-muted-foreground mt-0.5">Detalhes do seu plano atual</p>
        </div>
        <Link
          href="/settings/billing/plans"
          className="shrink-0 flex items-center gap-1.5 rounded-lg border border-border bg-card px-3 py-2 text-xs font-medium text-foreground transition-colors hover:bg-accent"
        >
          <LayoutGrid className="h-3.5 w-3.5 text-blue-electric-400" />
          Ver planos disponíveis
        </Link>
      </div>

      {/* Plan Card */}
      <div className="rounded-xl border border-border bg-card overflow-hidden">
        <div className="flex items-center gap-2 border-b border-border px-6 py-4">
          <CreditCard className="h-4 w-4 text-blue-electric-400" />
          <h2 className="text-sm font-semibold text-foreground">Plano atual</h2>
        </div>

        {!sub ? (
          <div className="p-6 space-y-3">
            <div className="flex items-center gap-2 text-muted-foreground">
              <AlertTriangle className="h-4 w-4" />
              <p className="text-sm">Nenhuma assinatura encontrada.</p>
            </div>
            <p className="text-xs text-muted-foreground">
              Se você acabou de comprar, aguarde alguns instantes — o onboarding é processado automaticamente.
            </p>
          </div>
        ) : (
          <div className="p-6 space-y-5">
            {/* Plan name + status */}
            <div className="flex items-center justify-between">
              <div>
                <p className="text-lg font-semibold text-foreground">{plan?.name ?? "—"}</p>
                <p className="text-xs text-muted-foreground mt-0.5">
                  {sub.billing_interval === "monthly" && "Cobrança mensal"}
                  {sub.billing_interval === "yearly" && "Cobrança anual"}
                  {sub.billing_interval === "lifetime" && "Acesso vitalício"}
                  {sub.billing_interval === "manual" && "Plano manual"}
                </p>
              </div>
              {statusConfig && (
                <span className={cn("rounded-md border px-2.5 py-0.5 text-xs font-semibold", statusConfig.color)}>
                  {statusConfig.label}
                </span>
              )}
            </div>

            {/* Price */}
            {plan && (
              <div className="rounded-lg bg-muted p-4 flex items-center justify-between">
                <span className="text-sm text-muted-foreground">Valor</span>
                <span className="text-sm font-semibold text-foreground">
                  {sub.billing_interval === "yearly"
                    ? formatCurrency(plan.price_yearly) + "/ano"
                    : sub.billing_interval === "monthly"
                      ? formatCurrency(plan.price_monthly) + "/mês"
                      : "—"}
                </span>
              </div>
            )}

            {/* Limits */}
            {plan && (
              <div className="space-y-2">
                <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">Limites do plano</p>
                <div className="grid grid-cols-3 gap-3">
                  {[
                    { label: "Agentes", value: plan.max_agents },
                    { label: "Instâncias", value: plan.max_instances },
                    { label: "Membros", value: plan.max_members },
                  ].map((item) => (
                    <div key={item.label} className="rounded-lg border border-border bg-muted/50 p-3 text-center">
                      <p className="text-lg font-bold text-foreground">{item.value}</p>
                      <p className="text-[11px] text-muted-foreground">{item.label}</p>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Current usage */}
            {limits && (
              <div className="space-y-3">
                <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">Utilização atual</p>
                <div className="space-y-4">
                  <UsageBar used={usage.agents_used} max={limits.max_agents} label="Agentes" />
                  <UsageBar used={usage.members_used} max={limits.max_members} label="Membros" />
                  <UsageBar used={usage.instances_used} max={limits.max_instances} label="Instâncias WhatsApp" />
                </div>
              </div>
            )}

            {/* Billing period */}
            {(sub.current_period_start || sub.current_period_end) && (
              <div className="space-y-2">
                <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">Período atual</p>
                <div className="flex items-center gap-2 text-sm text-foreground">
                  <Clock className="h-3.5 w-3.5 text-muted-foreground" />
                  <span>{formatDate(sub.current_period_start)}</span>
                  <span className="text-muted-foreground">→</span>
                  <span>{formatDate(sub.current_period_end)}</span>
                </div>
              </div>
            )}

            {/* Features */}
            {plan && plan.features.length > 0 && (
              <div className="space-y-2">
                <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">Recursos incluídos</p>
                <ul className="space-y-1">
                  {plan.features.map((f) => (
                    <li key={f} className="flex items-center gap-2 text-sm text-foreground">
                      <CheckCircle className="h-3.5 w-3.5 text-green-400 shrink-0" />
                      <span className="capitalize">{f.replace(/_/g, " ")}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {/* Gateway info */}
            {sub.gateway && (
              <p className="text-xs text-muted-foreground">
                Gateway: <span className="capitalize font-medium">{sub.gateway}</span>
                {sub.gateway_subscription_id && (
                  <> &middot; ID: <span className="font-mono">{sub.gateway_subscription_id}</span></>
                )}
              </p>
            )}

            {/* Organization ID */}
            {currentOrg && (
              <p className="text-xs text-muted-foreground border-t border-border pt-4">
                ID da Organização:{" "}
                <span className="font-mono">{currentOrg.id}</span>
              </p>
            )}
          </div>
        )}
      </div>

      {/* Usage card — shown even when there's no subscription */}
      {!sub && limits && (
        <div className="rounded-xl border border-border bg-card overflow-hidden">
          <div className="flex items-center gap-2 border-b border-border px-6 py-4">
            <Activity className="h-4 w-4 text-blue-electric-400" />
            <h2 className="text-sm font-semibold text-foreground">Utilização atual</h2>
          </div>
          <div className="p-6 space-y-4">
            <UsageBar used={usage.agents_used} max={limits.max_agents} label="Agentes" />
            <UsageBar used={usage.members_used} max={limits.max_members} label="Membros" />
            <UsageBar used={usage.instances_used} max={limits.max_instances} label="Instâncias WhatsApp" />
          </div>
        </div>
      )}

      {/* Billing events */}
      <div className="rounded-xl border border-border bg-card overflow-hidden">
        <div className="flex items-center gap-2 border-b border-border px-6 py-4">
          <Receipt className="h-4 w-4 text-blue-electric-400" />
          <h2 className="text-sm font-semibold text-foreground">Histórico de billing</h2>
        </div>

        {recentEvents.length === 0 ? (
          <div className="p-6">
            <p className="text-sm text-muted-foreground">Nenhum evento de billing registrado.</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border bg-muted/30">
                  <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-muted-foreground">
                    Data
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-muted-foreground">
                    Gateway
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-muted-foreground">
                    Tipo
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-muted-foreground">
                    Status
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {recentEvents.map((evt) => {
                  const evtStatus = EVENT_STATUS_CONFIG[evt.status] ?? { label: evt.status, color: "text-muted-foreground bg-muted border-border" };
                  return (
                    <tr key={evt.id} className="hover:bg-muted/20 transition-colors">
                      <td className="px-4 py-3 text-foreground whitespace-nowrap">
                        {formatDateTime(evt.created_at)}
                      </td>
                      <td className="px-4 py-3 text-foreground capitalize">
                        {evt.gateway}
                      </td>
                      <td className="px-4 py-3 text-foreground">
                        {evt.event_type.replace(/_/g, " ")}
                      </td>
                      <td className="px-4 py-3">
                        <span className={cn("rounded-md border px-2 py-0.5 text-xs font-semibold", evtStatus.color)}>
                          {evtStatus.label}
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
