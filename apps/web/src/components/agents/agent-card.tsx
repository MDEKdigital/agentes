"use client";

import Link from "next/link";
import type { Agent } from "@aula-agente/shared";
import { Bot, ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";

interface AgentCardProps {
  agent: Agent;
}

export function AgentCard({ agent }: AgentCardProps) {
  return (
    <Link href={`/agents/${agent.id}`}>
      <div className={cn(
        "group relative flex flex-col gap-4 rounded-xl border border-border bg-card p-5",
        "transition-all duration-150 hover:border-primary/30 hover:shadow-[0_0_0_1px_hsl(var(--primary)/0.15)]"
      )}>
        {/* Header */}
        <div className="flex items-start justify-between">
          <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10">
            <Bot className="h-5 w-5 text-blue-electric-400" />
          </div>

          <div className="flex items-center gap-1.5">
            {agent.is_active ? (
              <span className="flex items-center gap-1.5">
                <span className="relative flex h-2 w-2">
                  <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-green-500 opacity-75" />
                  <span className="relative inline-flex h-2 w-2 rounded-full bg-green-500" />
                </span>
                <span className="text-[11px] font-medium text-green-400">Ativo</span>
              </span>
            ) : (
              <span className="flex items-center gap-1.5">
                <span className="h-2 w-2 rounded-full bg-muted-foreground" />
                <span className="text-[11px] font-medium text-muted-foreground">Inativo</span>
              </span>
            )}
          </div>
        </div>

        {/* Info */}
        <div className="flex-1">
          <p className="font-semibold text-foreground">{agent.name}</p>
          <p className="mt-0.5 text-xs text-muted-foreground line-clamp-2">
            {agent.description || "Sem descrição"}
          </p>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between border-t border-border pt-3">
          <div className="flex items-center gap-2">
            <span className="rounded bg-muted px-1.5 py-0.5 font-mono text-[11px] text-muted-foreground">
              {agent.model}
            </span>
            <span className="text-[11px] text-muted-foreground capitalize">{agent.provider}</span>
          </div>
          <ChevronRight className="h-3.5 w-3.5 text-muted-foreground transition-transform group-hover:translate-x-0.5" />
        </div>
      </div>
    </Link>
  );
}
