import { Suspense } from "react";
import { redirect } from "next/navigation";
import { Loader2 } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { OrganizationProvider } from "@/providers/organization-provider";
import { AppSidebar } from "@/components/layout/app-sidebar";

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  return (
    <Suspense
      fallback={
        <div className="flex h-screen items-center justify-center bg-background">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      }
    >
      <OrganizationProvider>
        <div className="flex h-screen overflow-hidden bg-background">
          <AppSidebar email={user.email!} />
          <main className="flex-1 overflow-y-auto p-6">{children}</main>
        </div>
      </OrganizationProvider>
    </Suspense>
  );
}
