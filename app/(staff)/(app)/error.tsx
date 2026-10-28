"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { TriangleAlert } from "lucide-react";
import { StatusPanel } from "@/components/status-screen";
import { reportError } from "@/lib/crash-reporting";
import { useIsDevUser } from "@/lib/dev-mode";

// An error on one of the app's pages: in its place, inside the app — the sidebar and top bar still there, to go
// anywhere else. Reported (lib/crash-reporting.ts), then a way to try again. A Dev user sees the error itself too.
export default function AppPageError({ error, unstable_retry }: { error: Error & { digest?: string }; unstable_retry: () => void }) {
  const isDevUser = useIsDevUser();
  const [reference, setReference] = useState("");
  useEffect(() => {
    // (Its reference, once it's reported.)
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setReference(reportError(error) || error.digest || "");
  }, [error]);
  return (
    <StatusPanel
      icon={<TriangleAlert size={26} />}
      title="Something went wrong"
      message="This page ran into a problem. Anything already saved is safe."
      reference={reference}
    >
      {isDevUser && error.message ? (
        <pre
          className="mt-4 max-h-[160px] overflow-auto whitespace-pre-wrap break-words rounded-[12px] border px-3 py-2 text-left text-[11px] font-medium select-text"
          style={{ borderColor: "var(--glass-border)", backgroundColor: "var(--bg-app)", color: "var(--text-main)" }}
        >
          {error.message}
        </pre>
      ) : null}
      <button type="button" className="lg-primary" onClick={() => unstable_retry()}>
        Try again
      </button>
      <Link href="/dashboard" className="lg-link">
        Go to Dashboard
      </Link>
    </StatusPanel>
  );
}
