import { cn } from "@/lib/utils";
import type { Message } from "@aula-agente/shared";

interface MessageBubbleProps {
  message: Message;
}

function formatTime(iso: string) {
  return new Date(iso).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
}

export function MessageBubble({ message }: MessageBubbleProps) {
  const isContact = message.role === "contact";
  const isAgent = message.role === "agent";
  const isHuman = message.role === "human_agent";
  const isSystem = message.role === "system";

  if (isSystem) {
    return (
      <div className="flex justify-center py-2">
        <span className="rounded-full bg-muted/60 px-3 py-1 text-[11px] text-muted-foreground">
          {message.content}
        </span>
      </div>
    );
  }

  return (
    <div className={cn("flex", isContact ? "justify-start" : "justify-end")}>
      <div
        className={cn(
          "max-w-[72%] px-3 py-2.5",
          isContact && "rounded-[12px_12px_12px_2px] bg-elevated",
          isAgent && "rounded-[12px_12px_2px_12px] bg-primary/10 border border-primary/25",
          isHuman && "rounded-[12px_12px_2px_12px] bg-amber-fire-500/10 border border-amber-fire-500/25"
        )}
      >
        {(isAgent || isHuman) && (
          <p className={cn(
            "mb-1 text-[10px] font-medium uppercase tracking-wider",
            isAgent ? "text-blue-electric-300" : "text-amber-fire-400"
          )}>
            {isAgent ? "Agente IA" : "Atendente"}
          </p>
        )}

        {message.media_type === "audio" && message.media_url ? (
          <audio
            controls
            src={message.media_url}
            className="w-full max-w-[260px] h-8"
            preload="metadata"
          />
        ) : null}

        {message.media_type === "image" && message.media_url ? (
          <img
            src={message.media_url}
            alt="imagem"
            className="max-w-[260px] rounded-md object-cover"
          />
        ) : null}

        {(!message.media_type || message.media_type === "text" || message.content) && (
          <p className="whitespace-pre-wrap text-sm leading-relaxed text-foreground">
            {message.content}
          </p>
        )}

        <p className={cn(
          "mt-1.5 text-right text-[10px]",
          isContact ? "text-muted-foreground" : "text-muted-foreground/70"
        )}>
          {formatTime(message.created_at)}
        </p>

        {/* Metadata da IA */}
        {isAgent && message.metadata && (
          <p className="mt-1 text-[10px] font-mono text-muted-foreground/50">
            {(message.metadata as { model?: string; tokens_used?: number }).model}
            {(message.metadata as { tokens_used?: number }).tokens_used
              ? ` · ${(message.metadata as { tokens_used: number }).tokens_used} tokens`
              : ""}
          </p>
        )}
      </div>
    </div>
  );
}
