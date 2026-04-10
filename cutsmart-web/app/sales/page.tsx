"use client";

import { useEffect, useState } from "react";
import { AppShell } from "@/components/app-shell";
import { ProtectedRoute } from "@/components/protected-route";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { fetchProjects, fetchQuotes } from "@/lib/firestore-data";
import type { Project, SalesQuote } from "@/lib/types";

export default function SalesPage() {
  const [projects, setProjects] = useState<Project[]>([]);
  const [quotes, setQuotes] = useState<SalesQuote[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    const load = async () => {
      const [projectItems, quoteItems] = await Promise.all([fetchProjects(), fetchQuotes()]);
      setProjects(projectItems);
      setQuotes(quoteItems);
      setIsLoading(false);
    };
    void load();
  }, []);

  return (
    <ProtectedRoute>
      <AppShell>
        <div className="space-y-5">
          <h1 className="text-2xl font-semibold">Sales</h1>
          <Card>
            <CardHeader>
              <CardTitle>Pipeline</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              {isLoading && <p className="text-sm text-slate-500">Loading quotes...</p>}
              {quotes.map((quote) => {
                const project = projects.find((p) => p.id === quote.projectId);
                return (
                  <div key={quote.id} className="rounded-md border border-slate-200 p-4">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <p className="font-medium text-slate-900">{project?.name ?? quote.projectId}</p>
                      <Badge variant={quote.stage === "won" ? "success" : quote.stage === "lost" ? "danger" : "warning"}>
                        {quote.stage}
                      </Badge>
                    </div>
                    <p className="mt-1 text-sm text-slate-600">
                      Value: {quote.currency} {quote.value.toLocaleString()} | Updated: {quote.updatedAt}
                    </p>
                  </div>
                );
              })}
            </CardContent>
          </Card>
        </div>
      </AppShell>
    </ProtectedRoute>
  );
}
