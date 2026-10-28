"use client";

import { useEffect, useState } from "react";
import { TriangleAlert } from "lucide-react";
import { StatusScreen } from "@/components/status-screen";
import { reportError } from "@/lib/crash-reporting";

// An error outside the app's own pages — logging in, a client's link, a lead form, or the app's frame itself (its
// pages' own: app/(staff)/(app)/error.tsx). Reported (lib/crash-reporting.ts), then a way to try again.
export default function RootError({ error, unstable_retry }: { error: Error & { digest?: string }; unstable_retry: () => void }) {
  const [reference, setReference] = useState("");
  useEffect(() => {
    // (Its reference, once it's reported.)
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setReference(reportError(error) || error.digest || "");
  }, [error]);
  return (
    <StatusScreen
      icon={<TriangleAlert size={26} />}
      title="Something went wrong"
      message="This page ran into a problem. Anything already saved is safe."
      reference={reference}
    >
      <button type="button" className="lg-primary" onClick={() => unstable_retry()}>
        Try again
      </button>
      <button type="button" className="lg-link" onClick={() => window.location.reload()}>
        Reload the page
      </button>
    </StatusScreen>
  );
}
