"use client";

import { useState, useEffect } from "react";
import { apiFetch } from "@/lib/api";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { UserCheck, Bot } from "lucide-react";
import { cn } from "@/lib/utils";

interface TakeoverBarProps {
  conversationId: string;
  isHumanTakeover: boolean;
  assignedTo: string | null;
  organizationId: string;
  onUpdate: () => void;
}

export function TakeoverBar({
  conversationId,
  isHumanTakeover,
  assignedTo,
  organizationId,
  onUpdate,
}: TakeoverBarProps) {
  const [members, setMembers] = useState<Array<{ user_id: string; email: string; role: string }>>([]);

  const roleLabel: Record<string, string> = {
    owner: "Gerente",
    admin: "Supervisor",
    agent: "Atendente",
  };

  useEffect(() => {
    apiFetch(`/organizations/${organizationId}/members`)
      .then((data) => setMembers(data.members || []))
      .catch(() => {});
  }, [organizationId]);

  const handleTakeover = async () => {
    try {
      await apiFetch(`/conversations/${conversationId}/takeover`, {
        method: "PATCH",
        body: JSON.stringify({ takeover: !isHumanTakeover }),
      });
      onUpdate();
    } catch (err) {
      alert(err instanceof Error ? err.message : "Erro ao atualizar atendimento");
    }
  };

  const handleAssign = async (userId: string) => {
    try {
      await apiFetch(`/conversations/${conversationId}/assignment`, {
        method: "PATCH",
        body: JSON.stringify({ assigned_to: userId === "none" ? null : userId }),
      });
      onUpdate();
    } catch (err) {
      alert(err instanceof Error ? err.message : "Erro ao atribuir conversa");
    }
  };

  return (
    <div className="space-y-2">
      {isHumanTakeover && (
        <div className="rounded-lg border border-amber-fire-500/30 bg-amber-fire-500/10 px-3 py-2">
          <p className="text-[11px] font-medium text-amber-fire-400">
            Atendimento humano ativo
          </p>
        </div>
      )}

      <Button
        variant={isHumanTakeover ? "outline" : "default"}
        size="sm"
        onClick={handleTakeover}
        className={cn(
          "w-full text-xs",
          !isHumanTakeover && "bg-primary hover:bg-blue-electric-400"
        )}
      >
        {isHumanTakeover ? (
          <>
            <Bot className="mr-1.5 h-3.5 w-3.5" />
            Devolver ao Agente
          </>
        ) : (
          <>
            <UserCheck className="mr-1.5 h-3.5 w-3.5" />
            Assumir Conversa
          </>
        )}
      </Button>

      <Select value={assignedTo || "none"} onValueChange={handleAssign}>
        <SelectTrigger className="h-8 text-xs bg-muted border-border">
          <SelectValue placeholder="Atribuir a..." />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="none">Ninguém</SelectItem>
          {members.map((m) => (
            <SelectItem key={m.user_id} value={m.user_id}>
              {m.email} · {roleLabel[m.role] ?? m.role}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}
