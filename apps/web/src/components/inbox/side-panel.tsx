"use client";

import { TakeoverBar } from "./takeover-bar";
import { TagsInput } from "./tags-input";
import { NotesPanel } from "./notes-panel";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { apiFetch } from "@/lib/api";
import { Phone, User, Trash2, Ban, CheckCircle2 } from "lucide-react";
import type { ConversationStatus } from "@aula-agente/shared";

interface SidePanelProps {
  conversation: {
    id: string;
    organization_id: string;
    status: ConversationStatus;
    is_human_takeover: boolean;
    is_blocked: boolean;
    assigned_to: string | null;
    tags: string[];
    contacts: { phone: string; name: string | null };
  };
  onUpdate: () => void;
  onDelete: () => void;
}

function SectionHeader({ children }: { children: React.ReactNode }) {
  return (
    <p className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
      {children}
    </p>
  );
}

export function SidePanel({ conversation, onUpdate, onDelete }: SidePanelProps) {
  const handleStatusChange = async (status: string) => {
    try {
      await apiFetch(`/conversations/${conversation.id}/status`, {
        method: "PATCH",
        body: JSON.stringify({ status }),
      });
      onUpdate();
    } catch (err) {
      alert(err instanceof Error ? err.message : "Erro ao atualizar status");
    }
  };

  const handleToggleBlock = async () => {
    const newBlocked = !conversation.is_blocked;
    try {
      await apiFetch(`/conversations/${conversation.id}/block`, {
        method: "PATCH",
        body: JSON.stringify({ blocked: newBlocked }),
      });
      onUpdate();
    } catch (err) {
      alert(err instanceof Error ? err.message : "Erro ao atualizar bloqueio");
    }
  };

  return (
    <div className="flex w-[280px] shrink-0 flex-col overflow-y-auto border-l border-border bg-card">
      {/* Contato */}
      <div className="border-b border-border p-4">
        <SectionHeader>Contato</SectionHeader>
        <div className="flex items-center gap-3">
          <div className="flex h-9 w-9 items-center justify-center rounded-full bg-primary/10">
            <User className="h-4 w-4 text-blue-electric-300" />
          </div>
          <div className="min-w-0">
            <p className="truncate text-sm font-medium text-foreground">
              {conversation.contacts.name || "Sem nome"}
            </p>
            <div className="flex items-center gap-1 mt-0.5">
              <Phone className="h-2.5 w-2.5 text-muted-foreground" />
              <p className="font-mono text-[11px] text-muted-foreground">
                {conversation.contacts.phone}
              </p>
            </div>
          </div>
        </div>
      </div>

      {/* Status */}
      <div className="border-b border-border p-4">
        <SectionHeader>Status</SectionHeader>
        {conversation.is_blocked && (
          <div className="mb-2 flex items-center gap-1.5 rounded-md bg-destructive/10 px-2 py-1">
            <Ban className="h-3 w-3 text-destructive" />
            <span className="text-[11px] font-medium text-destructive">Conversa bloqueada</span>
          </div>
        )}

        <Select value={conversation.status} onValueChange={handleStatusChange}>
          <SelectTrigger className="h-8 text-xs bg-muted border-border">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="open">Aberto</SelectItem>
            <SelectItem value="waiting">Aguardando</SelectItem>
            <SelectItem value="resolved">Resolvido</SelectItem>
            <SelectItem value="closed">Fechado</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {/* Atendimento */}
      <div className="border-b border-border p-4">
        <SectionHeader>Atendimento</SectionHeader>
        <TakeoverBar
          conversationId={conversation.id}
          isHumanTakeover={conversation.is_human_takeover}
          assignedTo={conversation.assigned_to}
          organizationId={conversation.organization_id}
          onUpdate={onUpdate}
        />
      </div>

      {/* Tags */}
      <div className="border-b border-border p-4">
        <SectionHeader>Tags</SectionHeader>
        <TagsInput
          conversationId={conversation.id}
          tags={conversation.tags}
          onUpdate={onUpdate}
        />
      </div>

      {/* Notas */}
      <div className="border-b border-border p-4">
        <SectionHeader>Notas Internas</SectionHeader>
        <NotesPanel
          conversationId={conversation.id}
          organizationId={conversation.organization_id}
        />
      </div>

      {/* Ações */}
      <div className="mt-auto flex flex-col gap-2 p-4">
        <button
          onClick={handleToggleBlock}
          className={`flex w-full items-center justify-center gap-2 rounded-md border px-3 py-2 text-xs font-medium transition-colors ${
            conversation.is_blocked
              ? "border-amber-500/30 text-amber-500 hover:bg-amber-500/10"
              : "border-destructive/30 text-destructive hover:bg-destructive/10"
          }`}
        >
          {conversation.is_blocked ? (
            <>
              <CheckCircle2 className="h-3.5 w-3.5" />
              Desbloquear conversa
            </>
          ) : (
            <>
              <Ban className="h-3.5 w-3.5" />
              Bloquear conversa
            </>
          )}
        </button>
        <button
          onClick={onDelete}
          className="flex w-full items-center justify-center gap-2 rounded-md border border-destructive/30 px-3 py-2 text-xs font-medium text-destructive hover:bg-destructive/10 transition-colors"
        >
          <Trash2 className="h-3.5 w-3.5" />
          Apagar conversa
        </button>
      </div>
    </div>
  );
}
