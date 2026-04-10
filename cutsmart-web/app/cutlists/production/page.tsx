"use client";

import { useEffect, useState } from "react";
import { AppShell } from "@/components/app-shell";
import { ProtectedRoute } from "@/components/protected-route";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useAuth } from "@/lib/auth-context";
import { fetchCutlists, fetchProjects } from "@/lib/firestore-data";
import { canAccess } from "@/lib/permissions";
import type { Cutlist, Project } from "@/lib/types";

export default function ProductionCutlistPage() {
  const { user } = useAuth();
  const [project, setProject] = useState<Project | null>(null);
  const [production, setProduction] = useState<Cutlist | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  const allowed = user ? canAccess("productionCutlist", user.role) : false;

  useEffect(() => {
    const load = async () => {
      const projects = await fetchProjects();
      const firstProject = projects[0] ?? null;
      setProject(firstProject);

      if (firstProject) {
        const cutlists = await fetchCutlists(firstProject.id);
        setProduction(cutlists.find((item) => item.type === "production") ?? null);
      }
      setIsLoading(false);
    };
    void load();
  }, []);

  return (
    <ProtectedRoute>
      <AppShell>
        <div className="space-y-5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h1 className="text-2xl font-semibold">Production Cutlist</h1>
            <Badge variant="info">Complex workflow</Badge>
          </div>

          {!allowed ? (
            <Card>
              <CardContent className="pt-5 text-sm text-rose-700">
                You do not have permission to edit production cutlists with your current role.
              </CardContent>
            </Card>
          ) : (
            <>
              <Card>
                <CardHeader>
                  <CardTitle>Current revision</CardTitle>
                </CardHeader>
                <CardContent className="space-y-2 text-sm text-slate-700">
                  {isLoading && <p>Loading production cutlist...</p>}
                  {project && <p>Project: {project.name}</p>}
                  <p>Revision: {production?.revision ?? "-"}</p>
                  <p>Generated: {production?.generatedAt ?? "-"}</p>
                  <p>Total parts: {production?.parts.length ?? 0}</p>
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle>Build queue</CardTitle>
                </CardHeader>
                <CardContent className="space-y-3 text-sm text-slate-700">
                  <p>Step 1: Validate part dimensions against machine constraints.</p>
                  <p>Step 2: Confirm material availability in inventory.</p>
                  <p>Step 3: Lock revision and publish to production floor tablets.</p>
                </CardContent>
              </Card>
            </>
          )}
        </div>
      </AppShell>
    </ProtectedRoute>
  );
}
