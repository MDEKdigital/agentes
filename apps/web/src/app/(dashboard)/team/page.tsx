"use client";

import { useEffect, useState, useCallback } from "react";
import { useOrganization } from "@/providers/organization-provider";
import { createClient } from "@/lib/supabase/client";
import { MembersList } from "@/components/team/members-list";
import { InviteDialog } from "@/components/team/invite-dialog";
import { Users, Mail, Clock } from "lucide-react";

interface Member {
  id: string;
  user_id: string;
  email: string;
  role: string;
  created_at: string;
}

interface Invitation {
  id: string;
  email: string;
  role: string;
  expires_at: string;
}

const roleBadge: Record<string, string> = {
  owner: "bg-amber-fire-500/10 text-amber-fire-400 border border-amber-fire-500/30",
  admin: "bg-primary/10 text-blue-electric-300 border border-primary/30",
  agent: "bg-muted text-muted-foreground border border-border",
};

export default function TeamPage() {
  const { currentOrg } = useOrganization();
  const [members, setMembers] = useState<Member[]>([]);
  const [invitations, setInvitations] = useState<Invitation[]>([]);
  const [currentUserId, setCurrentUserId] = useState<string>("");
  const [currentUserRole, setCurrentUserRole] = useState<string>("");
  const [loading, setLoading] = useState(true);

  const fetchData = useCallback(async () => {
    if (!currentOrg) { setLoading(false); return; }
    const supabase = createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) { setLoading(false); return; }

    setCurrentUserId(user.id);

    const [membersResult, invitationsResult] = await Promise.all([
      supabase.rpc("get_org_members_with_email", { p_org_id: currentOrg.id }),
      supabase
        .from("organization_invitations")
        .select("*")
        .eq("organization_id", currentOrg.id)
        .eq("status", "pending")
        .order("created_at", { ascending: false }),
    ]);

    const membersList = (membersResult.data || []) as Member[];
    setMembers(membersList);
    setInvitations((invitationsResult.data || []) as Invitation[]);

    const myMembership = membersList.find((m) => m.user_id === user.id);
    setCurrentUserRole(myMembership?.role || "agent");
    setLoading(false);
  }, [currentOrg]);

  useEffect(() => { fetchData(); }, [fetchData]);

  if (loading) {
    return (
      <div className="mx-auto max-w-2xl space-y-6">
        <div className="flex items-center justify-between">
          <div className="h-7 w-32 animate-pulse rounded-lg bg-muted" />
          <div className="h-9 w-36 animate-pulse rounded-lg bg-muted" />
        </div>
        <div className="rounded-xl border border-border bg-card p-6 space-y-4">
          {[...Array(3)].map((_, i) => (
            <div key={i} className="flex items-center gap-3 py-3">
              <div className="h-8 w-8 animate-pulse rounded-full bg-muted" />
              <div className="flex-1 space-y-1.5">
                <div className="h-3.5 animate-pulse rounded bg-muted w-48" />
                <div className="h-2.5 animate-pulse rounded bg-muted w-24" />
              </div>
            </div>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold text-foreground">Equipe</h1>
          <p className="text-xs text-muted-foreground mt-0.5">
            {members.length} {members.length === 1 ? "membro" : "membros"}
          </p>
        </div>
        {(currentUserRole === "owner" || currentUserRole === "admin") && (
          <InviteDialog onInvited={fetchData} />
        )}
      </div>

      {/* Membros */}
      <div className="rounded-xl border border-border bg-card">
        <div className="flex items-center gap-2 border-b border-border px-6 py-4">
          <Users className="h-4 w-4 text-blue-electric-400" />
          <h2 className="text-sm font-semibold text-foreground">Membros</h2>
        </div>
        <div className="px-6 pb-4">
          <MembersList
            members={members}
            currentUserId={currentUserId}
            currentUserRole={currentUserRole}
            onRefresh={fetchData}
          />
        </div>
      </div>

      {/* Convites pendentes */}
      {invitations.length > 0 && (
        <div className="rounded-xl border border-border bg-card">
          <div className="flex items-center gap-2 border-b border-border px-6 py-4">
            <Mail className="h-4 w-4 text-amber-fire-400" />
            <h2 className="text-sm font-semibold text-foreground">
              Convites Pendentes
            </h2>
            <span className="ml-auto rounded-full bg-amber-fire-500/10 px-2 py-0.5 text-[11px] font-medium text-amber-fire-400">
              {invitations.length}
            </span>
          </div>
          <div className="divide-y divide-border">
            {invitations.map((inv) => (
              <div key={inv.id} className="flex items-center justify-between px-6 py-4">
                <div className="flex items-center gap-3">
                  <div className="flex h-8 w-8 items-center justify-center rounded-full border border-dashed border-border">
                    <Mail className="h-3.5 w-3.5 text-muted-foreground" />
                  </div>
                  <div>
                    <p className="text-sm font-medium text-foreground">{inv.email}</p>
                    <div className="flex items-center gap-1 mt-0.5">
                      <Clock className="h-2.5 w-2.5 text-muted-foreground" />
                      <p className="text-[11px] text-muted-foreground">
                        Expira em {new Date(inv.expires_at).toLocaleDateString("pt-BR")}
                      </p>
                    </div>
                  </div>
                </div>
                <span className={`rounded-md px-2 py-0.5 text-[11px] font-medium capitalize ${roleBadge[inv.role] ?? roleBadge.agent}`}>
                  {inv.role}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
