"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { apiFetch } from "@/lib/api";
import { useOrganization } from "@/providers/organization-provider";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Loader2 } from "lucide-react";

function toSlug(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

export default function OnboardingPage() {
  const { currentOrg, loading, refetch } = useOrganization();
  const router = useRouter();
  const supabase = createClient();

  const hasBillingOrg = !loading && currentOrg !== null;

  const [name, setName] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Pre-fill name from existing org (Mode B)
  useEffect(() => {
    if (hasBillingOrg) {
      setName(currentOrg.name ?? "");
    }
  }, [hasBillingOrg, currentOrg?.name]);

  const slug = toSlug(name);

  // ── Mode A: manual flow ───────────────────────────────────────────────────
  const handleCreateOrg = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSubmitting(true);

    try {
      const { data, error: orgError } = await supabase.rpc("create_organization", {
        p_name: name,
        p_slug: slug,
      });

      if (orgError) throw orgError;
      if (!data || data.length === 0) throw new Error("Organização não criada");

      await refetch();
      router.push("/inbox");
    } catch (err) {
      const msg = err instanceof Error
        ? err.message
        : (err as { message?: string })?.message ?? "Erro ao criar organização";
      setError(msg);
    } finally {
      setSubmitting(false);
    }
  };

  // ── Mode B: billing flow ──────────────────────────────────────────────────
  const handleConfigureOrg = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSubmitting(true);

    try {
      await apiFetch(`/organizations/${currentOrg!.id}/onboarding`, {
        method: "PATCH",
        body: JSON.stringify({ name, slug }),
      });

      await refetch();
      router.push("/inbox");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erro ao salvar organização");
    } finally {
      setSubmitting(false);
    }
  };

  // ── loading ───────────────────────────────────────────────────────────────
  if (loading) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center">
        <Loader2 role="status" className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  // ── Mode B: org exists (billing or reconfigure) ───────────────────────────
  if (hasBillingOrg) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center">
        <Card className="w-full max-w-md">
          <CardHeader>
            <CardTitle>Configure sua organização</CardTitle>
            <CardDescription>
              Personalize o nome e o endereço da sua organização antes de continuar.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleConfigureOrg} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="name-b">Nome da organização</Label>
                <Input
                  id="name-b"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="Minha Empresa"
                  required
                />
                {slug && <p className="text-xs text-muted-foreground">Slug: {slug}</p>}
              </div>
              {error && <p className="text-sm text-destructive">{error}</p>}
              <Button type="submit" className="w-full" disabled={submitting || !name.trim() || !slug}>
                {submitting ? "Salvando..." : "Salvar e continuar"}
              </Button>
            </form>
          </CardContent>
        </Card>
      </div>
    );
  }

  // ── Mode A: no org (manual flow) ─────────────────────────────────────────
  return (
    <div className="flex min-h-[60vh] items-center justify-center">
      <Card className="w-full max-w-md">
        <CardHeader>
          <CardTitle>Criar organização</CardTitle>
          <CardDescription>Configure sua primeira organização para começar</CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleCreateOrg} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="name-a">Nome da organização</Label>
              <Input
                id="name-a"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Minha Empresa"
                required
              />
              {slug && <p className="text-xs text-muted-foreground">Slug: {slug}</p>}
            </div>
            {error && <p className="text-sm text-destructive">{error}</p>}
            <Button type="submit" className="w-full" disabled={submitting || !name.trim() || !slug}>
              {submitting ? "Criando..." : "Criar organização"}
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
