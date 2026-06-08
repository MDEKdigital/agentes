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
import { QrCode, Loader2, CheckCircle2 } from "lucide-react";

interface QrCodeDialogProps {
  instanceId: string;
  onConnected?: (instanceData: Record<string, unknown>) => void;
}

export function QrCodeDialog({ instanceId, onConnected }: QrCodeDialogProps) {
  const [open, setOpen] = useState(false);
  const [qrData, setQrData] = useState<{ base64?: string; code?: string } | null>(null);
  const [loading, setLoading] = useState(false);
  const [connected, setConnected] = useState(false);
  const connectedRef = useRef(false);

  useEffect(() => {
    if (!open) {
      setConnected(false);
      connectedRef.current = false;
      return;
    }

    const fetchQr = async () => {
      if (connectedRef.current) return;
      setLoading(true);
      try {
        const data = await apiFetch(`/instances/${instanceId}/qrcode`);
        setQrData(data);
      } catch {
        setQrData(null);
      }
      setLoading(false);
    };

    const checkStatus = async () => {
      if (connectedRef.current) return;
      try {
        const data = await apiFetch(`/instances/${instanceId}/status`);
        if (data.status === "connected") {
          connectedRef.current = true;
          setConnected(true);
          onConnected?.(data);
          setTimeout(() => setOpen(false), 2500);
        }
      } catch {
        // ignore
      }
    };

    fetchQr();
    const qrInterval = setInterval(fetchQr, 60_000);
    const statusInterval = setInterval(checkStatus, 5_000);

    return () => {
      clearInterval(qrInterval);
      clearInterval(statusInterval);
    };
  }, [open, instanceId, onConnected]);

  const imgSrc = (val: string) =>
    val.startsWith("data:") ? val : `data:image/png;base64,${val}`;

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline">
          <QrCode className="mr-2 h-4 w-4" />
          Conectar via QR Code
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Escanear QR Code</DialogTitle>
        </DialogHeader>
        <div className="flex min-h-[300px] items-center justify-center">
          {connected ? (
            <div className="flex flex-col items-center gap-3 text-center">
              <CheckCircle2 className="h-14 w-14 text-green-500" />
              <p className="text-base font-medium text-foreground">WhatsApp conectado!</p>
              <p className="text-xs text-muted-foreground">Carregando informações...</p>
            </div>
          ) : loading ? (
            <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
          ) : qrData?.base64 ? (
            <img src={imgSrc(qrData.base64)} alt="QR Code" className="h-64 w-64" />
          ) : qrData?.code ? (
            <img src={imgSrc(qrData.code)} alt="QR Code" className="h-64 w-64" />
          ) : (
            <p className="text-muted-foreground">
              Instância já conectada ou QR code indisponível
            </p>
          )}
        </div>
        {!connected && (
          <p className="text-center text-xs text-muted-foreground">
            O QR Code atualiza automaticamente a cada 1 minuto
          </p>
        )}
      </DialogContent>
    </Dialog>
  );
}
