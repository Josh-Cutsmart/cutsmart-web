"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Card, CardContent } from "@/components/ui/card";
import { useAuth } from "@/lib/auth-context";
import { fetchProjects } from "@/lib/firestore-data";
import { retryAsync } from "@/lib/load-retry";
import type { Project } from "@/lib/types";

export default function SalesPage() {
  const router = useRouter();
  const { user } = useAuth();
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    const routeToProjectSales = async () => {
      try {
        const projects: Project[] = await retryAsync(() => fetchProjects(user?.uid), { attempts: 2, delayMs: 350 });
        if (cancelled) return;
        const firstProjectId = projects[0]?.id;

        if (firstProjectId) {
          router.replace(`/projects/${firstProjectId}?tab=sales`);
          return;
        }
      } catch {
        // A network/Firestore hiccup here used to leave "Opening project sales..." on screen
        // forever, since setIsLoading(false) below was never reached.
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    };

    void routeToProjectSales();
    return () => {
      cancelled = true;
    };
  }, [router, user?.uid]);

  return (
    <div className="flex min-h-[70vh] items-center justify-center">
      <Card>
        <CardContent className="flex flex-col items-center gap-4 pt-5 text-center text-sm text-[var(--text-muted)]">
          {isLoading ? (
            <>
              Opening project sales...
              <div
                className="h-9 w-9 animate-spin rounded-full border-[3px] border-[var(--glass-border)] border-t-[var(--brand-strong)]"
                role="status"
                aria-label="Loading"
              />
            </>
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
    </div>
  );
}
