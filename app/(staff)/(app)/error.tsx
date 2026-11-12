"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { Flag, TriangleAlert } from "lucide-react";
import { StatusPanel } from "@/components/status-screen";
import { useAuth } from "@/lib/auth-context";
import { reportError } from "@/lib/crash-reporting";
import { useIsDevUser } from "@/lib/dev-mode";
import { submitAppReport } from "@/lib/firestore-data";
import { glassShineStyle } from "@/lib/glass-shine";

// An error on one of the app's pages: in its place, inside the app — the sidebar and top bar still there, to go
// anywhere else. Reported (lib/crash-reporting.ts), then three ways on: Try again, Go to Dashboard, and Report — a
// support ticket for the devs (an issue in the Changelog page's Dev Reports, as Report Issue makes) saying where they
// were and what went wrong, sent and then on to the Dashboard. A Dev user sees the error itself too.

// The size of every button here (the login screen's — lg-primary's — less its shadow).
const BUTTON_CLASS =
  "glass-shine mt-[10px] inline-flex h-[46px] w-full items-center justify-center gap-2 rounded-[13px] border text-[14px] font-medium transition hover:brightness-105 disabled:opacity-60";

function deviceTypeNow(): "desktop" | "tablet" | "mobile" {
  const coarse = typeof window.matchMedia === "function" && window.matchMedia("(pointer: coarse)").matches;
  const width = window.innerWidth;
  if (coarse && width < 768) return "mobile";
  if (coarse && width < 1280) return "tablet";
  return "desktop";
}

// The version they're on: the published one (public/release-notes.txt's first line).
async function appVersionNow(): Promise<string> {
  try {
    const res = await fetch("/release-notes.txt", { cache: "no-store" });
    const text = res.ok ? await res.text() : "";
    return text.match(/^\s*Version:\s*(\S+)/im)?.[1] ?? "";
  } catch {
    return "";
  }
}

export default function AppPageError({ error, unstable_retry }: { error: Error & { digest?: string }; unstable_retry: () => void }) {
  const isDevUser = useIsDevUser();
  const { user } = useAuth();
  const router = useRouter();
  const [reference, setReference] = useState("");
  const [reportState, setReportState] = useState<"" | "sending" | "failed">("");
  // Where they were when it broke (the page, before anything else changes it).
  const whereRef = useRef({ path: "", title: "", from: "" });
  useEffect(() => {
    whereRef.current = {
      path: `${window.location.pathname}${window.location.search}`,
      title: document.title,
      from: document.referrer,
    };
    // (Its reference, once it's reported.)
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setReference(reportError(error) || error.digest || "");
  }, [error]);

  // Report: the error as a support ticket — where it happened, the error line, its reference, the stack, and the device
  // and version — then on to the Dashboard.
  const report = async () => {
    if (reportState === "sending") return;
    if (!user?.uid || !user.email) {
      setReportState("failed");
      return;
    }
    setReportState("sending");
    const where = whereRef.current;
    const message = String(error?.message || "").trim() || "No error message";
    const firstLine = message.split("\n")[0].slice(0, 140);
    const stack = String(error?.stack || "")
      .split("\n")
      .slice(0, 14)
      .join("\n");
    const appVersion = await appVersionNow();
    const body = [
      "Reported from the app's \"Something went wrong\" screen.",
      "",
      `Where: ${where.path || "-"}`,
      `Page: ${where.title || "-"}`,
      `Error: ${message}`,
      `Type: ${error?.name || "Error"}`,
      reference ? `Reference: ${reference}` : "",
      error?.digest ? `Digest: ${error.digest}` : "",
      `When: ${new Date().toLocaleString()} (${new Date().toISOString()})`,
      `Version: ${appVersion || "-"}`,
      `Device: ${deviceTypeNow()} · screen ${window.innerWidth} × ${window.innerHeight} (×${window.devicePixelRatio || 1})`,
      `Browser: ${navigator.userAgent}`,
      stack ? `\nStack:\n${stack}` : "",
    ]
      .filter((line) => line !== "")
      .join("\n");
    const ok = await submitAppReport({
      kind: "issue",
      deviceType: deviceTypeNow(),
      subject: `Error: ${firstLine}${where.path ? ` (${where.path.split("?")[0]})` : ""}`,
      body,
      appVersion,
      reporterUid: String(user.uid),
      reporterEmail: String(user.email),
      reporterName: String(user.displayName || user.email || "User"),
    });
    if (!ok) {
      setReportState("failed");
      return;
    }
    router.push("/dashboard");
  };

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
      <button type="button" className={`${BUTTON_CLASS} glass-shine-neutral`} style={{ color: "var(--text-main)" }} onClick={() => router.push("/dashboard")}>
        Go to Dashboard
      </button>
      {/* (Red glass, last: sends the devs a ticket about it, then goes to the Dashboard.) */}
      <button
        type="button"
        disabled={reportState === "sending"}
        onClick={() => void report()}
        className={`${BUTTON_CLASS} text-white`}
        style={glassShineStyle("var(--danger)")}
      >
        <Flag size={15} strokeWidth={2.4} />
        {reportState === "sending" ? "Reporting…" : reportState === "failed" ? "Couldn't send it, try again" : "Report"}
      </button>
      {reportState === "failed" ? (
        <p className="mt-2 text-center text-[12px] font-medium" style={{ color: "var(--danger)" }}>
          The report didn&apos;t go through. Check your connection and press Report again.
        </p>
      ) : null}
    </StatusPanel>
  );
}
