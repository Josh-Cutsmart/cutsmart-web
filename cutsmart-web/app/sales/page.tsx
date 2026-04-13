"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { AppShell } from "@/components/app-shell";
import { ProtectedRoute } from "@/components/protected-route";
import { Card, CardContent } from "@/components/ui/card";
import { useAuth } from "@/lib/auth-context";
import { fetchProjects } from "@/lib/firestore-data";
import type { Project } from "@/lib/types";

export default function SalesPage() {
  const router = useRouter();
  const { user } = useAuth();
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    const routeToProjectSales = async () => {
      const projects: Project[] = await fetchProjects(user?.uid);
      const firstProjectId = projects[0]?.id;

      if (firstProjectId) {
        router.replace(`/projects/${firstProjectId}?tab=sales`);
        return;
      }

      setIsLoading(false);
    };

    void routeToProjectSales();
  }, [router, user?.uid]);

  return (
    <ProtectedRoute>
      <AppShell>
        <Card>
          <CardContent className="pt-5 text-sm text-[#475467]">
            {isLoading ? (
              "Opening project sales..."
            ) : (
              <>
                No projects found. Open the dashboard and select a project first.
                {" "}
                <Link href="/dashboard" className="font-semibold text-[var(--brand-strong)] underline">
                  Go to Dashboard
                </Link>
              </>
            )}
          </CardContent>
        </Card>
      </AppShell>
    </ProtectedRoute>
  );
}
