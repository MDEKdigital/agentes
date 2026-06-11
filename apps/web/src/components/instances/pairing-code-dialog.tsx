"use client";

import { useState, useEffect, useRef } from "react";
import { apiFetch } from "@/lib/api";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Smartphone, Loader2, CheckCircle2 } from "lucide-react";

interface PairingCodeDialogProps {
  instanceId: string;
  onConnected?: (instanceData: Record<string, unknown>) => void;
}

type DialogState = "idle" | "loading" | "code" | "connected";

export function PairingCodeDialog({ instanceId, onConnected }: PairingCodeDialogProps) {
  const [open, setOpen] = useState(false);
  const [state, setState] = useState<DialogState>("idle");
  const [phone, setPhone] = useState("");
  const [pairingCode, setPairingCode] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const connectedRef = useRef(false);
  const onConnectedRef = useRef(onConnected);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    onConnectedRef.current = onConnected;
  });

  useEffect(() => {
    if (!open) {
      setState("idle");
      setPhone("");
      setPairingCode(null);
      setError(null);
      connectedRef.current = false;
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
      return;
    }

    if (state !== "code") return;

    const checkStatus = async () => {
      if (connectedRef.current) return;
      try {
        const data = await apiFetch(`/instances/${instanceId}/status`);
        if (data.status === "connected") {
          connectedRef.current = true;
          setState("connected");
          onConnectedRef.current?.(data);
          timeoutRef.current = setTimeout(() => setOpen(false), 2500);
        }
      } catch {
        // ignore polling errors
      }
    };

    const statusInterval = setInterval(checkStatus, 5_000);
    return () => {
      clearInterval(statusInterval);
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
    };
  }, [open, state, instanceId]);

  const handleSend = async () => {
    if (phone.length < 10) return;
    setState("loading");
    setError(null);
    try {
      const data = await apiFetch(`/instances/${instanceId}/pairing-code`, {
        method: "POST",
        body: JSON.stringify({ phone_number: phone }),
      });
      setPairingCode(data.code);
      setState("code");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erro ao solicitar código");
      setState("idle");
    }
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline">
          <Smartphone className="mr-2 h-4 w-4" />
          Conectar via Número
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Conectar via Número</DialogTitle>
        </DialogHeader>

        <div className="flex min-h-[240px] flex-col items-center justify-center gap-4">
          {state === "idle" || state === "loading" ? (
            <>
              <p className="text-center text-sm text-muted-foreground">
                Digite o número do WhatsApp que deseja vincular
              </p>
              <div className="flex w-full max-w-xs items-center gap-2">
                <span className="shrink-0 rounded-md border border-input bg-muted px-3 py-2 text-sm text-muted-foreground">
                  +55
                </span>
                <Input
                  placeholder="11999999999"
                  value={phone}
                  onChange={(e) => setPhone(e.target.value.replace(/\D/g, "").slice(0, 11))}
                  disabled={state === "loading"}
                  inputMode="numeric"
                />
              </div>
              {error && (
                <p className="text-center text-xs text-destructive">{error}</p>
              )}
              <Button
                onClick={handleSend}
                disabled={phone.length < 10 || state === "loading"}
                className="w-full max-w-xs"
              >
                {state === "loading" ? (
                  <><Loader2 className="mr-2 h-4 w-4 animate-spin" /> Aguarde...</>
                ) : (
                  "Enviar código"
                )}
              </Button>
            </>
          ) : state === "code" ? (
            <>
              <p className="text-center text-sm font-medium">Seu código de vinculação:</p>
              <p className="font-mono text-4xl font-bold tracking-widest text-foreground">
                {pairingCode}
              </p>
              <p className="max-w-xs text-center text-xs text-muted-foreground">
                Abra o WhatsApp no celular → Dispositivos vinculados → Vincular com número de telefone → Digite o código acima
              </p>
              <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
            </>
          ) : (
            <div className="flex flex-col items-center gap-3 text-center">
              <CheckCircle2 className="h-14 w-14 text-green-500" />
              <p className="text-base font-medium text-foreground">WhatsApp conectado!</p>
              <p className="text-xs text-muted-foreground">Carregando informações...</p>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
