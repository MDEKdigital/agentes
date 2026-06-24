"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import {
  CreditCard,
  CheckCircle,
  AlertTriangle,
  Clock,
  Activity,
  Receipt,
  LayoutGrid,
  RefreshCw,
  Loader2,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { apiFetch } from "@/lib/api";
import { useOrganization } from "@/providers/organization-provider";
import type { Subscription, Plan, BillingEvent } from "@aula-agente/shared";

interface BillingData {
  subscription: Subscription | null;
  plan: Plan | null;
  usage: { agents_used: number; members_used: number; instances_used: number };
  limits: { max_agents: number; max_members: number; max_instances: number } | null;
  recentEvents: BillingEvent[];
}

const STATUS_LABEL: Record<string, { text: string; cls: string }> = {
  active:    { text: "Ativa",              cls: "text-green-400 bg-green-400/10 border-green-400/30" },
  trial:     { text: "Trial",              cls: "text-blue-400 bg-blue-400/10 border-blue-400/30" },
  past_due:  { text: "Pagamento Pendente", cls: "text-amber-400 bg-amber-400/10 border-amber-400/30" },
  paused:    { text: "Pausada",            cls: "text-orange-400 bg-orange-400/10 border-orange-400/30" },
  cancelled: { text: "Cancelada",          cls: "text-red-400 bg-red-400/10 border-red-400/30" },
};

const EVENT_LABEL: Record<string, { text: string; cls: string }> = {
  processed:  { text: "Processado",  cls: "text-green-400 bg-green-400/10 border-green-400/30" },
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
    day: "2-digit", month: "2-digit", year: "numeric",
    hour: "2-digit", minute: "2-digit",
  });
}

function fmtBRL(value: number) {
  return new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(value);
}

function UsageBar({ used, max, label }: { used: number; max: number; label: string }) {
  const pct = max > 0 ? Math.min(100, Math.round((used / max) * 100)) : 0;
  const bar = pct >= 100 ? "bg-red-400" : pct >= 80 ? "bg-amber-400" : "bg-blue-electric-400";
  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between text-xs">
        <span className="font-medium text-foreground">{label}</span>
        <span className="text-muted-foreground">{used} / {max}</span>
      </div>
      <div className="h-1.5 rounded-full bg-muted overflow-hidden">
        <div className={cn("h-full rounded-full transition-all duration-500", bar)} style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

function Card({ title, icon: Icon, children }: { title: string; icon: React.ComponentType<{ className?: string }>; children: React.ReactNode }) {
  return (
    <div className="rounded-xl border border-border bg-card overflow-hidden">
      <div className="flex items-center gap-2 border-b border-border px-5 py-3.5">
        <Icon className="h-4 w-4 text-blue-electric-400" />
        <h2 className="text-sm font-semibold text-foreground">{title}</h2>
      </div>
      {children}
    </div>
  );
}

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between py-2.5 border-b border-border/50 last:border-0">
      <span className="text-xs text-muted-foreground">{label}</span>
      <span className="text-xs font-medium text-foreground">{value}</span>
    </div>
  );
}

export default function BillingPage() {
  const { currentOrg, currentRole, loading: orgLoading } = useOrganization();
  const router = useRouter();
  const [data, setData] = useState<BillingData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const isAdmin = currentRole === "owner" || currentRole === "admin";

  useEffect(() => {
    if (!orgLoading && currentRole !== null && !isAdmin) {
      router.replace("/inbox");
    }
  }, [orgLoading, currentRole, isAdmin, router]);

  const load = useCallback(() => {
    if (!currentOrg) return;
    setLoading(true);
    setError(null);
    apiFetch("/billing/subscription", { headers: { "x-organization-id": currentOrg.id } })
      .then((res) => { setData(res as BillingData); setLoading(false); })
      .catch((err: Error) => { setError(err.message); setLoading(false); });
  }, [currentOrg]);

  useEffect(() => {
    if (orgLoading) return;
    if (!currentOrg) { setLoading(false); return; }
    load();
  }, [currentOrg, orgLoading, load]);

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
          <div className="flex-1 min-w-0">
            <p className="text-sm font-medium text-destructive">Não foi possível carregar os dados</p>
            <p className="text-xs text-muted-foreground mt-0.5">{error}</p>
          </div>
          <button
            onClick={load}
            className="shrink-0 flex items-center gap-1.5 rounded-lg border border-border bg-card px-3 py-1.5 text-xs font-medium text-foreground hover:bg-accent transition-colors"
          >
            <RefreshCw className="h-3 w-3" /> Tentar novamente
          </button>
        </div>
      </div>
    );
  }

  const sub = data?.subscription ?? null;
  const plan = data?.plan ?? null;
  const usage = data?.usage ?? { agents_used: 0, members_used: 0, instances_used: 0 };
  const limits = data?.limits ?? null;
  const events = data?.recentEvents ?? [];
  const statusCfg = STATUS_LABEL[sub?.status ?? ""] ?? null;

  return (
    <div className="mx-auto max-w-2xl space-y-5">

      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-lg font-semibold text-foreground">Assinatura</h1>
          <p className="text-xs text-muted-foreground mt-0.5">Plano e utilização da sua organização</p>
        </div>
        <Link
          href="/settings/billing/plans"
          className="flex items-center gap-1.5 rounded-lg border border-border bg-card px-3 py-2 text-xs font-medium text-foreground hover:bg-accent transition-colors"
        >
          <LayoutGrid className="h-3.5 w-3.5 text-blue-electric-400" />
          Ver planos
        </Link>
      </div>

      {/* Plano atual */}
      <Card title="Plano atual" icon={CreditCard}>
        {!sub ? (
          <div className="p-5 space-y-1">
            <div className="flex items-center gap-2 text-muted-foreground">
              <AlertTriangle className="h-4 w-4 shrink-0" />
              <p className="text-sm">Nenhuma assinatura encontrada.</p>
            </div>
            <p className="text-xs text-muted-foreground pl-6">
              Se você acabou de comprar, aguarde alguns instantes — o processamento é automático.
            </p>
          </div>
        ) : (
          <div className="p-5 space-y-4">
            <div className="flex items-center justify-between gap-3">
              <div>
                <p className="text-base font-semibold text-foreground">{plan?.name ?? "—"}</p>
                <p className="text-xs text-muted-foreground mt-0.5">
                  {sub.billing_interval === "monthly"  && "Cobrança mensal"}
                  {sub.billing_interval === "yearly"   && "Cobrança anual"}
                  {sub.billing_interval === "lifetime" && "Acesso vitalício"}
                  {sub.billing_interval === "manual"   && "Plano manual"}
                </p>
              </div>
              {statusCfg && (
                <span className={cn("shrink-0 rounded-md border px-2.5 py-0.5 text-xs font-semibold", statusCfg.cls)}>
                  {statusCfg.text}
                </span>
              )}
            </div>

            <div className="divide-y divide-border/50 rounded-lg border border-border bg-muted/20 px-4">
              {plan && (
                <Row
                  label="Valor"
                  value={
                    sub.billing_interval === "yearly"
                      ? fmtBRL(plan.price_yearly) + "/ano"
                      : sub.billing_interval === "monthly"
                        ? fmtBRL(plan.price_monthly) + "/mês"
                        : "—"
                  }
                />
              )}
              {(sub.current_period_start || sub.current_period_end) && (
                <Row
                  label="Período"
                  value={
                    <span className="flex items-center gap-1.5">
                      <Clock className="h-3 w-3 text-muted-foreground" />
                      {fmtDate(sub.current_period_start)} → {fmtDate(sub.current_period_end)}
                    </span>
                  }
                />
              )}
              {sub.gateway && (
                <Row label="Gateway" value={<span className="capitalize">{sub.gateway}</span>} />
              )}
              {currentOrg && (
                <Row label="ID da organização" value={<span className="font-mono text-[11px]">{currentOrg.id}</span>} />
              )}
            </div>

            {plan && plan.features.length > 0 && (
              <div className="space-y-2">
                <p className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">Recursos incluídos</p>
                <ul className="grid grid-cols-2 gap-1">
                  {plan.features.map((f) => (
                    <li key={f} className="flex items-center gap-2 text-xs text-foreground">
                      <CheckCircle className="h-3 w-3 text-green-400 shrink-0" />
                      <span className="capitalize">{f.replace(/_/g, " ")}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        )}
      </Card>

      {/* Utilização */}
      {limits && (
        <Card title="Utilização atual" icon={Activity}>
          <div className="p-5 space-y-4">
            <div className="grid grid-cols-3 gap-3 mb-2">
              {[
                { label: "Agentes",    value: plan?.max_agents    ?? limits.max_agents },
                { label: "Instâncias", value: plan?.max_instances ?? limits.max_instances },
                { label: "Membros",    value: plan?.max_members   ?? limits.max_members },
              ].map((item) => (
                <div key={item.label} className="rounded-lg border border-border bg-muted/30 p-3 text-center">
                  <p className="text-xl font-bold text-foreground">{item.value}</p>
                  <p className="text-[10px] text-muted-foreground mt-0.5">{item.label}</p>
                </div>
              ))}
            </div>
            <UsageBar used={usage.agents_used}    max={limits.max_agents}    label="Agentes" />
            <UsageBar used={usage.members_used}   max={limits.max_members}   label="Membros" />
            <UsageBar used={usage.instances_used} max={limits.max_instances} label="Instâncias WhatsApp" />
          </div>
        </Card>
      )}

      {/* Histórico */}
      <Card title="Histórico de billing" icon={Receipt}>
        {events.length === 0 ? (
          <div className="p-5">
            <p className="text-sm text-muted-foreground">Nenhum evento registrado.</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-border bg-muted/30">
                  {["Data", "Gateway", "Tipo", "Status"].map((h) => (
                    <th key={h} className="px-4 py-2.5 text-left font-medium uppercase tracking-wider text-muted-foreground">
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {events.map((evt) => {
                  const s = EVENT_LABEL[evt.status] ?? { text: evt.status, cls: "text-muted-foreground bg-muted border-border" };
                  return (
                    <tr key={evt.id} className="hover:bg-muted/20 transition-colors">
                      <td className="px-4 py-2.5 text-foreground whitespace-nowrap">{fmtDateTime(evt.created_at)}</td>
                      <td className="px-4 py-2.5 text-foreground capitalize">{evt.gateway}</td>
                      <td className="px-4 py-2.5 text-foreground">{evt.event_type.replace(/_/g, " ")}</td>
                      <td className="px-4 py-2.5">
                        <span className={cn("rounded border px-2 py-0.5 text-[11px] font-semibold", s.cls)}>{s.text}</span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>

    </div>
  );
}
