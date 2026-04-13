"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/lib/auth-context";

export function ProtectedRoute({ children }: { children: React.ReactNode }) {
  const { user, isLoading } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (!isLoading && !user) {
      router.replace("/login");
    }
  }, [isLoading, router, user]);

  if (isLoading) {
    return (
      <div className="mx-4 my-4 rounded-[14px] border border-[var(--panel-border)] bg-white p-8 text-sm text-[var(--text-muted)]">
        Loading workspace...
      </div>
    );
  }

  if (!user) {
    return null;
  }

  return <>{children}</>;
}
