"use client";

import { useEffect, useState } from "react";
import { AppShell } from "@/components/app-shell";
import { ProtectedRoute } from "@/components/protected-route";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useAuth } from "@/lib/auth-context";
import { fetchCutlists, fetchProjects } from "@/lib/firestore-data";
import type { Cutlist, Project } from "@/lib/types";

export default function InitialCutlistPage() {
  const { user } = useAuth();
  const [project, setProject] = useState<Project | null>(null);
  const [cutlist, setCutlist] = useState<Cutlist | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    const load = async () => {
      const projects = await fetchProjects(user?.uid);
      const firstProject = projects[0] ?? null;
      setProject(firstProject);

      if (firstProject) {
        const cutlists = await fetchCutlists(firstProject.id, user?.uid);
        setCutlist(cutlists.find((item) => item.type === "initial") ?? null);
      }
      setIsLoading(false);
    };
    void load();
  }, [user?.uid]);

  return (
    <ProtectedRoute>
      <AppShell>
        <div className="space-y-5">
          <div className="flex items-center justify-between gap-3">
            <h1 className="text-[30px] font-medium text-[#1A1D23]">Initial Cutlist</h1>
            <Badge variant="warning">Early estimate mode</Badge>
          </div>

          <Card>
            <CardHeader>
              <CardTitle>{project?.name ?? "No project found"}</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              {isLoading && <p className="text-sm text-slate-500">Loading cutlist...</p>}
              <p className="text-sm text-slate-600">
                Revision {cutlist?.revision ?? "-"} generated {cutlist?.generatedAt ?? "-"}
              </p>
              <div className="overflow-auto">
                <table className="w-full min-w-[680px] text-sm">
                  <thead className="text-left text-xs uppercase tracking-wide">
                    <tr>
                      <th className="pb-3">Part</th>
                      <th className="pb-3">Material</th>
                      <th className="pb-3">Qty</th>
                      <th className="pb-3">L</th>
                      <th className="pb-3">W</th>
                      <th className="pb-3">Edge</th>
                    </tr>
                  </thead>
                  <tbody>
                    {cutlist?.parts.map((part) => (
                      <tr key={part.id} className="border-t border-[#E4E7EC]">
                        <td className="py-3">{part.label}</td>
                        <td className="py-3">{part.material}</td>
                        <td className="py-3">{part.qty}</td>
                        <td className="py-3">{part.length}</td>
                        <td className="py-3">{part.width}</td>
                        <td className="py-3">{part.edgeBanding ? "Yes" : "No"}</td>
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
