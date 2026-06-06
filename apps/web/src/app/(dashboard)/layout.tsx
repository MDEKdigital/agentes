import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { OrganizationProvider } from "@/providers/organization-provider";
import { AppSidebar } from "@/components/layout/app-sidebar";
import { UserNav } from "@/components/layout/user-nav";

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  return (
    <OrganizationProvider>
      <div className="flex h-screen overflow-hidden bg-background">
        <AppSidebar />
        <div className="flex flex-1 flex-col overflow-hidden">
          <header className="flex h-14 shrink-0 items-center justify-between border-b border-border bg-card/50 px-6 backdrop-blur-sm">
            {/* Breadcrumb — preenchido pelas pages via slot futuro, por ora vazio */}
            <div />
            <UserNav email={user.email!} />
          </header>
          <main className="flex-1 overflow-y-auto p-6">{children}</main>
        </div>
      </div>
    </OrganizationProvider>
  );
}
