"use client";

import { cn } from "@/lib/utils";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { User, Trash2 } from "lucide-react";

interface ConversationItem {
  id: string;
  status: string;
  is_human_takeover: boolean;
  last_message_at: string;
  tags: string[];
  assigned_to: string | null;
  contacts: { phone: string; name: string | null };
  agents: { name: string };
}

interface ConversationListProps {
  conversations: ConversationItem[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  onDelete: (id: string) => void;
}

const statusDot: Record<string, string> = {
  open: "bg-green-500",
  waiting: "bg-amber-fire-500",
  resolved: "bg-blue-electric-400",
  closed: "bg-muted-foreground",
};

function formatTime(iso: string) {
  return new Date(iso).toLocaleTimeString("pt-BR", {
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function ConversationList({ conversations, selectedId, onSelect, onDelete }: ConversationListProps) {
  if (conversations.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center gap-2 py-12 text-center">
        <p className="text-xs text-muted-foreground">Nenhuma conversa encontrada</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col py-1">
      {conversations.map((conv) => {
        const isActive = selectedId === conv.id;
        const displayName = conv.contacts.name || conv.contacts.phone;
        const initial = displayName?.[0]?.toUpperCase() || "?";

        return (
          <div key={conv.id} className="group relative">
            <button
              onClick={() => onSelect(conv.id)}
              className={cn(
                "relative w-full flex items-center gap-3 px-3 py-3 text-left transition-all",
                isActive
                  ? "border-l-[3px] border-blue-electric-400 bg-blue-electric-500/10 pl-[9px]"
                  : "border-l-[3px] border-transparent hover:bg-elevated"
              )}
            >
              {/* Avatar */}
              <Avatar className="h-9 w-9 shrink-0">
                <AvatarFallback className="bg-primary/10 text-blue-electric-300 text-xs font-semibold">
                  {conv.contacts.name ? initial : <User className="h-3.5 w-3.5" />}
                </AvatarFallback>
              </Avatar>

              {/* Info */}
              <div className="min-w-0 flex-1 pr-6">
                <div className="flex items-center justify-between gap-1">
                  <p className={cn(
                    "truncate text-xs font-medium",
                    isActive ? "text-blue-electric-300" : "text-foreground"
                  )}>
                    {displayName}
                  </p>
                  <span className="shrink-0 text-[10px] text-muted-foreground">
                    {formatTime(conv.last_message_at)}
                  </span>
                </div>

                <div className="mt-0.5 flex items-center gap-1.5">
                  <span className={cn(
                    "h-1.5 w-1.5 shrink-0 rounded-full",
                    statusDot[conv.status] ?? "bg-muted-foreground"
                  )} />
                  <span className="truncate text-[11px] text-muted-foreground">
                    {conv.agents?.name}
                  </span>
                  {conv.is_human_takeover && (
                    <span className="shrink-0 rounded px-1 py-px text-[10px] font-medium bg-blue-electric-500/10 text-blue-electric-300 border border-blue-electric-500/20">
                      Humano
                    </span>
                  )}
                </div>
              </div>
            </button>

            {/* Delete Button */}
            <button
              onClick={(e) => {
                e.stopPropagation();
                onDelete(conv.id);
              }}
              className="absolute right-2 top-1/2 -translate-y-1/2 opacity-0 group-hover:opacity-100 transition-opacity p-1.5 rounded hover:bg-destructive/10 text-muted-foreground hover:text-destructive"
              aria-label="Apagar conversa"
            >
              <Trash2 className="h-3.5 w-3.5" />
            </button>
          </div>
        );
      })}
    </div>
  );
}
