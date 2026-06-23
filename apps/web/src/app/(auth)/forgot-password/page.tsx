"use client";

import { useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { MailCheck } from "lucide-react";

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState("");
  const [loading, setLoading] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoading(true);

    const supabase = createClient();
    const { error } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: `${window.location.origin}/reset-password`,
    });

    setLoading(false);

    if (error) {
      setError("Não foi possível enviar o email. Verifique o endereço e tente novamente.");
      return;
    }

    setSent(true);
  };

  if (sent) {
    return (
      <Card>
        <CardContent className="pt-8 pb-8">
          <div className="flex flex-col items-center gap-4 text-center">
            <div className="flex h-14 w-14 items-center justify-center rounded-full bg-blue-electric-500/10">
              <MailCheck className="h-7 w-7 text-blue-electric-400" />
            </div>
            <div className="space-y-1">
              <h2 className="text-lg font-semibold text-foreground">Email enviado</h2>
              <p className="text-sm text-muted-foreground">
                Enviamos um link de redefinição para{" "}
                <span className="font-medium text-foreground">{email}</span>.
              </p>
              <p className="text-sm text-muted-foreground">
                Acesse sua caixa de entrada e clique no link para criar uma nova senha.
              </p>
            </div>
            <p className="text-xs text-muted-foreground">
              Não recebeu?{" "}
              <button className="underline" onClick={() => setSent(false)}>
                Enviar novamente
              </button>
            </p>
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Esqueci minha senha</CardTitle>
        <CardDescription>
          Digite seu email e enviaremos um link para redefinir sua senha.
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
              placeholder="seu@email.com"
            />
          </div>
          {error && <p className="text-sm text-destructive">{error}</p>}
          <Button type="submit" className="w-full" disabled={loading}>
            {loading ? "Enviando..." : "Enviar link de redefinição"}
          </Button>
          <p className="text-center text-sm text-muted-foreground">
            Lembrou a senha?{" "}
            <a href="/login" className="underline">
              Entrar
            </a>
          </p>
        </form>
      </CardContent>
    </Card>
  );
}
