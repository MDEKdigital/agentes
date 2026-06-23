"use client";

import { useCallback, useEffect, useState } from "react";
import { useOrganization } from "@/providers/organization-provider";
import { apiFetch } from "@/lib/api";
import { CheckCircle, AlertTriangle, RefreshCw } from "lucide-react";
import { cn } from "@/lib/utils";
import type { Subscription, Plan, BillingEvent } from "@aula-agente/shared";

interface BillingData {
  subscription: Subscription | null;
  plan: Plan | null;
  usage: { agents_used: number; members_used: number; instances_used: number };
  limits: { max_agents: number; max_members: number; max_instances: number } | null;
  recentEvents: BillingEvent[];
}

function formatCurrency(value: number) {
  if (value === 0) return "Gratuito";
  return new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(value) + "/mês";
}

export default function PlansPage() {
  const { currentOrg, loading: orgLoading } = useOrganization();
  const [plans, setPlans] = useState<Plan[]>([]);
  const [billingData, setBillingData] = useState<BillingData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchData = useCallback(() => {
    if (!currentOrg) return;
    setLoading(true);
    setError(null);
    Promise.all([
      apiFetch("/billing/plans"),
      apiFetch("/billing/subscription", { headers: { "x-organization-id": currentOrg.id } }),
    ])
      .then(([plansRes, subRes]) => {
        setPlans(plansRes as Plan[]);
        setBillingData(subRes as BillingData);
        setLoading(false);
      })
      .catch((err: Error) => { setError(err.message); setLoading(false); });
  }, [currentOrg]);

  useEffect(() => {
    if (orgLoading) return;
    if (!currentOrg) { setLoading(false); return; }
    fetchData();
  }, [currentOrg, orgLoading, fetchData]);

  if (loading || orgLoading) {
    return (
      <div className="mx-auto max-w-4xl space-y-6">
        <div className="h-7 w-48 animate-pulse rounded-lg bg-muted" />
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          {[...Array(3)].map((_, i) => (
            <div key={i} className="rounded-xl border border-border bg-card overflow-hidden">
              <div className="p-6 space-y-4">
                <div className="h-5 w-24 animate-pulse rounded bg-muted" />
                <div className="h-8 w-32 animate-pulse rounded bg-muted" />
                <div className="space-y-2">
                  {[...Array(4)].map((_, j) => (
                    <div key={j} className="h-4 animate-pulse rounded bg-muted" />
                  ))}
                </div>
                <div className="h-9 animate-pulse rounded bg-muted" />
              </div>
            </div>
          ))}
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="mx-auto max-w-4xl">
        <div className="rounded-xl border border-destructive/30 bg-destructive/5 p-5 flex items-start gap-3">
          <AlertTriangle className="h-4 w-4 shrink-0 text-destructive mt-0.5" />
          <div className="flex-1 space-y-1">
            <p className="text-sm font-medium text-destructive">Não foi possível carregar os planos</p>
            <p className="text-xs text-muted-foreground">{error}</p>
          </div>
          <button
            onClick={fetchData}
            className="shrink-0 flex items-center gap-1.5 rounded-md border border-border bg-card px-3 py-1.5 text-xs font-medium text-foreground transition-colors hover:bg-accent"
          >
            <RefreshCw className="h-3 w-3" />
            Tentar novamente
          </button>
        </div>
      </div>
    );
  }

  const currentPlanSlug = billingData?.plan?.slug ?? null;

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <div>
        <h1 className="text-xl font-semibold text-foreground">Planos disponíveis</h1>
        <p className="text-xs text-muted-foreground mt-0.5">Escolha o plano ideal para sua organização</p>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        {plans.map((plan) => {
          const isCurrent = currentPlanSlug !== null && plan.slug === currentPlanSlug;

          return (
            <div
              key={plan.id}
              className={cn(
                "rounded-xl border bg-card overflow-hidden flex flex-col",
                isCurrent
                  ? "border-blue-electric-400 ring-1 ring-blue-electric-400"
                  : "border-border"
              )}
            >
              <div className="p-6 flex flex-col flex-1 space-y-4">
                {/* Plan header */}
                <div className="flex items-start justify-between gap-2">
                  <h2 className="text-base font-semibold text-foreground">{plan.name}</h2>
                  {isCurrent && (
                    <span className="shrink-0 rounded-md border border-blue-electric-400/40 bg-blue-electric-400/10 px-2 py-0.5 text-xs font-semibold text-blue-electric-400">
                      Plano atual
                    </span>
                  )}
                </div>

                {/* Price */}
                <p className="text-2xl font-bold text-foreground">
                  {formatCurrency(plan.price_monthly)}
                </p>

                {/* Limits */}
                <div className="space-y-1">
                  <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground mb-2">
                    Limites
                  </p>
                  <p className="text-sm text-foreground">{plan.max_agents} agentes</p>
                  <p className="text-sm text-foreground">{plan.max_instances} instâncias</p>
                  <p className="text-sm text-foreground">{plan.max_members} membros</p>
                </div>

                {/* Features */}
                {plan.features.length > 0 && (
                  <ul className="space-y-1 flex-1">
                    {plan.features.map((feature) => (
                      <li key={feature} className="flex items-center gap-2 text-sm text-foreground">
                        <CheckCircle className="h-3.5 w-3.5 text-green-400 shrink-0" />
                        <span className="capitalize">{feature.replace(/_/g, " ")}</span>
                      </li>
                    ))}
                  </ul>
                )}

                {/* CTA */}
                <button
                  disabled={isCurrent}
                  onClick={() => {}}
                  className={cn(
                    "mt-auto w-full rounded-lg px-4 py-2 text-sm font-medium transition-colors",
                    isCurrent
                      ? "cursor-not-allowed bg-muted text-muted-foreground"
                      : "bg-blue-electric-400 text-white hover:bg-blue-electric-400/90"
                  )}
                >
                  {isCurrent ? "Plano atual" : `Upgrade para ${plan.name}`}
                </button>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
