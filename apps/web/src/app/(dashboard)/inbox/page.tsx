"use client";

import { useEffect, useState, useCallback } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useOrganization } from "@/providers/organization-provider";
import { createClient } from "@/lib/supabase/client";
import { useRealtime } from "@/lib/realtime";
import { ConversationList } from "@/components/inbox/conversation-list";
import { ChatPanel } from "@/components/inbox/chat-panel";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Search } from "lucide-react";

interface ConversationRow {
  id: string;
  status: string;
  is_human_takeover: boolean;
  last_message_at: string;
  tags: string[];
  assigned_to: string | null;
  contacts: { phone: string; name: string | null };
  agents: { name: string };
}

export default function InboxPage() {
  const { currentOrg } = useOrganization();
  const router = useRouter();
  const searchParams = useSearchParams();
  const [conversations, setConversations] = useState<ConversationRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [search, setSearch] = useState("");

  const selectedId = searchParams.get("id");

  const fetchConversations = useCallback(async () => {
    if (!currentOrg) {
      setLoading(false);
      return;
    }
    setLoading(true);
    const supabase = createClient();

    let query = supabase
      .from("conversations")
      .select("*, contacts(phone, name), agents(name)")
      .eq("organization_id", currentOrg.id)
      .order("last_message_at", { ascending: false });

    if (statusFilter !== "all") {
      query = query.eq("status", statusFilter);
    }

    const { data, error: queryError } = await query;
    if (queryError) {
      setError("Erro ao carregar conversas. Tente novamente.");
      setLoading(false);
      return;
    }
    setError(null);
    setConversations((data as ConversationRow[]) || []);
    setLoading(false);
  }, [currentOrg, statusFilter]);

  useEffect(() => {
    fetchConversations();
  }, [fetchConversations]);

  // Pass fetchConversations directly (stable useCallback ref) instead of
  // inline arrows (() => fetchConversations()) which create new references
  // on every render and cause the realtime channel to be recreated
  useRealtime({
    table: "conversations",
    filter: currentOrg ? `organization_id=eq.${currentOrg.id}` : undefined,
    onInsert: fetchConversations,
    onUpdate: fetchConversations,
    enabled: !!currentOrg,
  });

  const handleSelect = (id: string) => {
    router.push(`/inbox?id=${id}`);
  };

  const filtered = search
    ? conversations.filter((c) => {
        const lower = search.toLowerCase();
        return (
          c.contacts?.name?.toLowerCase().includes(lower) ||
          c.contacts?.phone?.includes(search)
        );
      })
    : conversations;

  if (loading) return <div className="p-6">Carregando...</div>;

  if (error) {
    return (
      <div className="flex h-[calc(100vh-8rem)] -m-6">
        <div className="flex w-80 flex-col border-r">
          <div className="space-y-2 border-b p-3">
            <div className="relative">
              <Search className="absolute left-2 top-2.5 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Buscar..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="pl-8"
              />
            </div>
            <Select value={statusFilter} onValueChange={setStatusFilter}>
              <SelectTrigger>
                <SelectValue placeholder="Filtrar status" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Todos</SelectItem>
                <SelectItem value="open">Abertos</SelectItem>
                <SelectItem value="waiting">Aguardando</SelectItem>
                <SelectItem value="resolved">Resolvidos</SelectItem>
                <SelectItem value="closed">Fechados</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="flex flex-1 items-center justify-center p-4">
            <div className="text-center">
              <p className="text-sm text-destructive">{error}</p>
              <button
                onClick={fetchConversations}
                className="mt-2 text-xs text-muted-foreground underline"
              >
                Tentar novamente
              </button>
            </div>
          </div>
        </div>
        <div className="flex flex-1 items-center justify-center text-muted-foreground">
          <p>Selecione uma conversa</p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-[calc(100vh-8rem)] -m-6">
      <div className="flex w-80 flex-col border-r">
        <div className="space-y-2 border-b p-3">
          <div className="relative">
            <Search className="absolute left-2 top-2.5 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Buscar..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pl-8"
            />
          </div>
          <Select value={statusFilter} onValueChange={setStatusFilter}>
            <SelectTrigger>
              <SelectValue placeholder="Filtrar status" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Todos</SelectItem>
              <SelectItem value="open">Abertos</SelectItem>
              <SelectItem value="waiting">Aguardando</SelectItem>
              <SelectItem value="resolved">Resolvidos</SelectItem>
              <SelectItem value="closed">Fechados</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="flex-1 overflow-y-auto">
          <ConversationList
            conversations={filtered}
            selectedId={selectedId}
            onSelect={handleSelect}
          />
        </div>
      </div>

      <div className="flex flex-1 overflow-hidden">
        {selectedId ? (
          <ChatPanel conversationId={selectedId} />
        ) : (
          <div className="flex flex-1 items-center justify-center text-muted-foreground">
            <p>Selecione uma conversa</p>
          </div>
        )}
      </div>
    </div>
  );
}
