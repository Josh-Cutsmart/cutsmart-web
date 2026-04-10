"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { AppShell } from "@/components/app-shell";
import { ProtectedRoute } from "@/components/protected-route";
import { useAuth } from "@/lib/auth-context";
import { fetchProjects } from "@/lib/firestore-data";
import type { Project } from "@/lib/types";

const sortModes = [
  { key: "latest", label: "Latest" },
  { key: "oldest", label: "Oldest" },
  { key: "az", label: "A-Z" },
  { key: "za", label: "Z-A" },
] as const;

type SortMode = (typeof sortModes)[number]["key"];
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

function shortDate(value: string) {
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) {
    return "-";
  }
  return d.toLocaleString();
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
  const { user } = useAuth();
  const [search, setSearch] = useState("");
  const [sortMode, setSortMode] = useState<SortMode>("latest");
  const [quickFilter, setQuickFilter] = useState<QuickFilter>("all");
  const [selectedStaff, setSelectedStaff] = useState<string>("__all__");
  const [selectedStatus, setSelectedStatus] = useState<string>("__all__");
  const [allProjects, setAllProjects] = useState<Project[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    const load = async () => {
      const items = await fetchProjects(user?.uid);
      setAllProjects(items);
      setIsLoading(false);
    };
    void load();
  }, [user?.uid]);

  const staffOptions = useMemo(() => {
    const set = new Set<string>();
    for (const p of allProjects) {
      const creator = String(p.createdByName || "").trim();
      if (creator) {
        set.add(creator);
      }
    }
    return ["__all__", ...Array.from(set).sort((a, b) => a.localeCompare(b))];
  }, [allProjects]);

  const statusOptions = useMemo(() => {
    const set = new Set<string>();
    for (const p of allProjects) {
      const label = String(p.statusLabel || "").trim() || "New";
      set.add(label);
    }
    return ["__all__", ...Array.from(set).sort((a, b) => a.localeCompare(b))];
  }, [allProjects]);

  const filtered = useMemo(() => {
    let rows = allProjects.filter((project) => {
      const statusLabel = String(project.statusLabel || "New");

      if (quickFilter === "active" && isCompletedStatus(statusLabel)) {
        return false;
      }
      if (quickFilter === "completed" && !isCompletedStatus(statusLabel)) {
        return false;
      }

      if (selectedStaff !== "__all__" && String(project.createdByName || "") !== selectedStaff) {
        return false;
      }

      if (selectedStatus !== "__all__" && statusLabel !== selectedStatus) {
        return false;
      }

      const tagsText = (project.tags || []).join(" ");
      const haystack = `${project.name} ${project.createdByName} ${statusLabel} ${tagsText}`.toLowerCase();
      if (search && !haystack.includes(search.toLowerCase())) {
        return false;
      }

      return true;
    });

    if (sortMode === "latest") {
      rows = rows.sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)));
    } else if (sortMode === "oldest") {
      rows = rows.sort((a, b) => String(a.updatedAt).localeCompare(String(b.updatedAt)));
    } else if (sortMode === "az") {
      rows = rows.sort((a, b) => a.name.localeCompare(b.name));
    } else if (sortMode === "za") {
      rows = rows.sort((a, b) => b.name.localeCompare(a.name));
    }

    const openRows = rows.filter((r) => !isCompletedStatus(r.statusLabel));
    const completeRows = rows.filter((r) => isCompletedStatus(r.statusLabel));
    return [...openRows, ...completeRows];
  }, [allProjects, quickFilter, search, selectedStaff, selectedStatus, sortMode]);

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
        <div className="space-y-4">
          <h1 className="text-[24px] font-bold text-[#111111]">Dashboard</h1>

          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
            {[
              { label: "Total Projects", value: stats.total, icon: "#5EA1F7" },
              { label: "Active", value: stats.active, icon: "#E8BF46" },
              { label: "Completed", value: stats.completed, icon: "#50A279" },
              { label: "Staff Members", value: stats.staff, icon: "#8A72CC" },
            ].map((card) => (
              <div key={card.label} className="rounded-[14px] border border-[#ECECF0] bg-white px-4 py-3 shadow-sm">
                <div className="mb-2 flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <div className="h-[30px] w-[30px] rounded-full" style={{ backgroundColor: card.icon }} />
                    <p className="text-[17px] font-semibold text-[#2A3441]">{card.label}</p>
                  </div>
                </div>
                <p className="text-[46px] font-medium leading-none text-[#111111]">{card.value}</p>
                <p className="pt-1 text-[13px] font-bold text-[#2A7A3B]">+0 this week</p>
              </div>
            ))}
          </div>

          <div className="rounded-[14px] border border-[#E4E6EC] bg-white p-3">
            <div className="mb-3 flex flex-wrap items-center gap-2">
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search projects..."
                className="h-9 min-w-[240px] rounded-[10px] border border-[#E4E7ED] bg-[#F3F5F8] px-3 text-[12px] text-[#5B6472] outline-none"
              />

              {sortModes.map((mode) => (
                <button
                  key={mode.key}
                  onClick={() => setSortMode(mode.key)}
                  className="h-7 rounded-[14px] px-3 text-[12px] font-bold"
                  style={{
                    backgroundColor: sortMode === mode.key ? "#7D99B3" : "#F1F3F8",
                    color: sortMode === mode.key ? "#FFFFFF" : "#6B7B8F",
                  }}
                >
                  {mode.label}
                </button>
              ))}

              <select
                value={selectedStaff}
                onChange={(e) => setSelectedStaff(e.target.value)}
                className="h-8 rounded-[8px] border border-[#E4E8EF] bg-[#F1F4F9] px-3 text-[12px] font-bold text-[#6B7686]"
              >
                {staffOptions.map((option) => (
                  <option key={option} value={option}>
                    {option === "__all__" ? "User" : option}
                  </option>
                ))}
              </select>

              <select
                value={selectedStatus}
                onChange={(e) => setSelectedStatus(e.target.value)}
                className="h-8 rounded-[8px] border border-[#E4E8EF] bg-[#F1F4F9] px-3 text-[12px] font-bold text-[#6B7686]"
              >
                {statusOptions.map((option) => (
                  <option key={option} value={option}>
                    {option === "__all__" ? "Status" : option}
                  </option>
                ))}
              </select>
            </div>

            <div className="mb-3 flex gap-2">
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
              <table className="w-full min-w-[1100px] text-[12px]">
                <thead>
                  <tr className="text-[#8A97A8]">
                    <th className="pb-2 text-left font-bold">Project Name</th>
                    <th className="pb-2 text-left font-bold">Tags</th>
                    <th className="pb-2 text-left font-bold">Created By</th>
                    <th className="pb-2 text-center font-bold">Date Created</th>
                    <th className="pb-2 text-center font-bold">Date Modified</th>
                    <th className="pb-2 text-center font-bold">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {isLoading && (
                    <tr>
                      <td className="py-3 text-[#6B7280]" colSpan={6}>
                        Loading projects...
                      </td>
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
                    <tr key={project.id} className="border-t border-[#E9EDF3] hover:bg-[#F2F6FC]">
                      <td className="py-2 font-bold text-[#111827]">
                        <Link href={`/projects/${project.id}`} className="hover:text-[#2F5E8A]">
                          {project.name}
                        </Link>
                      </td>
                      <td className="py-2">
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
                      <td className="py-2">
                        <div className="flex items-center gap-2">
                          <span className="inline-flex h-5 w-5 items-center justify-center rounded-full bg-[#7D99B3] text-[10px] font-bold text-white">
                            {initials(project.createdByName)}
                          </span>
                          <span className="text-[#111827]">{project.createdByName || "-"}</span>
                        </div>
                      </td>
                      <td className="py-2 text-center text-[#1F2937]">{shortDate(project.createdAt)}</td>
                      <td className="py-2 text-center text-[#1F2937]">{shortDate(project.updatedAt)}</td>
                      <td className="py-2 text-center">
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
          </div>
        </div>
      </AppShell>
    </ProtectedRoute>
  );
}
