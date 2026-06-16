"use client";

import { useEffect, useState } from "react";
import { useOrganization } from "@/providers/organization-provider";
import { createClient } from "@/lib/supabase/client";
import { CreditCard, CheckCircle, AlertTriangle, Clock } from "lucide-react";
import { cn } from "@/lib/utils";
import type { Subscription, Plan } from "@aula-agente/shared";

type SubscriptionWithPlan = Subscription & { plans: Plan };

const STATUS_CONFIG: Record<string, { label: string; color: string }> = {
  active:    { label: "Ativa",           color: "text-green-400 bg-green-400/10 border-green-400/30" },
  trial:     { label: "Trial",           color: "text-blue-400 bg-blue-400/10 border-blue-400/30" },
  past_due:  { label: "Pagamento Pendente", color: "text-amber-400 bg-amber-400/10 border-amber-400/30" },
  paused:    { label: "Pausada",         color: "text-orange-400 bg-orange-400/10 border-orange-400/30" },
  cancelled: { label: "Cancelada",       color: "text-destructive bg-destructive/10 border-destructive/30" },
};

function formatDate(iso: string | null) {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("pt-BR", { day: "2-digit", month: "short", year: "numeric" });
}

function formatCurrency(value: number) {
  return new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(value);
}

export default function BillingPage() {
  const { currentOrg } = useOrganization();
  const [sub, setSub] = useState<SubscriptionWithPlan | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!currentOrg) return;
    const supabase = createClient();
    supabase
      .from("subscriptions")
      .select("*, plans(*)")
      .eq("organization_id", currentOrg.id)
      .maybeSingle()
      .then(({ data }) => {
        setSub(data as SubscriptionWithPlan | null);
        setLoading(false);
      });
  }, [currentOrg]);

  if (loading) {
    return (
      <div className="mx-auto max-w-2xl space-y-6">
        <div className="h-7 w-36 animate-pulse rounded-lg bg-muted" />
        <div className="rounded-xl border border-border bg-card p-6 space-y-4">
          {[...Array(4)].map((_, i) => (
            <div key={i} className="h-5 animate-pulse rounded bg-muted" />
          ))}
        </div>
      </div>
    );
  }

  const plan = sub?.plans;
  const statusConfig = STATUS_CONFIG[sub?.status ?? ""] ?? null;

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <div>
        <h1 className="text-xl font-semibold text-foreground">Assinatura</h1>
        <p className="text-xs text-muted-foreground mt-0.5">Detalhes do seu plano atual</p>
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
          </div>
        )}
      </div>
    </div>
  );
}
