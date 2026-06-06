"use client";

import { useState, useEffect } from "react";
import { createClient } from "@/lib/supabase/client";
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
  const [members, setMembers] = useState<Array<{ user_id: string; role: string }>>([]);

  useEffect(() => {
    const fetchMembers = async () => {
      const supabase = createClient();
      const { data } = await supabase
        .from("organization_members")
        .select("user_id, role")
        .eq("organization_id", organizationId);
      setMembers(data || []);
    };
    fetchMembers();
  }, [organizationId]);

  const handleTakeover = async () => {
    const supabase = createClient();
    const { data: { user } } = await supabase.auth.getUser();
    await supabase
      .from("conversations")
      .update({
        is_human_takeover: !isHumanTakeover,
        human_takeover_at: !isHumanTakeover ? new Date().toISOString() : null,
        assigned_to: !isHumanTakeover ? user?.id : null,
      })
      .eq("id", conversationId);
    onUpdate();
  };

  const handleAssign = async (userId: string) => {
    const supabase = createClient();
    await supabase
      .from("conversations")
      .update({ assigned_to: userId === "none" ? null : userId })
      .eq("id", conversationId);
    onUpdate();
  };

  return (
    <div className="space-y-2">
      {/* Banner de takeover ativo */}
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
              {m.user_id.slice(0, 8)}... ({m.role})
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}
