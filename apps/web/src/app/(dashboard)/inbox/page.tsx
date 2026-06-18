"use client";

import { Suspense, useEffect, useState, useCallback, useRef } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useOrganization } from "@/providers/organization-provider";
import { useRealtime } from "@/lib/realtime";
import { apiFetch } from "@/lib/api";
import { ConversationList } from "@/components/inbox/conversation-list";
import { ChatPanel } from "@/components/inbox/chat-panel";
import { Input } from "@/components/ui/input";
import { Search, MessageSquare, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";

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

interface PaginatedConversations {
  conversations: ConversationRow[];
  total: number;
  page: number;
  limit: number;
  hasMore: boolean;
}

const STATUS_TABS = [
  { value: "all", label: "Todas" },
  { value: "open", label: "Abertas" },
  { value: "waiting", label: "Aguardando" },
  { value: "resolved", label: "Resolvidas" },
  { value: "closed", label: "Fechadas" },
];

const LIMIT = 50;

function buildUrl(orgId: string, status: string, page: number): string {
  let url = `/organizations/${orgId}/conversations?page=${page}&limit=${LIMIT}`;
  if (status !== "all") url += `&status=${status}`;
  return url;
}

function InboxContent() {
  const { currentOrg } = useOrganization();
  const router = useRouter();
  const searchParams = useSearchParams();
  const [conversations, setConversations] = useState<ConversationRow[]>([]);
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [search, setSearch] = useState("");
  const fetchCounterRef = useRef(0);

  const selectedId = searchParams.get("id");

  const fetchConversations = useCallback(async () => {
    if (!currentOrg) {
      setLoading(false);
      return;
    }
    const myCount = ++fetchCounterRef.current;
    setLoading(true);

    try {
      const data = await apiFetch(buildUrl(currentOrg.id, statusFilter, 1)) as PaginatedConversations;
      if (fetchCounterRef.current !== myCount) return;
      setError(null);
      setConversations(data.conversations ?? []);
      setHasMore(data.hasMore ?? false);
      setPage(1);
    } catch {
      if (fetchCounterRef.current !== myCount) return;
      setError("Erro ao carregar conversas. Tente novamente.");
    } finally {
      if (fetchCounterRef.current === myCount) setLoading(false);
    }
  }, [currentOrg, statusFilter]);

  useEffect(() => {
    fetchConversations();
  }, [fetchConversations]);

  const handleLoadMore = useCallback(async () => {
    if (!hasMore || !currentOrg || loadingMore) return;
    const nextPage = page + 1;
    setLoadingMore(true);
    try {
      const data = await apiFetch(buildUrl(currentOrg.id, statusFilter, nextPage)) as PaginatedConversations;
      setConversations((prev) => [...prev, ...(data.conversations ?? [])]);
      setHasMore(data.hasMore ?? false);
      setPage(nextPage);
    } catch {
      // silently fail — user can retry by clicking again
    } finally {
      setLoadingMore(false);
    }
  }, [currentOrg, statusFilter, hasMore, page, loadingMore]);

  const handleRealtimeInsert = useCallback((newRow: Record<string, unknown>) => {
    if (!currentOrg) return;
    const conv: ConversationRow = {
      id: newRow.id as string,
      status: newRow.status as string,
      is_human_takeover: (newRow.is_human_takeover as boolean) ?? false,
      last_message_at: (newRow.last_message_at as string) ?? new Date().toISOString(),
      tags: (newRow.tags as string[]) ?? [],
      assigned_to: (newRow.assigned_to as string | null) ?? null,
      contacts: (newRow.contacts as ConversationRow["contacts"]) ?? { phone: "", name: null },
      agents: (newRow.agents as ConversationRow["agents"]) ?? { name: "" },
    };
    setConversations((prev) => [conv, ...prev]);
  }, [currentOrg]);

  const handleRealtimeUpdate = useCallback((updatedRow: Record<string, unknown>) => {
    setConversations((prev) =>
      prev.map((c) =>
        c.id === updatedRow.id
          ? {
              ...c,
              status: updatedRow.status as string,
              is_human_takeover: updatedRow.is_human_takeover as boolean,
              last_message_at: updatedRow.last_message_at as string,
              tags: updatedRow.tags as string[],
              assigned_to: updatedRow.assigned_to as string | null,
            }
          : c
      )
    );
  }, []);

  useRealtime({
    table: "conversations",
    filter: currentOrg ? `organization_id=eq.${currentOrg.id}` : undefined,
    onInsert: handleRealtimeInsert,
    onUpdate: handleRealtimeUpdate,
    enabled: !!currentOrg,
  });

  const handleSelect = (id: string) => {
    router.push(`/inbox?id=${id}`);
  };

  const handleDelete = useCallback(async (id: string) => {
    try {
      await apiFetch(`/conversations/${id}`, { method: "DELETE" });
    } catch (err) {
      alert(err instanceof Error ? err.message : "Erro ao apagar conversa");
      return;
    }

    setConversations((prev) => {
      const idx = prev.findIndex((c) => c.id === id);
      const next = prev[idx + 1] ?? prev[idx - 1] ?? null;
      if (id === selectedId) {
        if (next) {
          router.push(`/inbox?id=${next.id}`);
        } else {
          router.push("/inbox");
        }
      }
      return prev.filter((c) => c.id !== id);
    });
  }, [selectedId, router]);

  const filtered = search
    ? conversations.filter((c) => {
        const lower = search.toLowerCase();
        return (
          c.contacts?.name?.toLowerCase().includes(lower) ||
          c.contacts?.phone?.includes(search)
        );
      })
    : conversations;

  const listContent = () => {
    if (loading) {
      return (
        <div className="space-y-px p-2">
          {[...Array(6)].map((_, i) => (
            <div key={i} className="flex items-center gap-3 rounded-lg px-3 py-3">
              <div className="h-9 w-9 animate-pulse rounded-full bg-muted" />
              <div className="flex-1 space-y-1.5">
                <div className="h-3 animate-pulse rounded bg-muted w-2/3" />
                <div className="h-2.5 animate-pulse rounded bg-muted w-1/2" />
              </div>
            </div>
          ))}
        </div>
      );
    }
    if (error) {
      return (
        <div className="flex flex-col items-center gap-2 p-6 text-center">
          <p className="text-sm text-destructive">{error}</p>
          <button
            onClick={fetchConversations}
            className="text-xs text-blue-electric-300 underline hover:text-blue-electric-400"
          >
            Tentar novamente
          </button>
        </div>
      );
    }
    return (
      <>
        <ConversationList
          conversations={filtered}
          selectedId={selectedId}
          onSelect={handleSelect}
          onDelete={handleDelete}
        />
        {hasMore && (
          <div className="p-2">
            <button
              data-testid="load-more-button"
              onClick={handleLoadMore}
              disabled={loadingMore}
              className="w-full rounded-lg border border-border py-2 text-xs text-muted-foreground hover:bg-accent disabled:opacity-60"
            >
              {loadingMore ? (
                <span className="flex items-center justify-center gap-1.5">
                  <Loader2 className="h-3 w-3 animate-spin" />
                  Carregando...
                </span>
              ) : (
                "Carregar mais"
              )}
            </button>
          </div>
        )}
      </>
    );
  };

  return (
    <div className="flex h-screen -m-6 overflow-hidden">
      {/* Coluna esquerda — lista */}
      <div className="flex w-[280px] shrink-0 flex-col border-r border-border bg-card">
        {/* Busca */}
        <div className="border-b border-border p-3">
          <div className="relative">
            <Search className="absolute left-2.5 top-2.5 h-3.5 w-3.5 text-muted-foreground" />
            <Input
              placeholder="Buscar conversa..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="h-8 pl-8 text-xs bg-muted border-transparent focus:border-primary/50"
            />
          </div>
        </div>

        {/* Tabs de status */}
        <div className="flex border-b border-border px-2 overflow-x-auto scrollbar-hide">
          {STATUS_TABS.map((tab) => (
            <button
              key={tab.value}
              onClick={() => setStatusFilter(tab.value)}
              className={cn(
                "shrink-0 whitespace-nowrap px-2.5 py-2.5 text-[11px] font-medium transition-colors",
                statusFilter === tab.value
                  ? "border-b-2 border-blue-electric-400 text-blue-electric-300"
                  : "text-muted-foreground hover:text-foreground"
              )}
            >
              {tab.label}
            </button>
          ))}
        </div>

        {/* Lista */}
        <div className="flex-1 overflow-y-auto">{listContent()}</div>
      </div>

      {/* Coluna direita — chat */}
      <div className="flex flex-1 overflow-hidden">
        {selectedId ? (
          <ChatPanel conversationId={selectedId} onDelete={() => handleDelete(selectedId!)} />
        ) : (
          <div className="flex flex-1 flex-col items-center justify-center gap-3 text-center">
            <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-muted">
              <MessageSquare className="h-6 w-6 text-muted-foreground" />
            </div>
            <div>
              <p className="text-sm font-medium text-foreground">Nenhuma conversa selecionada</p>
              <p className="text-xs text-muted-foreground">Selecione uma conversa à esquerda</p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

export default function InboxPage() {
  return (
    <Suspense
      fallback={
        <div className="flex h-full items-center justify-center">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      }
    >
      <InboxContent />
    </Suspense>
  );
}
