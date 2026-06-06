"use client";

import Link from "next/link";
import { Radio, Phone, ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";

interface InstanceCardProps {
  instance: {
    id: string;
    instance_name: string;
    status: string;
    phone_number: string | null;
    agents?: { id: string; name: string } | null;
  };
}

const statusConfig: Record<string, { dot: string; label: string; text: string }> = {
  connected: {
    dot: "bg-green-500",
    label: "Conectado",
    text: "text-green-400",
  },
  disconnected: {
    dot: "bg-destructive",
    label: "Desconectado",
    text: "text-destructive",
  },
  connecting: {
    dot: "bg-amber-fire-500",
    label: "Conectando",
    text: "text-amber-fire-400",
  },
};

export function InstanceCard({ instance }: InstanceCardProps) {
  const status = statusConfig[instance.status] ?? {
    dot: "bg-muted-foreground",
    label: instance.status,
    text: "text-muted-foreground",
  };

  return (
    <Link href={`/instances/${instance.id}`}>
      <div className={cn(
        "group relative flex flex-col gap-4 rounded-xl border border-border bg-card p-5",
        "transition-all duration-150 hover:border-primary/30 hover:shadow-[0_0_0_1px_hsl(var(--primary)/0.15)]"
      )}>
        {/* Header */}
        <div className="flex items-start justify-between">
          <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-green-500/10">
            <Radio className="h-5 w-5 text-green-400" />
          </div>

          <div className="flex items-center gap-1.5">
            <span className={cn(
              "relative flex h-2 w-2",
              instance.status === "connected" && "animate-ping-parent"
            )}>
              {instance.status === "connected" && (
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-green-500 opacity-75" />
              )}
              <span className={cn("relative inline-flex h-2 w-2 rounded-full", status.dot)} />
            </span>
            <span className={cn("text-[11px] font-medium", status.text)}>
              {status.label}
            </span>
          </div>
        </div>

        {/* Info */}
        <div className="flex-1">
          <p className="font-semibold text-foreground">{instance.instance_name}</p>
          {instance.phone_number ? (
            <div className="mt-0.5 flex items-center gap-1">
              <Phone className="h-3 w-3 text-muted-foreground" />
              <p className="font-mono text-[11px] text-muted-foreground">
                {instance.phone_number}
              </p>
            </div>
          ) : (
            <p className="mt-0.5 text-[11px] text-muted-foreground">Sem número vinculado</p>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between border-t border-border pt-3">
          <div className="text-[11px] text-muted-foreground">
            {instance.agents ? (
              <span className="flex items-center gap-1">
                <span className="h-1.5 w-1.5 rounded-full bg-blue-electric-400" />
                {instance.agents.name}
              </span>
            ) : (
              "Nenhum agente vinculado"
            )}
          </div>
          <ChevronRight className="h-3.5 w-3.5 text-muted-foreground transition-transform group-hover:translate-x-0.5" />
        </div>
      </div>
    </Link>
  );
}
