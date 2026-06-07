"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { useOrganization } from "@/providers/organization-provider";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

export default function OnboardingPage() {
  const [name, setName] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();
  const supabase = createClient();
  const { refetch } = useOrganization();

  const slug = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoading(true);

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
      setError(err instanceof Error ? err.message : "Erro ao criar organização");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex min-h-[60vh] items-center justify-center">
      <Card className="w-full max-w-md">
        <CardHeader>
          <CardTitle>Criar organização</CardTitle>
          <CardDescription>Configure sua primeira organização para começar</CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="name">Nome da organização</Label>
              <Input
                id="name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Minha Empresa"
                required
              />
              {slug && <p className="text-xs text-muted-foreground">Slug: {slug}</p>}
            </div>
            {error && <p className="text-sm text-destructive">{error}</p>}
            <Button type="submit" className="w-full" disabled={loading || !name}>
              {loading ? "Criando..." : "Criar organização"}
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
