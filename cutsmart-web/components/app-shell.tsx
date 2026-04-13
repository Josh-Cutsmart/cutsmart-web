"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Building2, ClipboardList, Factory, FolderKanban, LayoutDashboard, LogOut, Settings } from "lucide-react";
import { useAuth } from "@/lib/auth-context";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";

const nav = [
  { href: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
  { href: "/company-settings", label: "Company Settings", icon: Settings },
  { href: "/cutlists/initial", label: "Initial Cutlist", icon: ClipboardList },
  { href: "/cutlists/production", label: "Production", icon: Factory },
];

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const { user, logout, isDemoMode } = useAuth();

  return (
    <div className="flex min-h-screen bg-[var(--bg-app)]">
      <aside className="flex min-h-screen w-[230px] shrink-0 flex-col border-r border-[var(--panel-border)] bg-white">
        <div className="border-b border-[var(--panel-border)] px-4 py-3">
          <div className="flex items-center gap-2">
            <div className="rounded-[10px] border border-[var(--panel-border)] bg-[var(--brand)] p-2 text-white">
              <Building2 size={16} />
            </div>
            <div>
              <p className="text-[11px] uppercase tracking-[0.2em] text-[var(--text-muted)]">CutSmart</p>
              <p className="text-[13px] font-bold text-[var(--text-main)]">Web Workspace</p>
            </div>
          </div>
        </div>

        <nav className="flex-1 space-y-1 px-3 py-3">
          {nav.map((item) => {
            const active = pathname?.startsWith(item.href);
            const Icon = item.icon;
            return (
              <Link
                key={item.href}
                href={item.href}
                className={cn(
                  "flex items-center gap-2 rounded-[10px] border px-3 py-2 text-[12px] font-bold transition",
                  active
                    ? "border-[var(--panel-border)] bg-[var(--panel-muted)] text-[var(--brand)]"
                    : "border-transparent text-[#475467] hover:border-[#E4E7EC] hover:bg-[#F7F8FC]",
                )}
              >
                <Icon size={16} />
                {item.label}
              </Link>
            );
          })}
          <Link
            href="/projects/prj_1001"
            className="mt-2 flex items-center gap-2 rounded-[10px] border border-transparent px-3 py-2 text-[12px] font-bold text-[#475467] transition hover:border-[#E4E7EC] hover:bg-[#F7F8FC]"
          >
            <FolderKanban size={16} />
            Project Details
          </Link>
        </nav>

        <div className="border-t border-[var(--panel-border)] px-3 py-3">
          <div className="mb-2 flex items-center gap-2 text-sm text-[#667085]">
            <span className="rounded-[8px] bg-[#EEF2F7] px-2 py-1 text-[12px] font-semibold text-[#344054]">
              {user?.displayName}
            </span>
            <span className="rounded-[8px] border border-[#D7DEE8] bg-[#F7F8FC] px-2 py-1 text-[11px] uppercase tracking-wide text-[#475467]">
              {user?.role ?? "guest"}
            </span>
          </div>
          {isDemoMode && (
            <span className="mb-2 inline-flex rounded-[8px] border border-[#F1D46A] bg-[#FFF7CC] px-2 py-1 text-[11px] font-bold text-[#7A5A00]">
              Demo data mode
            </span>
          )}
          <Button variant="ghost" size="sm" className="h-8 w-full justify-start" onClick={() => void logout()}>
            <LogOut size={14} className="mr-2" />
            Sign out
          </Button>
        </div>
      </aside>

      <div className="min-w-0 flex-1">
        <main className="min-w-0 px-4 py-4 md:px-5">{children}</main>
      </div>
    </div>
  );
}
