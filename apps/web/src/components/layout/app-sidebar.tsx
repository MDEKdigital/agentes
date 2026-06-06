"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Inbox, Bot, Radio, Users, Settings, Zap } from "lucide-react";
import { OrgSwitcher } from "./org-switcher";
import { cn } from "@/lib/utils";

const navigation = [
  { name: "Inbox", href: "/inbox", icon: Inbox },
  { name: "Agentes", href: "/agents", icon: Bot },
  { name: "Instâncias", href: "/instances", icon: Radio },
  { name: "Equipe", href: "/team", icon: Users },
  { name: "Configurações", href: "/settings", icon: Settings },
];

export function AppSidebar() {
  const pathname = usePathname();

  return (
    <aside className="group/sidebar relative flex h-screen w-16 flex-col overflow-hidden border-r border-border bg-card transition-all duration-200 ease-in-out hover:w-60 shrink-0">
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
        <div className="overflow-hidden">
          <OrgSwitcher collapsed={true} />
        </div>
      </div>

      {/* Nav */}
      <nav className="flex flex-1 flex-col gap-1 p-2">
        {navigation.map((item) => {
          const isActive = pathname.startsWith(item.href);
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

              {/* Tooltip quando recolhido */}
              <div className="pointer-events-none absolute left-full ml-2 hidden whitespace-nowrap rounded-md bg-elevated px-2 py-1 text-xs font-medium text-foreground shadow-lg group-hover/sidebar:hidden group-[]/sidebar:block">
                {item.name}
              </div>
            </Link>
          );
        })}
      </nav>

      {/* Footer */}
      <div className="border-t border-border p-2">
        <div className="flex h-8 items-center gap-2 overflow-hidden rounded-md px-2.5">
          <div className="status-dot h-2 w-2 shrink-0 rounded-full bg-green-500" />
          <span className="whitespace-nowrap text-xs text-muted-foreground opacity-0 transition-opacity duration-150 group-hover/sidebar:opacity-100">
            Sistema online
          </span>
        </div>
      </div>
    </aside>
  );
}
