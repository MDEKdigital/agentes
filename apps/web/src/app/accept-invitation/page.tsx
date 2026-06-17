"use client";

import { Suspense, useEffect, useState } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { apiFetch } from "@/lib/api";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { CheckCircle, XCircle, Loader2 } from "lucide-react";

function AcceptInvitationContent() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const invitationId = searchParams.get("id");

  type Status = "loading" | "success" | "error" | "unauthenticated";
  const [status, setStatus] = useState<Status>("loading");
  const [errorMessage, setErrorMessage] = useState("");

  // Resend form state
  const [resendEmail, setResendEmail] = useState("");
  const [resendSent, setResendSent] = useState(false);
  const [resendLoading, setResendLoading] = useState(false);

  const isExpiredError = status === "error" &&
    /inválido ou expirado/i.test(errorMessage);

  useEffect(() => {
    if (!invitationId) {
      setStatus("error");
      setErrorMessage("Link de convite inválido.");
      return;
    }

    let cancelled = false;
    let timerId: ReturnType<typeof setTimeout> | null = null;

    const accept = async () => {
      const supabase = createClient();
      const { data: { user } } = await supabase.auth.getUser();

      if (!user) {
        if (!cancelled) setStatus("unauthenticated");
        return;
      }

      const { data: role, error } = await supabase.rpc("accept_invitation", {
        invitation_id: invitationId,
      });

      if (cancelled) return;

      if (error) {
        setStatus("error");
        setErrorMessage(error.message || "Convite inválido ou expirado.");
      } else {
        setStatus("success");
        const destination = role === "owner" ? "/onboarding" : "/inbox";
        timerId = setTimeout(() => router.push(destination), 2000);
      }
    };

    accept();
    return () => {
      cancelled = true;
      if (timerId !== null) clearTimeout(timerId);
    };
  }, [invitationId, router]);

  const handleResend = async () => {
    if (!resendEmail.trim()) return;
    setResendLoading(true);
    try {
      await apiFetch("/billing/resend-invitation", {
        method: "POST",
        body: JSON.stringify({ email: resendEmail.trim() }),
      });
    } catch {
      // intentional: always show neutral feedback
    } finally {
      setResendSent(true);
      setResendLoading(false);
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-background p-4">
      <Card className="w-full max-w-md">
        <CardHeader className="text-center">
          <CardTitle>Aceitar Convite</CardTitle>
          <CardDescription>Ingresse na organização</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col items-center gap-4 py-6">
          {status === "loading" && (
            <>
              <Loader2 className="h-10 w-10 animate-spin text-muted-foreground" />
              <p className="text-sm text-muted-foreground">Processando convite...</p>
            </>
          )}

          {status === "success" && (
            <>
              <CheckCircle className="h-10 w-10 text-green-500" />
              <p className="text-sm font-medium">Convite aceito com sucesso!</p>
              <p className="text-xs text-muted-foreground">Redirecionando...</p>
            </>
          )}

          {status === "error" && (
            <>
              <XCircle className="h-10 w-10 text-destructive" />
              <p className="text-sm font-medium text-destructive">{errorMessage}</p>

              {isExpiredError && !resendSent && (
                <div className="w-full space-y-3 pt-2">
                  <p className="text-xs text-muted-foreground text-center">
                    Informe seu email para receber um novo link de acesso.
                  </p>
                  <input
                    type="email"
                    placeholder="Seu email"
                    value={resendEmail}
                    onChange={(e) => setResendEmail(e.target.value)}
                    onKeyDown={(e) => { if (e.key === "Enter") handleResend(); }}
                    className="w-full rounded-md border border-border bg-muted px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring"
                  />
                  <Button
                    className="w-full"
                    onClick={handleResend}
                    disabled={resendLoading || !resendEmail.trim()}
                  >
                    {resendLoading ? "Enviando..." : "Reenviar link"}
                  </Button>
                </div>
              )}

              {isExpiredError && resendSent && (
                <p className="text-xs text-muted-foreground text-center">
                  Se um convite estiver disponível, o email foi reenviado.
                </p>
              )}

              {!isExpiredError && (
                <Button variant="outline" onClick={() => router.push("/login")}>
                  Ir para o login
                </Button>
              )}
            </>
          )}

          {status === "unauthenticated" && (
            <>
              <p className="text-sm text-muted-foreground text-center">
                Para aceitar o convite, faça login ou crie uma conta com o email para o qual o convite foi enviado.
              </p>
              <div className="flex flex-col gap-2 w-full">
                <Button
                  onClick={() =>
                    router.push(`/register?next=${encodeURIComponent(`/accept-invitation?id=${invitationId}`)}`)
                  }
                >
                  Criar conta
                </Button>
                <Button
                  variant="outline"
                  onClick={() =>
                    router.push(`/login?next=${encodeURIComponent(`/accept-invitation?id=${invitationId}`)}`)
                  }
                >
                  Já tenho conta — fazer login
                </Button>
              </div>
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

export default function AcceptInvitationPage() {
  return (
    <Suspense>
      <AcceptInvitationContent />
    </Suspense>
  );
}
