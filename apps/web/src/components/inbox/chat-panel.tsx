"use client";

import { useEffect, useState, useRef, useCallback } from "react";
import { useRealtime } from "@/lib/realtime";
import { apiFetch } from "@/lib/api";
import { MessageBubble } from "./message-bubble";
import { SidePanel } from "./side-panel";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Send } from "lucide-react";
import { cn } from "@/lib/utils";
import type { Message } from "@aula-agente/shared";

interface ChatPanelProps {
  conversationId: string;
  onDelete: () => void;
}

export function ChatPanel({ conversationId, onDelete }: ChatPanelProps) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [conversation, setConversation] = useState<{
    id: string;
    organization_id: string;
    status: "open" | "waiting" | "resolved" | "closed";
    is_human_takeover: boolean;
    is_blocked: boolean;
    assigned_to: string | null;
    tags: string[];
    contacts: { phone: string; name: string | null };
  } | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);

  const fetchFull = useCallback(async () => {
    const data = await apiFetch(`/conversations/${conversationId}/full`).catch(() => null);
    if (data) {
      setConversation((data as any).conversation ?? null);
      setMessages(((data as any).messages as Message[]) ?? []);
    }
  }, [conversationId]);

  useEffect(() => {
    fetchFull();
  }, [fetchFull]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  useRealtime({
    table: "messages",
    filter: `conversation_id=eq.${conversationId}`,
    onInsert: (newMsg) => {
      setMessages((prev) => [...prev, newMsg as unknown as Message]);
    },
  });

  const handleSend = async () => {
    if (!input.trim()) return;
    setSending(true);
    try {
      await apiFetch("/messages/send", {
        method: "POST",
        body: JSON.stringify({ conversation_id: conversationId, content: input.trim() }),
      });
      setInput("");
    } catch (err) {
      alert(err instanceof Error ? err.message : "Erro ao enviar");
    } finally {
      setSending(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const displayName = conversation?.contacts?.name || conversation?.contacts?.phone || "Conversa";

  return (
    <div className="flex h-full w-full overflow-hidden">
      {/* Área principal do chat */}
      <div className="flex flex-1 flex-col overflow-hidden">
        {/* Header */}
        <div className="flex h-14 shrink-0 items-center justify-between border-b border-border px-5">
          <div>
            <p className="text-sm font-semibold text-foreground">{displayName}</p>
            {conversation?.contacts?.name && (
              <p className="font-mono text-[11px] text-muted-foreground">
                {conversation.contacts.phone}
              </p>
            )}
          </div>

          <div className="flex items-center gap-2">
            <span className={cn(
              "rounded px-2 py-0.5 text-[11px] font-medium capitalize",
              conversation?.status === "open" && "bg-green-500/10 text-green-400",
              conversation?.status === "waiting" && "bg-amber-fire-500/10 text-amber-fire-400",
              conversation?.status === "resolved" && "bg-blue-electric-500/10 text-blue-electric-300",
              conversation?.status === "closed" && "bg-muted text-muted-foreground",
            )}>
              {conversation?.status}
            </span>
          </div>
        </div>

        {/* Mensagens */}
        <div className="flex-1 overflow-y-auto space-y-3 px-5 py-4">
          {messages.length === 0 && (
            <div className="flex h-full items-center justify-center">
              <p className="text-xs text-muted-foreground">Nenhuma mensagem ainda</p>
            </div>
          )}
          {messages.map((msg) => (
            <MessageBubble key={msg.id} message={msg} />
          ))}
          <div ref={bottomRef} />
        </div>

        {/* Input */}
        <div className="shrink-0 border-t border-border bg-card/50 px-4 py-3">
          <div className="flex items-end gap-2">
            <Textarea
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="Digite uma mensagem... (Enter para enviar)"
              disabled={sending}
              rows={1}
              className="min-h-[36px] max-h-[120px] resize-none bg-muted border-border text-sm placeholder:text-muted-foreground focus:border-primary/50"
            />
            <Button
              onClick={handleSend}
              disabled={sending || !input.trim()}
              size="icon"
              className="h-9 w-9 shrink-0 bg-amber-fire-500 text-[#0F1219] hover:bg-amber-fire-400"
            >
              <Send className="h-3.5 w-3.5" />
            </Button>
          </div>
        </div>
      </div>

      {/* Painel lateral */}
      {conversation && (
        <SidePanel conversation={conversation} onUpdate={fetchFull} onDelete={onDelete} />
      )}
    </div>
  );
}
