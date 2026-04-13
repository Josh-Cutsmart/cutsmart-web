"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Activity, CheckCircle2, FolderKanban, Search, SlidersHorizontal, Users2 } from "lucide-react";
import { AppShell } from "@/components/app-shell";
import { ProtectedRoute } from "@/components/protected-route";
import { useAuth } from "@/lib/auth-context";
import {
  debugProjectSources,
  fetchProjects,
  type ProjectSourceDiagnostics,
} from "@/lib/firestore-data";
import type { Project } from "@/lib/types";
const statCards = [
  { label: "Projects", key: "total", icon: FolderKanban, iconBg: "#5EA1F7" },
  { label: "Active Projects", key: "active", icon: Activity, iconBg: "#E8BF46" },
  { label: "Completed", key: "completed", icon: CheckCircle2, iconBg: "#50A279" },
  { label: "Staff Members", key: "staff", icon: Users2, iconBg: "#8A72CC" },
] as const;

type QuickFilter = "all" | "active" | "completed";

function isCompletedStatus(status: string) {
  const token = String(status || "")
    .toLowerCase()
    .replace(/[^a-z]/g, "");
  return token === "done" || token.startsWith("complete");
}

function statusPillColors(status: string) {
  const key = String(status || "").trim().toLowerCase();
  const defaults: Record<string, string> = {
    new: "#3060D0",
    running: "#2A7A3B",
    "in production": "#2A7A3B",
    drafting: "#6B4FB3",
    quoting: "#C77700",
    "ready for cnc": "#3060D0",
    completed: "#2A7A3B",
    paused: "#A05A00",
  };

  const bg = defaults[key] ?? "#64748B";
  return { backgroundColor: bg, color: "#FFFFFF" };
}

function dashboardDate(value: string) {
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) {
    return "-";
  }
  const date = new Intl.DateTimeFormat("en-NZ", {
    day: "2-digit",
    month: "long",
    year: "numeric",
  }).format(d);
  const time = new Intl.DateTimeFormat("en-NZ", {
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  })
    .format(d)
    .toLowerCase()
    .replace(" ", "");
  return `${date} | ${time}`;
}

function initials(text: string) {
  const parts = String(text || "")
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  if (!parts.length) {
    return "U";
  }
  return parts
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase() ?? "")
    .join("");
}

export default function DashboardPage() {
  const router = useRouter();
  const { user } = useAuth();
  const [search, setSearch] = useState("");
  const [quickFilter, setQuickFilter] = useState<QuickFilter>("all");
  const [allProjects, setAllProjects] = useState<Project[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [diag, setDiag] = useState<ProjectSourceDiagnostics | null>(null);

  useEffect(() => {
    const load = async () => {
      const [items, diagnostics] = await Promise.all([
        fetchProjects(user?.uid),
        debugProjectSources(user?.uid),
      ]);
      setAllProjects(items);
      setDiag(diagnostics);
      setIsLoading(false);
    };
    void load();
  }, [user?.uid]);

  const openProjectInDashboard = async (projectId: string) => {
    router.push(`/projects/${projectId}`);
  };


  const filtered = useMemo(() => {
    let rows = allProjects.filter((project) => {
      const statusLabel = String(project.statusLabel || "New");

      if (quickFilter === "active" && isCompletedStatus(statusLabel)) {
        return false;
      }
      if (quickFilter === "completed" && !isCompletedStatus(statusLabel)) {
        return false;
      }

      const tagsText = (project.tags || []).join(" ");
      const haystack = `${project.name} ${project.createdByName} ${statusLabel} ${tagsText}`.toLowerCase();
      if (search && !haystack.includes(search.toLowerCase())) {
        return false;
      }

      return true;
    });

    rows = rows.sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)));

    const openRows = rows.filter((r) => !isCompletedStatus(r.statusLabel));
    const completeRows = rows.filter((r) => isCompletedStatus(r.statusLabel));
    return [...openRows, ...completeRows];
  }, [allProjects, quickFilter, search]);

  const stats = useMemo(() => {
    const total = allProjects.length;
    const active = allProjects.filter((p) => !isCompletedStatus(p.statusLabel)).length;
    const completed = allProjects.filter((p) => isCompletedStatus(p.statusLabel)).length;
    const staff = new Set(allProjects.map((p) => p.createdByName).filter(Boolean)).size;
    return { total, active, completed, staff };
  }, [allProjects]);

  return (
    <ProtectedRoute>
      <AppShell>
        <div className="space-y-3">
          <h1 className="text-[30px] font-medium text-[#1A1D23]">Dashboard</h1>

          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
            {statCards.map((card) => {
              const Icon = card.icon;
              const value = stats[card.key];
              return (
                <div
                  key={card.label}
                  className="rounded-[14px] border border-[#ECECF0] bg-white px-4 py-3 shadow-sm transition hover:-translate-y-[1px] hover:border-[#D7DEE8]"
                >
                  <div className="mb-2 flex items-center gap-2">
                    <div
                      className="inline-flex h-[30px] w-[30px] items-center justify-center rounded-full text-white"
                      style={{ backgroundColor: card.iconBg }}
                    >
                      <Icon size={16} strokeWidth={2.4} />
                    </div>
                    <p className="text-[17px] font-semibold text-[#2A3441]">{card.label}</p>
                  </div>
                  <p className="text-[46px] font-medium leading-none text-[#111111]">{value}</p>
                  <p className="pt-1 text-[13px] font-bold text-[#2A7A3B]">+0 this week</p>
                </div>
              );
            })}
          </div>

          <div className="rounded-[14px] border border-[#D7DEE8] bg-white p-3">
              <div className="mb-2 flex flex-wrap items-center gap-2">
                <div className="relative min-w-[280px]">
                  <Search
                    size={14}
                    className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[#98A2B3]"
                  />
                  <input
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    placeholder="Search projects..."
                    className="h-9 w-full rounded-[10px] border border-[#E4E7ED] bg-[#F3F5F8] pl-8 pr-3 text-[12px] font-semibold text-[#5B6472] outline-none placeholder:text-[#9AA3B2]"
                  />
                </div>
                <button
                  type="button"
                  className="inline-flex h-8 w-8 items-center justify-center rounded-[8px] border border-[#D8DEE8] bg-[#F1F4F9] text-[#6B7686]"
                  title="Filters"
                >
                  <SlidersHorizontal size={13} />
                </button>
              </div>

              <div className="mb-3 flex gap-2 border-t border-[#E7EBF2] pt-2">
                {[
                  { key: "all", label: "All" },
                  { key: "active", label: "Active" },
                  { key: "completed", label: "Completed" },
                ].map((option) => (
                  <button
                    key={option.key}
                    onClick={() => setQuickFilter(option.key as QuickFilter)}
                    className="h-8 rounded-[8px] border px-4 text-[12px] font-bold"
                    style={{
                      backgroundColor: quickFilter === option.key ? "#5EA1F7" : "#F1F4F9",
                      borderColor: quickFilter === option.key ? "#5EA1F7" : "#E4E8EF",
                      color: quickFilter === option.key ? "#FFFFFF" : "#6B7686",
                    }}
                  >
                    {option.label}
                  </button>
                ))}
              </div>

              <div className="overflow-auto">
                <table className="w-full min-w-[980px] text-[12px]">
                  <thead>
                    <tr className="border-b border-[#DCE3EC]">
                      <th className="pb-2 text-left text-[11px] font-bold text-[#7F93AE]">Project Name</th>
                      <th className="pb-2 text-left text-[11px] font-bold text-[#7F93AE]">Tags</th>
                      <th className="pb-2 text-left text-[11px] font-bold text-[#7F93AE]">Creator</th>
                      <th className="pb-2 text-center text-[11px] font-bold text-[#7F93AE]">Created</th>
                      <th className="pb-2 text-center text-[11px] font-bold text-[#7F93AE]">Modified</th>
                      <th className="pb-2 text-right text-[11px] font-bold text-[#7F93AE]">Status</th>
                    </tr>
                  </thead>
                  <tbody>

                  {isLoading && (
                    <tr>
                      <td className="py-3 text-[#6B7280]" colSpan={6}>Loading projects...</td>
                    </tr>
                  )}
                  {!isLoading && filtered.length === 0 && (
                    <tr>
                      <td className="py-3 text-[#6B7280]" colSpan={6}>
                        No projects found. Check Firestore membership/rules for `companies/*/memberships` and `companies/*/jobs`.
                      </td>
                    </tr>
                  )}

                  {filtered.map((project) => (
                    <tr
                      key={project.id}
                      className="cursor-pointer border-b border-[#DCE3EC] hover:bg-[#F2F6FC]"
                      onClick={() => void openProjectInDashboard(project.id)}
                    >
                      <td className="py-[7px] font-bold text-[#111827]">{project.name}</td>
                      <td className="py-[7px]">
                        <div className="flex flex-wrap gap-1">
                          {project.tags.slice(0, 2).map((tag) => (
                            <span
                              key={tag}
                              className="rounded-[8px] border border-[#D6DEE9] bg-[#EEF2F7] px-2 py-[1px] text-[11px] font-bold text-[#475569]"
                            >
                              {tag}
                            </span>
                          ))}
                          {project.tags.length > 2 && <span className="font-bold text-[#64748B]">...</span>}
                        </div>
                      </td>
                      <td className="py-[7px]">
                        <div className="flex items-center gap-2 text-[12px]">
                          <span className="inline-flex h-4 w-4 items-center justify-center rounded-full bg-[#7D99B3] text-[9px] font-bold text-white">
                            {initials(project.createdByName)}
                          </span>
                          <span className="text-[#111827]">{project.createdByName || "-"}</span>
                        </div>
                      </td>
                      <td className="py-[7px] text-center text-[12px] text-[#1F2937]">{dashboardDate(project.createdAt)}</td>
                      <td className="py-[7px] text-center text-[12px] text-[#1F2937]">{dashboardDate(project.updatedAt)}</td>
                      <td className="py-[7px] text-right">
                          <span
                            className="inline-flex min-w-[120px] items-center justify-center rounded-[10px] px-3 py-[3px] text-[12px] font-bold"
                            style={statusPillColors(project.statusLabel || "New")}
                          >
                            {project.statusLabel || "New"}
                          </span>
                      </td>
                    </tr>
                  ))}
                  </tbody>
                </table>
              </div>

              {!isLoading && filtered.length === 0 && diag && (
                <div className="mt-4 rounded-[10px] border border-[#DEE4EC] bg-[#F5F6F8] p-3">
                  <p className="mb-2 text-[12px] font-bold text-[#111827]">Debug: Firestore Project Sources</p>
                  <pre className="max-h-[260px] overflow-auto whitespace-pre-wrap text-[11px] text-[#334155]">
{JSON.stringify(diag, null, 2)}
                  </pre>
                </div>
              )}
            </div>
        </div>
      </AppShell>
    </ProtectedRoute>
  );
}
