"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/lib/auth-context";

export function ProtectedRoute({ children }: { children: React.ReactNode }) {
  const { user, isLoading } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (!isLoading && !user) {
      router.replace("/");
    }
  }, [isLoading, router, user]);

  if (isLoading) {
    return (
      <div className="flex h-[60vh] w-full items-center justify-center">
        <div
          className="h-9 w-9 animate-spin rounded-full border-[3px] border-[var(--glass-border)] border-t-[var(--brand-strong)]"
          role="status"
          aria-label="Loading"
        />
      </div>
    );
  }

  if (!user) {
    return null;
  }

  return <>{children}</>;
}
