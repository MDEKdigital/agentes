"use client";

import { useState, Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

interface AuthFormProps {
  mode: "login" | "register";
}

function AuthFormInner({ mode }: AuthFormProps) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const router = useRouter();
  const searchParams = useSearchParams();
  const rawNext = searchParams.get("next") ?? "/inbox";
  // Prevent open redirect: only allow same-origin relative paths
  const next =
    rawNext.startsWith("/") && !rawNext.startsWith("//") && !rawNext.startsWith("/\\")
      ? rawNext
      : "/inbox";
  const supabase = createClient();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoading(true);

    try {
      if (mode === "register") {
        const { error } = await supabase.auth.signUp({ email, password });
        if (error) throw error;
      } else {
        const { error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) throw error;
      }
      router.push(next);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Ocorreu um erro");
    } finally {
      setLoading(false);
    }
  };

  const nextParam = next !== "/inbox" ? `?next=${encodeURIComponent(next)}` : "";

  return (
    <Card>
      <CardHeader>
        <CardTitle>{mode === "login" ? "Entrar" : "Criar conta"}</CardTitle>
        <CardDescription>
          {mode === "login"
            ? "Entre com seu email e senha"
            : "Crie sua conta para começar"}
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="email">Email</Label>
            <Input
              id="email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="password">Senha</Label>
            <Input
              id="password"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              minLength={6}
            />
          </div>
          {error && <p className="text-sm text-destructive">{error}</p>}
          <Button type="submit" className="w-full" disabled={loading}>
            {loading ? "Carregando..." : mode === "login" ? "Entrar" : "Criar conta"}
          </Button>
          <p className="text-center text-sm text-muted-foreground">
            {mode === "login" ? (
              <>Não tem conta? <a href={`/register${nextParam}`} className="underline">Criar conta</a></>
            ) : (
              <>Já tem conta? <a href={`/login${nextParam}`} className="underline">Entrar</a></>
            )}
          </p>
        </form>
      </CardContent>
    </Card>
  );
}

export function AuthForm({ mode }: AuthFormProps) {
  return (
    <Suspense>
      <AuthFormInner mode={mode} />
    </Suspense>
  );
}
