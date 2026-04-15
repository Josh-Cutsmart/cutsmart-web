"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { doc, serverTimestamp, setDoc } from "firebase/firestore";
import {
  Building2,
  LayoutDashboard,
  LogOut,
  PlusCircle,
  Settings,
  Trash2,
  UserCircle2,
  UserCog,
  Waves,
} from "lucide-react";
import { useAuth } from "@/lib/auth-context";
import { fetchCompanyDoc } from "@/lib/firestore-data";
import { db, hasFirebaseConfig } from "@/lib/firebase";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { fetchPrimaryMembership } from "@/lib/membership";
const ACTIVE_COMPANY_STORAGE_KEY = "cutsmart_active_company_id";

const topNav = [
  { href: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
  { href: "/recently-deleted", label: "Recently Deleted", icon: Trash2 },
  { href: "/company-updates", label: "Company Updates", icon: Waves },
  { href: "/company-settings", label: "Company Settings", icon: Settings },
];

const bottomNav = [{ href: "/user-settings", label: "User Settings", icon: UserCog }];

function initials(name: string) {
  const parts = String(name || "")
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  if (!parts.length) return "U";
  return parts
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase() ?? "")
    .join("");
}

function createProjectId() {
  const rand = Math.random().toString(36).slice(2, 8);
  return `prj_${Date.now().toString(36)}_${rand}`;
}

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const { user, logout, isDemoMode } = useAuth();
  const [showNewProject, setShowNewProject] = useState(false);
  const [projectName, setProjectName] = useState("");
  const [clientName, setClientName] = useState("");
  const [creatingProject, setCreatingProject] = useState(false);
  const [companyThemeColor, setCompanyThemeColor] = useState("#2F6BFF");

  const userInitials = useMemo(() => initials(user?.displayName || "User"), [user?.displayName]);
  const userEmblemColor = String(user?.userColor || "").trim() || companyThemeColor;

  useEffect(() => {
    const load = async () => {
      const storedCompanyId =
        typeof window !== "undefined" ? String(window.localStorage.getItem(ACTIVE_COMPANY_STORAGE_KEY) || "").trim() : "";
      const directCompanyId = String(user?.companyId || "").trim();
      const fallbackMembership = !directCompanyId && user?.uid ? await fetchPrimaryMembership(user.uid) : null;
      const companyId = storedCompanyId || directCompanyId || String(fallbackMembership?.companyId || "").trim();
      if (!companyId) return;
      if (typeof window !== "undefined") {
        if (!storedCompanyId) {
          window.localStorage.setItem(ACTIVE_COMPANY_STORAGE_KEY, companyId);
        }
      }
      const doc = await fetchCompanyDoc(companyId);
      const color = String((doc as Record<string, unknown> | null)?.themeColor ?? "").trim();
      if (color) {
        setCompanyThemeColor(color);
      }
    };
    void load();
  }, [user?.companyId, user?.uid]);

  const onCreateProject = async () => {
    if (creatingProject) return;
    const name = String(projectName || "").trim() || "Untitled Project";
    const customer = String(clientName || "").trim() || "Unknown Customer";

    if (!hasFirebaseConfig || !db) {
      setShowNewProject(false);
      router.push("/projects/prj_1001");
      return;
    }

    const companyId = String(user?.companyId || "").trim();
    if (!companyId) {
      return;
    }

    setCreatingProject(true);
    try {
      const projectId = createProjectId();
      const nowIso = new Date().toISOString();
      await setDoc(doc(db, "companies", companyId, "jobs", projectId), {
        id: projectId,
        companyId,
        name,
        customer,
        createdByUid: user?.uid ?? "",
        createdByName: user?.displayName ?? "CutSmart User",
        createdAtIso: nowIso,
        updatedAtIso: nowIso,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
        status: "New",
        tags: [],
        notes: "",
        isDeleted: false,
        cutlist: { rows: [] },
      });
      setShowNewProject(false);
      setProjectName("");
      setClientName("");
      router.push(`/projects/${projectId}`);
    } finally {
      setCreatingProject(false);
    }
  };

  return (
    <div className="min-h-screen bg-[var(--bg-app)]">
      <aside
        className="z-[70] flex w-[230px] flex-col overflow-hidden border-r border-[var(--panel-border)] bg-white"
        style={{ position: "fixed", left: 0, top: 0, height: "100vh" }}
      >
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

        <div className="flex min-h-0 h-full flex-1 flex-col px-3 py-3">
          <div className="min-h-0 flex-1 space-y-1 overflow-y-auto pr-1">
            <button
              type="button"
              onClick={() => setShowNewProject(true)}
              className="flex w-full items-center gap-2 rounded-[10px] border border-transparent px-3 py-2 text-left text-[12px] font-bold text-[#475467] transition hover:border-[#E4E7EC] hover:bg-[#F7F8FC]"
            >
              <PlusCircle size={16} />
              New Project
            </button>
            {topNav.map((item) => {
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
          </div>

          <div className="shrink-0 space-y-1 border-t border-[var(--panel-border)] pt-3">
            {bottomNav.map((item) => {
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
            <Button variant="ghost" size="sm" className="h-8 w-full justify-start" onClick={() => void logout()}>
              <LogOut size={14} className="mr-2" />
              Log Out
            </Button>
            <div className="mt-2 flex items-center gap-2 rounded-[10px] border border-[#E4E7EC] bg-[#F8FAFC] px-2 py-2">
              <div
                className="inline-flex h-7 w-7 items-center justify-center rounded-full text-[11px] font-extrabold text-white"
                style={{ backgroundColor: userEmblemColor }}
              >
                {userInitials}
              </div>
              <span className="truncate text-[12px] font-semibold text-[#0F172A]">{user?.displayName || "CutSmart User"}</span>
            </div>
            {isDemoMode && (
              <span className="inline-flex rounded-[8px] border border-[#F1D46A] bg-[#FFF7CC] px-2 py-1 text-[11px] font-bold text-[#7A5A00]">
                Demo data mode
              </span>
            )}
          </div>
        </div>
      </aside>

      <div
        className="min-w-0 overflow-x-hidden"
        style={{ width: "100%", paddingLeft: 230 }}
      >
        <main className="min-w-0 overflow-x-clip px-4 py-4 md:px-5">{children}</main>
      </div>

      {showNewProject && (
        <div className="fixed inset-0 z-[120] grid place-items-center bg-black/35 px-4">
          <div className="w-full max-w-[420px] rounded-[14px] border border-[#D7DEE8] bg-white p-4 shadow-xl">
            <p className="text-[15px] font-extrabold uppercase tracking-[1px] text-[#12345B]">New Project</p>
            <div className="mt-3 space-y-2">
              <label className="block text-[11px] font-bold text-[#475467]">
                Project Name
                <input
                  value={projectName}
                  onChange={(e) => setProjectName(e.target.value)}
                  className="mt-1 h-9 w-full rounded-[8px] border border-[#D8DEE8] bg-white px-2 text-[12px]"
                  placeholder="Project name"
                />
              </label>
              <label className="block text-[11px] font-bold text-[#475467]">
                Client Name
                <input
                  value={clientName}
                  onChange={(e) => setClientName(e.target.value)}
                  className="mt-1 h-9 w-full rounded-[8px] border border-[#D8DEE8] bg-white px-2 text-[12px]"
                  placeholder="Client name"
                />
              </label>
            </div>
            <div className="mt-4 flex items-center justify-end gap-2">
              <button
                type="button"
                onClick={() => setShowNewProject(false)}
                className="h-9 rounded-[9px] border border-[#D8DEE8] bg-white px-3 text-[12px] font-bold text-[#334155]"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={creatingProject}
                onClick={() => void onCreateProject()}
                className="h-9 rounded-[9px] border border-[#C8DAFF] bg-[#EAF1FF] px-3 text-[12px] font-bold text-[#24589A] disabled:opacity-55"
              >
                {creatingProject ? "Creating..." : "Create Project"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
