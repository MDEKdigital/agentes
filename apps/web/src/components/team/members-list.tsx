"use client";

import { createClient } from "@/lib/supabase/client";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Trash2 } from "lucide-react";
import { cn } from "@/lib/utils";

interface Member {
  id: string;
  user_id: string;
  email: string;
  role: string;
  created_at: string;
}

interface MembersListProps {
  members: Member[];
  currentUserId: string;
  currentUserRole: string;
  onRefresh: () => void;
}

const roleBadge: Record<string, string> = {
  owner: "bg-amber-fire-500/10 text-amber-fire-400 border border-amber-fire-500/30",
  admin: "bg-primary/10 text-blue-electric-300 border border-primary/30",
  agent: "bg-muted text-muted-foreground border border-border",
};

export function MembersList({ members, currentUserId, currentUserRole, onRefresh }: MembersListProps) {
  const canManage = currentUserRole === "owner" || currentUserRole === "admin";

  const handleRoleChange = async (memberId: string, newRole: string) => {
    const supabase = createClient();
    await supabase.from("organization_members").update({ role: newRole }).eq("id", memberId);
    onRefresh();
  };

  const handleRemove = async (memberId: string) => {
    if (!confirm("Remover este membro?")) return;
    const supabase = createClient();
    await supabase.from("organization_members").delete().eq("id", memberId);
    onRefresh();
  };

  return (
    <div className="divide-y divide-border">
      {members.map((member) => {
        const isCurrentUser = member.user_id === currentUserId;
        const isOwner = member.role === "owner";

        return (
          <div
            key={member.id}
            className="flex items-center justify-between py-3 transition-colors hover:bg-elevated/50 -mx-6 px-6"
          >
            <div className="flex items-center gap-3">
              <Avatar className="h-8 w-8">
                <AvatarFallback className="bg-primary/10 text-blue-electric-300 text-xs font-semibold">
                  {member.email.slice(0, 2).toUpperCase()}
                </AvatarFallback>
              </Avatar>
              <div>
                <p className="text-sm font-medium text-foreground">
                  {member.email}
                  {isCurrentUser && (
                    <span className="ml-1.5 text-[11px] text-muted-foreground">(você)</span>
                  )}
                </p>
                <p className="text-[11px] text-muted-foreground">
                  Desde {new Date(member.created_at).toLocaleDateString("pt-BR")}
                </p>
              </div>
            </div>

            <div className="flex items-center gap-2">
              {canManage && !isOwner && !isCurrentUser ? (
                <>
                  <Select value={member.role} onValueChange={(v) => handleRoleChange(member.id, v)}>
                    <SelectTrigger className="h-7 w-28 text-xs bg-muted border-border">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="admin">Admin</SelectItem>
                      <SelectItem value="agent">Agente</SelectItem>
                    </SelectContent>
                  </Select>
                  {currentUserRole === "owner" && (
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() => handleRemove(member.id)}
                      className="h-7 w-7 text-muted-foreground hover:text-destructive hover:bg-destructive/10"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  )}
                </>
              ) : (
                <span className={cn(
                  "rounded-md px-2 py-0.5 text-[11px] font-medium capitalize",
                  roleBadge[member.role] ?? roleBadge.agent
                )}>
                  {member.role}
                </span>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}
