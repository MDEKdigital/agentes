"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { CheckCircle, AlertTriangle, Loader2, ArrowLeft } from "lucide-react";
import { cn } from "@/lib/utils";
import { apiFetch } from "@/lib/api";
import { useOrganization } from "@/providers/organization-provider";
import type { Plan } from "@aula-agente/shared";

function fmtBRL(value: number) {
  return new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(value);
}

export default function PlansPage() {
  const { currentOrg, currentRole, loading: orgLoading } = useOrganization();
  const router = useRouter();
  const [plans, setPlans] = useState<Plan[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [activePlanId, setActivePlanId] = useState<string | null>(null);

  const isAdmin = currentRole === "owner" || currentRole === "admin";

  useEffect(() => {
    if (!orgLoading && currentRole !== null && !isAdmin) {
      router.replace("/inbox");
    }
  }, [orgLoading, currentRole, isAdmin, router]);

  useEffect(() => {
    if (orgLoading || !currentOrg) return;

    const headers = { "x-organization-id": currentOrg.id };

    Promise.all([
      apiFetch("/billing/plans", { headers }),
      apiFetch("/billing/subscription", { headers }),
    ])
      .then(([plansRes, subRes]) => {
        setPlans((plansRes as Plan[]) ?? []);
        const planId = (subRes as { plan?: { id: string } | null })?.plan?.id ?? null;
        setActivePlanId(planId);
        setLoading(false);
      })
      .catch((err: Error) => {
        setError(err.message);
        setLoading(false);
      });
  }, [currentOrg, orgLoading]);

  if (loading || orgLoading) {
    return (
      <div className="flex items-center justify-center py-24">
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="mx-auto max-w-xl pt-6">
        <div className="flex items-start gap-3 rounded-xl border border-destructive/30 bg-destructive/5 p-5">
          <AlertTriangle className="h-4 w-4 shrink-0 text-destructive mt-0.5" />
          <div>
            <p className="text-sm font-medium text-destructive">Não foi possível carregar os planos</p>
            <p className="text-xs text-muted-foreground mt-0.5">{error}</p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div className="flex items-center gap-3">
        <button
          onClick={() => router.back()}
          className="flex items-center gap-1.5 rounded-lg border border-border bg-card px-3 py-2 text-xs font-medium text-foreground hover:bg-accent transition-colors"
        >
          <ArrowLeft className="h-3.5 w-3.5" />
          Voltar
        </button>
        <div>
          <h1 className="text-lg font-semibold text-foreground">Planos disponíveis</h1>
          <p className="text-xs text-muted-foreground mt-0.5">Compare e escolha o plano ideal para o seu negócio</p>
        </div>
      </div>

      {plans.length === 0 ? (
        <div className="rounded-xl border border-border bg-card p-8 text-center">
          <p className="text-sm text-muted-foreground">Nenhum plano disponível no momento.</p>
        </div>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {plans.map((plan) => {
            const isActive = plan.id === activePlanId;
            return (
              <div
                key={plan.id}
                className={cn(
                  "relative flex flex-col rounded-xl border bg-card overflow-hidden transition-all",
                  isActive
                    ? "border-blue-electric-400 ring-1 ring-blue-electric-400/30"
                    : "border-border hover:border-border/80"
                )}
              >
                {isActive && (
                  <div className="bg-blue-electric-500/10 px-4 py-1.5 text-center">
                    <span className="text-[11px] font-semibold text-blue-electric-300">Plano atual</span>
                  </div>
                )}

                <div className="flex flex-col flex-1 p-5 space-y-4">
                  <div>
                    <h3 className="text-base font-semibold text-foreground">{plan.name}</h3>
                  </div>

                  <div className="space-y-1">
                    <div className="flex items-baseline gap-1">
                      <span className="text-2xl font-bold text-foreground">{fmtBRL(plan.price_monthly)}</span>
                      <span className="text-xs text-muted-foreground">/mês</span>
                    </div>
                    {plan.price_yearly > 0 && (
                      <p className="text-xs text-muted-foreground">
                        ou {fmtBRL(plan.price_yearly)}/ano
                        {plan.price_monthly > 0 && (
                          <span className="ml-1 text-green-400 font-medium">
                            ({Math.round(100 - (plan.price_yearly / (plan.price_monthly * 12)) * 100)}% off)
                          </span>
                        )}
                      </p>
                    )}
                  </div>

                  <div className="grid grid-cols-3 gap-2">
                    {[
                      { label: "Agentes",    n: plan.max_agents },
                      { label: "Instâncias", n: plan.max_instances },
                      { label: "Membros",    n: plan.max_members },
                    ].map((item) => (
                      <div key={item.label} className="rounded-lg border border-border bg-muted/30 p-2 text-center">
                        <p className="text-lg font-bold text-foreground">{item.n}</p>
                        <p className="text-[10px] text-muted-foreground leading-tight">{item.label}</p>
                      </div>
                    ))}
                  </div>

                  {plan.features.length > 0 && (
                    <ul className="space-y-1.5 flex-1">
                      {plan.features.map((f) => (
                        <li key={f} className="flex items-center gap-2 text-xs text-foreground">
                          <CheckCircle className="h-3 w-3 text-green-400 shrink-0" />
                          <span className="capitalize">{f.replace(/_/g, " ")}</span>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
