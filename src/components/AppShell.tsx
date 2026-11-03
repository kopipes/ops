import { redirect } from "next/navigation";
import { BottomNav, type Tab } from "@/components/BottomNav";
import { SideNav } from "@/components/SideNav";
import { currentSession, requireUser } from "@/server/auth/current-user";

/** Icon paths (Feather-style, stroke-based). */
const ICONS = {
  home: "M3 10.5 12 3l9 7.5M5 9.5V21h14V9.5",
  folder: "M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z",
  alert: "M12 9v4m0 4h.01M10.3 3.9 2.4 17.6A2 2 0 0 0 4.1 20.6h15.8a2 2 0 0 0 1.7-3z",
  chart: "M4 20V10m6 10V4m6 16v-7m4 7H2",
  user: "M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2M12 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8",
} as const;

export async function AppShell({
  children,
  contentWidth = "wide",
}: {
  children: React.ReactNode;
  contentWidth?: "wide" | "form";
}) {
  const session = await requireUser();

  // §4.1: a reset account must set a new password before using the app.
  if (session.mustChangePassword) redirect("/me/password");

  // §12: Report tab only for roles that may see it.
  const canSeeReports = ["admin", "corporate", "manager"].includes(session.user.role);

  const tabs: Tab[] = [
    { href: "/", label: "Hari Ini", icon: ICONS.home },
    { href: "/projects", label: "Project", icon: ICONS.folder },
    { href: "/issues", label: "Issues", icon: ICONS.alert },
    ...(canSeeReports ? [{ href: "/reports", label: "Report", icon: ICONS.chart }] : []),
    { href: "/me", label: "Akun", icon: ICONS.user },
  ];

  return (
    <div className="lg:flex lg:min-h-dvh">
      <SideNav
        tabs={tabs}
        userName={session.name}
        userRole={session.user.role}
        canSeeReports={canSeeReports}
      />

      {/* Below lg the sidebar is hidden and the bottom bar is shown. The
          content column keeps the mobile width on small screens and expands
          to a comfortable reading width on desktop. */}
      <div className="flex min-w-0 flex-1 flex-col lg:pl-60">
        <main className={`mx-auto w-full max-w-lg flex-1 px-4 pt-5 lg:px-8 lg:py-8 ${contentWidth === "form" ? "lg:max-w-3xl" : "lg:max-w-7xl"}`}>
          {children}
        </main>
      </div>

      <BottomNav tabs={tabs} />
    </div>
  );
}

/** Re-exported so pages can import both from one place. */
export { currentSession };
