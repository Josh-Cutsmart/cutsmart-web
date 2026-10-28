"use client";

import "./globals.css";
import { useEffect, useState } from "react";
import { TriangleAlert } from "lucide-react";
import { StatusScreen } from "@/components/status-screen";
import { reportError } from "@/lib/crash-reporting";

// The last resort: the app couldn't even start (an error in app/layout.tsx itself), so this is the whole page — its
// own <html>, in the theme they last had. Reported (lib/crash-reporting.ts), then a way to try again.
export default function GlobalError({ error, unstable_retry }: { error: Error & { digest?: string }; unstable_retry: () => void }) {
  const [reference, setReference] = useState("");
  useEffect(() => {
    try {
      const theme = window.localStorage.getItem("cutsmart_theme_mode") === "dark" ? "dark" : "light";
      document.documentElement.setAttribute("data-theme", theme);
      document.body.setAttribute("data-theme", theme);
      document.documentElement.style.colorScheme = theme;
    } catch {
      // storage unavailable — the light theme
    }
    // (Its reference, once it's reported.)
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setReference(reportError(error) || error.digest || "");
  }, [error]);
  return (
    <html lang="en">
      <body className="cs-app">
        <title>Something went wrong · CutSmart</title>
        <StatusScreen
          icon={<TriangleAlert size={26} />}
          title="Something went wrong"
          message="CutSmart ran into a problem starting up. Anything already saved is safe."
          reference={reference}
        >
          <button type="button" className="lg-primary" onClick={() => unstable_retry()}>
            Try again
          </button>
          <button type="button" className="lg-link" onClick={() => window.location.reload()}>
            Reload the page
          </button>
        </StatusScreen>
      </body>
    </html>
  );
}
