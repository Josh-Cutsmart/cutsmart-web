"use client";

import Link from "next/link";
import { Search } from "lucide-react";
import { AppShell } from "@/components/app-shell";
import { ProtectedRoute } from "@/components/protected-route";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { fetchProjects } from "@/lib/firestore-data";
import type { Project } from "@/lib/types";
import { useEffect, useMemo, useState } from "react";

function statusBadge(status: string) {
  switch (status) {
    case "complete":
      return "success" as const;
    case "in-production":
      return "info" as const;
    case "approved":
      return "neutral" as const;
    case "quoted":
      return "warning" as const;
    default:
      return "neutral" as const;
  }
}

export default function DashboardPage() {
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("all");
  const [allProjects, setAllProjects] = useState<Project[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    const load = async () => {
      const items = await fetchProjects();
      setAllProjects(items);
      setIsLoading(false);
    };
    void load();
  }, []);

  const projects = useMemo(
    () =>
      allProjects.filter((project) => {
        const matchesSearch =
          !search ||
          project.name.toLowerCase().includes(search.toLowerCase()) ||
          project.customer.toLowerCase().includes(search.toLowerCase());
        const matchesStatus = !status || status === "all" || project.status === status;
        return matchesSearch && matchesStatus;
      }),
    [allProjects, search, status],
  );

  const stats = useMemo(() => {
    const total = projects.length;
    const highPriority = projects.filter((p) => p.priority === "high").length;
    const inProduction = projects.filter((p) => p.status === "in-production").length;
    const sheets = projects.reduce((sum, p) => sum + p.estimatedSheets, 0);
    return { total, highPriority, inProduction, sheets };
  }, [projects]);

  return (
    <ProtectedRoute>
      <AppShell>
        <div className="space-y-5">
          <h1 className="text-2xl font-semibold text-slate-900">Dashboard</h1>

          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Active projects</CardTitle>
              </CardHeader>
              <CardContent className="pt-0 text-3xl font-semibold">{stats.total}</CardContent>
            </Card>
            <Card>
              <CardHeader>
                <CardTitle className="text-base">High priority</CardTitle>
              </CardHeader>
              <CardContent className="pt-0 text-3xl font-semibold">{stats.highPriority}</CardContent>
            </Card>
            <Card>
              <CardHeader>
                <CardTitle className="text-base">In production</CardTitle>
              </CardHeader>
              <CardContent className="pt-0 text-3xl font-semibold">{stats.inProduction}</CardContent>
            </Card>
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Estimated sheets</CardTitle>
              </CardHeader>
              <CardContent className="pt-0 text-3xl font-semibold">{stats.sheets}</CardContent>
            </Card>
          </div>

          <Card>
            <CardContent className="pt-5">
              <div className="mb-4 grid gap-3 md:grid-cols-[1fr_180px]">
                <div className="relative">
                  <Search className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={16} />
                  <Input
                    className="pl-9"
                    placeholder="Search by project or customer"
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                  />
                </div>
                <select
                  className="h-10 rounded-md border border-slate-300 bg-white px-3 text-sm outline-none focus:border-[var(--brand)]"
                  value={status}
                  onChange={(e) => setStatus(e.target.value)}
                >
                  <option value="all">All status</option>
                  <option value="draft">Draft</option>
                  <option value="quoted">Quoted</option>
                  <option value="approved">Approved</option>
                  <option value="in-production">In Production</option>
                  <option value="complete">Complete</option>
                </select>
              </div>

              <div className="overflow-auto">
                <table className="w-full min-w-[720px] text-left text-sm">
                  <thead className="text-xs uppercase tracking-wide text-slate-500">
                    <tr>
                      <th className="pb-3">Project</th>
                      <th className="pb-3">Customer</th>
                      <th className="pb-3">Status</th>
                      <th className="pb-3">Priority</th>
                      <th className="pb-3">Due</th>
                      <th className="pb-3">Assigned</th>
                    </tr>
                  </thead>
                  <tbody>
                    {isLoading && (
                      <tr className="border-t border-slate-100">
                        <td className="py-4 text-slate-500" colSpan={6}>
                          Loading projects...
                        </td>
                      </tr>
                    )}
                    {projects.map((project) => (
                      <tr key={project.id} className="border-t border-slate-100">
                        <td className="py-3">
                          <Link
                            href={`/projects/${project.id}`}
                            className="font-medium text-slate-900 hover:text-[var(--brand-strong)]"
                          >
                            {project.name}
                          </Link>
                        </td>
                        <td className="py-3 text-slate-600">{project.customer}</td>
                        <td className="py-3">
                          <Badge variant={statusBadge(project.status)}>{project.status}</Badge>
                        </td>
                        <td className="py-3 capitalize">{project.priority}</td>
                        <td className="py-3">{project.dueDate}</td>
                        <td className="py-3">{project.assignedTo}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </CardContent>
          </Card>
        </div>
      </AppShell>
    </ProtectedRoute>
  );
}
