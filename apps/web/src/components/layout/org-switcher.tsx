"use client";

import { useOrganization } from "@/providers/organization-provider";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Building2, ChevronsUpDown, Check } from "lucide-react";
import { cn } from "@/lib/utils";

interface OrgSwitcherProps {
  collapsed?: boolean;
}

export function OrgSwitcher({ collapsed }: OrgSwitcherProps) {
  const { organizations, currentOrg, setCurrentOrg } = useOrganization();

  if (!currentOrg) return null;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          className={cn(
            "flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm transition-colors hover:bg-accent",
            "focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
          )}
        >
          <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded bg-primary/20">
            <Building2 className="h-3.5 w-3.5 text-blue-electric-400" />
          </div>
          <span className="flex-1 truncate whitespace-nowrap text-xs font-medium text-foreground opacity-0 transition-opacity duration-150 group-hover/sidebar:opacity-100">
            {currentOrg.name}
          </span>
          <ChevronsUpDown className="h-3.5 w-3.5 shrink-0 text-muted-foreground opacity-0 transition-opacity duration-150 group-hover/sidebar:opacity-100" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="start"
        side="right"
        className="w-52 border-border bg-popover"
      >
        <p className="px-2 py-1.5 text-xs font-medium uppercase tracking-wider text-muted-foreground">
          Organizações
        </p>
        {organizations.map((org) => (
          <DropdownMenuItem
            key={org.id}
            onClick={() => setCurrentOrg(org)}
            className="gap-2 text-sm"
          >
            <div className="flex h-5 w-5 items-center justify-center rounded bg-primary/20">
              <Building2 className="h-3 w-3 text-blue-electric-400" />
            </div>
            <span className="flex-1 truncate">{org.name}</span>
            {org.id === currentOrg.id && (
              <Check className="h-3.5 w-3.5 text-blue-electric-400" />
            )}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
