"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { Inbox, Bot, RefreshCw, Radio, Users, Settings, Zap, LogOut, CreditCard, UserCheck, Package, BookOpen } from "lucide-react";
import { OrgSwitcher } from "./org-switcher";
import { createClient } from "@/lib/supabase/client";
import { cn } from "@/lib/utils";
import { useOrganization } from "@/providers/organization-provider";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

const navigation = [
  { name: "Inbox", href: "/inbox", icon: Inbox },
  { name: "Leads", href: "/leads", icon: UserCheck },
  { name: "Produtos", href: "/products", icon: Package },
  { name: "Agentes", href: "/agents", icon: Bot },
  { name: "Biblioteca de Prompts", href: "/prompt-library", icon: BookOpen },
  { name: "Remarketing", href: "/remarketing", icon: RefreshCw },
  { name: "Instâncias", href: "/instances", icon: Radio },
  { name: "Equipe", href: "/team", icon: Users },
  { name: "Assinatura", href: "/settings/billing", icon: CreditCard, adminOnly: true },
  { name: "Configurações", href: "/settings", icon: Settings, exact: true },
] as const;

interface AppSidebarProps {
  email: string;
}

export function AppSidebar({ email }: AppSidebarProps) {
  const pathname = usePathname();
  const router = useRouter();
  const { currentRole } = useOrganization();
  const initials = email.slice(0, 2).toUpperCase();
  const isAdmin = currentRole === "owner" || currentRole === "admin";

  const handleLogout = async () => {
    const supabase = createClient();
    await supabase.auth.signOut();
    router.push("/login");
    router.refresh();
  };

  return (
    <aside className="group/sidebar relative flex h-screen w-16 shrink-0 flex-col overflow-hidden border-r border-border bg-card transition-all duration-200 ease-in-out hover:w-60">
      {/* Logo */}
      <div className="flex h-14 items-center border-b border-border px-4">
        <div className="flex items-center gap-3 overflow-hidden">
          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-blue-electric-400">
            <Zap className="h-4 w-4 fill-current" />
          </div>
          <span className="whitespace-nowrap text-sm font-semibold text-foreground opacity-0 transition-opacity duration-150 group-hover/sidebar:opacity-100">
            MDEK Digital
          </span>
        </div>
      </div>

      {/* Org switcher */}
      <div className="border-b border-border px-2 py-2">
        <OrgSwitcher />
      </div>

      {/* Nav */}
      <nav className="flex flex-1 flex-col gap-1 p-2">
        {navigation.map((item) => {
          if ("adminOnly" in item && item.adminOnly && !isAdmin) return null;
          const isActive = "exact" in item && item.exact
            ? pathname === item.href
            : pathname.startsWith(item.href);
          return (
            <Link
              key={item.name}
              href={item.href}
              className={cn(
                "relative flex h-9 items-center gap-3 overflow-hidden rounded-md px-2.5 text-sm font-medium transition-all duration-150",
                isActive
                  ? "border-l-[3px] border-blue-electric-400 bg-blue-electric-500/10 pl-[7px] text-blue-electric-300"
                  : "border-l-[3px] border-transparent text-muted-foreground hover:bg-accent hover:text-foreground"
              )}
            >
              <item.icon
                className={cn(
                  "h-[18px] w-[18px] shrink-0",
                  isActive ? "text-blue-electric-400" : "text-muted-foreground"
                )}
              />
              <span className="whitespace-nowrap opacity-0 transition-opacity duration-150 group-hover/sidebar:opacity-100">
                {item.name}
              </span>
            </Link>
          );
        })}
      </nav>

      {/* Footer — usuário */}
      <div className="border-t border-border p-2">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button className="flex h-10 w-full items-center gap-3 overflow-hidden rounded-md px-2 transition-colors hover:bg-accent focus-visible:outline-none">
              {/* Avatar */}
              <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-primary/20 text-xs font-semibold text-blue-electric-300">
                {initials}
              </div>
              {/* Info — aparece quando expandido */}
              <div className="flex min-w-0 flex-1 flex-col items-start opacity-0 transition-opacity duration-150 group-hover/sidebar:opacity-100">
                <span className="w-full truncate text-xs font-medium text-foreground">
                  {email}
                </span>
                <div className="flex items-center gap-1.5 mt-0.5">
                  <span className="relative flex h-1.5 w-1.5">
                    <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-green-500 opacity-75" />
                    <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-green-500" />
                  </span>
                  <span className="text-[10px] text-muted-foreground">Online</span>
                </div>
              </div>
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent side="right" align="end" className="w-52 border-border bg-popover">
            <div className="px-2 py-2">
              <p className="text-xs font-semibold text-foreground">{initials}</p>
              <p className="truncate text-xs text-muted-foreground">{email}</p>
            </div>
            <DropdownMenuSeparator className="bg-border" />
            <DropdownMenuItem
              onClick={handleLogout}
              className="gap-2 text-sm text-destructive focus:text-destructive focus:bg-destructive/10"
            >
              <LogOut className="h-3.5 w-3.5" />
              Sair
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </aside>
  );
}
