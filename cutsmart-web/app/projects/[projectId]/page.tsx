"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { AppShell } from "@/components/app-shell";
import { ProtectedRoute } from "@/components/protected-route";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs } from "@/components/ui/tabs";
import { useAuth } from "@/lib/auth-context";
import { fetchChanges, fetchCutlists, fetchProjectById, fetchQuotes } from "@/lib/firestore-data";
import type { Cutlist, Project, ProjectChange, SalesQuote } from "@/lib/types";

const tabItems = [
  { value: "overview", label: "Overview" },
  { value: "settings", label: "Settings" },
  { value: "changelog", label: "Changelog" },
];

export default function ProjectDetailsPage() {
  const params = useParams<{ projectId: string }>();
  const { user } = useAuth();
  const [tab, setTab] = useState("overview");
  const [project, setProject] = useState<Project | null>(null);
  const [changes, setChanges] = useState<ProjectChange[]>([]);
  const [quotes, setQuotes] = useState<SalesQuote[]>([]);
  const [cutlists, setCutlists] = useState<Cutlist[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    const projectId = params.projectId;
    const load = async () => {
      if (!projectId) {
        setProject(null);
        setChanges([]);
        setQuotes([]);
        setCutlists([]);
        setIsLoading(false);
        return;
      }

      const [projectItem, changeItems, quoteItems, cutlistItems] = await Promise.all([
        fetchProjectById(projectId, user?.uid),
        fetchChanges(projectId),
        fetchQuotes(),
        fetchCutlists(projectId, user?.uid),
      ]);

      setProject(projectItem);
      setChanges(changeItems);
      setQuotes(quoteItems.filter((item) => item.projectId === projectId));
      setCutlists(cutlistItems);
      setIsLoading(false);
    };

    void load();
  }, [params.projectId, user?.uid]);

  if (isLoading) {
    return (
      <ProtectedRoute>
        <AppShell>
          <Card>
            <CardContent className="pt-5 text-sm text-slate-700">Loading project...</CardContent>
          </Card>
        </AppShell>
      </ProtectedRoute>
    );
  }

  if (!project) {
    return (
      <ProtectedRoute>
        <AppShell>
          <Card>
            <CardContent className="pt-5 text-sm text-slate-700">
              Project not found.
            </CardContent>
          </Card>
        </AppShell>
      </ProtectedRoute>
    );
  }

  return (
    <ProtectedRoute>
      <AppShell>
        <div className="space-y-5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className="text-xs uppercase tracking-[0.2em] text-slate-500">Project Details</p>
              <h1 className="text-2xl font-semibold text-slate-900">{project.name}</h1>
            </div>
            <Badge variant="info">{project.status}</Badge>
          </div>

          <Tabs value={tab} onChange={setTab} items={tabItems} />

          {tab === "overview" && (
            <div className="grid gap-4 lg:grid-cols-3">
              <Card className="lg:col-span-2">
                <CardHeader>
                  <CardTitle>Summary</CardTitle>
                </CardHeader>
                <CardContent className="space-y-2 text-sm text-slate-700">
                  <p>
                    Customer: <strong>{project.customer}</strong>
                  </p>
                  <p>
                    Assigned: <strong>{project.assignedTo}</strong>
                  </p>
                  <p>
                    Due date: <strong>{project.dueDate}</strong>
                  </p>
                  <p>
                    Estimated sheets: <strong>{project.estimatedSheets}</strong>
                  </p>
                  <div className="flex flex-wrap gap-2 pt-2">
                    {project.tags.map((tag) => (
                      <Badge key={tag}>{tag}</Badge>
                    ))}
                  </div>
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle>Cutlists</CardTitle>
                </CardHeader>
                <CardContent className="space-y-3 text-sm">
                  {cutlists.map((cutlist) => (
                    <div key={cutlist.id} className="rounded-md border border-slate-200 p-3">
                      <p className="font-medium capitalize">{cutlist.type} cutlist</p>
                      <p className="text-slate-600">Revision {cutlist.revision}</p>
                      <p className="text-slate-500">Generated {cutlist.generatedAt}</p>
                    </div>
                  ))}
                </CardContent>
              </Card>
            </div>
          )}

          {tab === "settings" && (
            <Card>
              <CardHeader>
                <CardTitle>Project Settings</CardTitle>
              </CardHeader>
              <CardContent className="space-y-2 text-sm text-slate-700">
                <p>Company ID: {project.companyId}</p>
                <p>Priority: {project.priority}</p>
                <p>Role-based access: owner/admin can edit; sales and production have scoped access.</p>
                <p>Storage folder suggestion: companies/{project.companyId}/projects/{project.id}/files</p>
              </CardContent>
            </Card>
          )}

          {tab === "changelog" && (
            <div className="grid gap-4 lg:grid-cols-2">
              <Card>
                <CardHeader>
                  <CardTitle>Project Changelog</CardTitle>
                </CardHeader>
                <CardContent className="space-y-3 text-sm">
                  {changes.map((change) => (
                    <div key={change.id} className="rounded-md border border-slate-200 p-3">
                      <p className="font-medium text-slate-800">{change.action}</p>
                      <p className="text-slate-500">
                        {change.actor} at {change.at}
                      </p>
                    </div>
                  ))}
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle>Sales History</CardTitle>
                </CardHeader>
                <CardContent className="space-y-3 text-sm">
                  {quotes.map((quote) => (
                    <div key={quote.id} className="rounded-md border border-slate-200 p-3">
                      <p className="font-medium">{quote.currency} {quote.value.toLocaleString()}</p>
                      <p className="text-slate-600">Stage: {quote.stage}</p>
                      <p className="text-slate-500">Updated: {quote.updatedAt}</p>
                    </div>
                  ))}
                </CardContent>
              </Card>
            </div>
          )}
        </div>
      </AppShell>
    </ProtectedRoute>
  );
}
