"use client";

import { useEffect, useRef, useState } from "react";
import { collection, limit, onSnapshot, orderBy, query, type QuerySnapshot, type DocumentData } from "firebase/firestore";
import { Search } from "lucide-react";
import { AppShell } from "@/components/app-shell";
import { ProtectedRoute } from "@/components/protected-route";
import { useAuth } from "@/lib/auth-context";
import {
  fetchAppChangelogHistory,
  fetchAppReports,
  setAppReportCompleted,
  submitAppReport,
  type AppReportKind,
  type AppReportRow,
} from "@/lib/firestore-data";
import { db } from "@/lib/firebase";
import {
  normalizeChangelogHistory,
  parseUpdateNotesText,
  type UpdateChangelogEntry,
  updateNotesToDisplayHtml,
} from "@/lib/update-notes-utils";
type ReportDeviceType = "desktop" | "tablet" | "mobile";

function detectDeviceType(): ReportDeviceType {
  if (typeof window === "undefined") return "desktop";
  const nav = window.navigator as Navigator & {
    userAgentData?: {
      mobile?: boolean;
      platform?: string;
    };
  };
  const uaData = nav.userAgentData;
  const ua = String(nav.userAgent || "").toLowerCase();
  const platform = String(uaData?.platform || nav.platform || "").toLowerCase();
  const maxTouchPoints = Number(nav.maxTouchPoints || 0);
  const hasCoarsePointer =
    typeof window.matchMedia === "function" && window.matchMedia("(pointer: coarse)").matches;

  // 1) Prefer explicit UA Client Hints when available.
  if (uaData && typeof uaData.mobile === "boolean") {
    if (uaData.mobile) return "mobile";
    // Non-mobile CH devices can still be tablets.
    const tabletByPlatform = /ipad|tablet|android/.test(platform) && maxTouchPoints > 0;
    if (tabletByPlatform) return "tablet";
  }

  // 2) Tablet signatures (including iPadOS desktop UA mode).
  const isIpadOsDesktopMode = platform.includes("mac") && maxTouchPoints > 1;
  const isTabletUa =
    /ipad|tablet/.test(ua) ||
    (ua.includes("android") && !ua.includes("mobile")) ||
    isIpadOsDesktopMode;
  if (isTabletUa) return "tablet";

  // 3) Phone signatures.
  const isMobileUa = /iphone|ipod|android.*mobile|windows phone|blackberry|opera mini|mobile/.test(ua);
  if (isMobileUa) return "mobile";

  // 4) Capability + width fallback for edge browsers.
  const width = window.innerWidth || 0;
  if ((hasCoarsePointer || maxTouchPoints > 0) && width <= 820) return "mobile";
  if ((hasCoarsePointer || maxTouchPoints > 0) && width <= 1200) return "tablet";

  return "desktop";
}

export default function ChangelogPage() {
  const { user } = useAuth();
  const [entries, setEntries] = useState<UpdateChangelogEntry[]>([]);
  const [activeVersion, setActiveVersion] = useState("");
  const [isDevUser, setIsDevUser] = useState(false);
  const [appVersion, setAppVersion] = useState("");
  const [showDevReports, setShowDevReports] = useState(false);
  const [reportsLoading, setReportsLoading] = useState(false);
  const [reports, setReports] = useState<AppReportRow[]>([]);
  const [devReportFilter, setDevReportFilter] = useState<AppReportKind | "all">("all");
  const [devReportStatusFilter, setDevReportStatusFilter] = useState<"open" | "completed">("open");
  const [composerKind, setComposerKind] = useState<AppReportKind | "">("");
  const [composerDevice, setComposerDevice] = useState<ReportDeviceType>("desktop");
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [submitBusy, setSubmitBusy] = useState(false);
  const [composerError, setComposerError] = useState("");
  const entryRefs = useRef<Record<string, HTMLDivElement | null>>({});
  const contentScrollRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const uid = String(user?.uid || "").trim();
    if (!uid) {
      setEntries([]);
      setActiveVersion("");
      return;
    }
    let cancelled = false;
    const load = async () => {
      const appRows = await fetchAppChangelogHistory();
      if (cancelled) return;
      const rows = normalizeChangelogHistory(appRows);
      setEntries(rows);
      setActiveVersion(rows[0]?.version || "");

      try {
        const updateRes = await fetch("/update-notes.txt", { cache: "no-store" });
        if (updateRes.ok) {
          const updateRaw = await updateRes.text();
          const parsed = parseUpdateNotesText(updateRaw);
          setAppVersion(String(parsed.version || "").trim() || rows[0]?.version || "");
        } else {
          setAppVersion(rows[0]?.version || "");
        }
      } catch {
        setAppVersion(rows[0]?.version || "");
      }

      const email = String(user?.email || "").trim().toLowerCase();
      if (!email) {
        setIsDevUser(false);
        return;
      }
      try {
        const devRes = await fetch("/dev-emails.txt", { cache: "no-store" });
        if (!devRes.ok) {
          setIsDevUser(false);
          return;
        }
        const raw = await devRes.text();
        const emails = raw
          .split(/\r?\n|,/g)
          .map((line) => String(line || "").trim().toLowerCase())
          .filter((line) => line && !line.startsWith("#"));
        setIsDevUser(new Set(emails).has(email));
      } catch {
        setIsDevUser(false);
      }
    };
    void load();
    return () => {
      cancelled = true;
    };
  }, [user?.uid]);

  useEffect(() => {
    if (!showDevReports || !isDevUser) return;
    if (!db) {
      let cancelled = false;
      const loadReports = async () => {
        setReportsLoading(true);
        const rows = await fetchAppReports();
        if (!cancelled) {
          setReports(rows);
          setReportsLoading(false);
        }
      };
      void loadReports();
      return () => {
        cancelled = true;
      };
    }
    setReportsLoading(true);
    const mapRows = (snap: QuerySnapshot<DocumentData>, forcedKind: AppReportKind) =>
      snap.docs.map((docSnap) => {
        const data = (docSnap.data() ?? {}) as Record<string, unknown>;
        const kindRaw = String(data.kind ?? "").trim().toLowerCase();
        const kind: AppReportKind =
          kindRaw === "feature" || kindRaw === "issue" ? kindRaw : forcedKind;
        const createdAtIso = String(data.createdAtIso ?? "");
        const completedAtIso = String(data.completedAtIso ?? "");
        return {
          id: String(data.id ?? docSnap.id),
          kind,
          deviceType: ((): ReportDeviceType | "" => {
            const raw = String(data.deviceType ?? "").trim().toLowerCase();
            return raw === "desktop" || raw === "tablet" || raw === "mobile" ? raw : "";
          })(),
          subject: String(data.subject ?? ""),
          body: String(data.body ?? ""),
          createdAtIso,
          appVersion: String(data.appVersion ?? ""),
          reporterEmail: String(data.reporterEmail ?? ""),
          reporterName: String(data.reporterName ?? ""),
          reporterUid: String(data.reporterUid ?? ""),
          completed: Boolean(data.completed),
          completedAtIso,
        } as AppReportRow;
      });
    let reportRows: AppReportRow[] = [];
    let featureRows: AppReportRow[] = [];
    let readyCount = 0;
    const publishRows = () => {
      setReports(
        [...reportRows, ...featureRows].sort((a, b) =>
          String(b.createdAtIso || "").localeCompare(String(a.createdAtIso || "")),
        ),
      );
      if (readyCount >= 2) {
        setReportsLoading(false);
      }
    };
    const reportQuery = query(
      collection(db, "Application", "changelog", "Reports"),
      orderBy("createdAt", "desc"),
      limit(500),
    );
    const featureQuery = query(
      collection(db, "Application", "changelog", "Suggested feature"),
      orderBy("createdAt", "desc"),
      limit(500),
    );
    const unsubscribeReports = onSnapshot(
      reportQuery,
      (snap) => {
        reportRows = mapRows(snap, "issue");
        readyCount = Math.min(2, readyCount + 1);
        publishRows();
      },
      () => {
        readyCount = Math.min(2, readyCount + 1);
        publishRows();
      },
    );
    const unsubscribeFeatures = onSnapshot(
      featureQuery,
      (snap) => {
        featureRows = mapRows(snap, "feature");
        readyCount = Math.min(2, readyCount + 1);
        publishRows();
      },
      () => {
        readyCount = Math.min(2, readyCount + 1);
        publishRows();
      },
    );
    return () => {
      unsubscribeReports();
      unsubscribeFeatures();
    };
  }, [showDevReports, isDevUser]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const prevHtmlOverflow = document.documentElement.style.overflow;
    const prevBodyOverflow = document.body.style.overflow;
    document.documentElement.style.overflow = "hidden";
    document.body.style.overflow = "hidden";
    return () => {
      document.documentElement.style.overflow = prevHtmlOverflow;
      document.body.style.overflow = prevBodyOverflow;
    };
  }, []);


  const scrollToVersion = (version: string) => {
    const target = entryRefs.current[version];
    if (!target) return;
    setActiveVersion(version);
    const container = contentScrollRef.current;
    if (container) {
      const containerRect = container.getBoundingClientRect();
      const targetRect = target.getBoundingClientRect();
      const nextTop = container.scrollTop + (targetRect.top - containerRect.top) - 8;
      container.scrollTo({ top: Math.max(0, nextTop), behavior: "smooth" });
      return;
    }
    target.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  const formatUpdateDate = (iso: string) => {
    const time = Date.parse(String(iso || ""));
    if (!Number.isFinite(time)) return "";
    return new Intl.DateTimeFormat("en-GB", {
      day: "2-digit",
      month: "long",
      year: "numeric",
    }).format(new Date(time));
  };

  const formatReportDate = (iso: string) => {
    const time = Date.parse(String(iso || ""));
    if (!Number.isFinite(time)) return "-";
    return new Intl.DateTimeFormat("en-GB", {
      day: "2-digit",
      month: "short",
      year: "numeric",
    }).format(new Date(time));
  };

  const formatReportTime = (iso: string) => {
    const time = Date.parse(String(iso || ""));
    if (!Number.isFinite(time)) return "-";
    return new Intl.DateTimeFormat("en-GB", {
      hour: "2-digit",
      minute: "2-digit",
    }).format(new Date(time));
  };

  const formatVersionLabel = (value: string) => {
    const raw = String(value || "").trim();
    if (!raw) return "-";
    return `v${raw.replace(/^v+/i, "")}`;
  };

  const normalizeVersionToken = (value: string) => String(value || "").trim().replace(/^v+/i, "").toLowerCase();

  const openComposer = (kind: AppReportKind) => {
    setComposerKind(kind);
    setComposerDevice(detectDeviceType());
    setSubject("");
    setBody("");
    setComposerError("");
  };

  const closeComposer = () => {
    setComposerKind("");
    setSubject("");
    setBody("");
    setComposerError("");
    setSubmitBusy(false);
  };

  const onSubmitReport = async () => {
    const trimmedSubject = String(subject || "").trim();
    const trimmedBody = String(body || "").trim();
    if (!trimmedSubject || !trimmedBody) {
      setComposerError("Please fill in subject and body.");
      return;
    }
    if (!user?.uid || !user?.email || !composerKind) {
      setComposerError("Could not identify user. Please sign in again.");
      return;
    }
    setSubmitBusy(true);
    setComposerError("");
    const ok = await submitAppReport({
      kind: composerKind,
      deviceType: composerDevice,
      subject: trimmedSubject,
      body: trimmedBody,
      appVersion: appVersion || entries[0]?.version || "",
      reporterUid: String(user.uid || ""),
      reporterEmail: String(user.email || ""),
      reporterName: String(user.displayName || user.email || "User"),
    });
    setSubmitBusy(false);
    if (!ok) {
      setComposerError("Submit failed (permission-denied or network issue).");
      return;
    }
    closeComposer();
    if (isDevUser && showDevReports) {
      setReportsLoading(true);
      const rows = await fetchAppReports();
      setReports(rows);
      setReportsLoading(false);
    }
  };

  const onToggleReportCompleted = async (reportId: string, nextValue: boolean) => {
    const ok = await setAppReportCompleted(reportId, nextValue);
    if (!ok) return;
    setReports((prev) =>
      prev.map((row) =>
        row.id === reportId
          ? {
              ...row,
              completed: nextValue,
              completedAtIso: nextValue ? new Date().toISOString() : "",
            }
          : row,
      ),
    );
  };

  const filteredDevReports = reports.filter((row) => {
    if (devReportFilter === "all") return true;
    return devReportFilter === "feature" ? row.kind === "feature" : row.kind === "issue";
  });
  const visibleDevReports = filteredDevReports.filter((row) =>
    devReportStatusFilter === "completed" ? row.completed : !row.completed,
  );
  const formatDeviceLabel = (value: ReportDeviceType | "") => {
    if (value === "mobile") return "Mobile";
    if (value === "tablet") return "Tablet";
    return "Desktop";
  };
  return (
    <ProtectedRoute>
      <AppShell>
        <div
          className="-mt-3 flex h-[calc(100dvh+12px)] min-h-0 flex-col overflow-hidden bg-[var(--bg-app)] md:-mt-4 md:h-[calc(100dvh+16px)] lg:-mt-4 lg:h-[calc(100dvh+16px)]"
          style={{
            marginLeft: "calc(-1 * max(12px, env(safe-area-inset-left)))",
            marginRight: "calc(-1 * max(12px, env(safe-area-inset-right)))",
          }}
        >
          <div className="sticky top-0 z-[95] flex h-[56px] shrink-0 items-center justify-between gap-2 border-b border-[#D7DEE8] bg-white px-4 md:px-5">
            <div className="flex items-center justify-between gap-2">
              <div className="inline-flex items-center gap-2">
                <Search size={16} color="#12345B" strokeWidth={2.1} />
                <p className="text-[14px] font-medium uppercase tracking-[1px]" style={{ color: "#12345B" }}>
                  Changelog
                </p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <div className="flex items-center gap-2">
                {isDevUser && (
                  <button
                    type="button"
                    onClick={() => setShowDevReports((prev) => !prev)}
                    className={`h-8 rounded-[8px] border px-3 text-[12px] font-semibold ${
                      showDevReports
                        ? "border-[#2F6BFF] bg-[#EAF1FF] text-[#1E4FA3]"
                        : "border-[#D7DEE8] bg-white text-[#334155]"
                    }`}
                  >
                    {showDevReports ? "View Changelog" : "View Reports"}
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => openComposer("issue")}
                  className="h-8 rounded-[8px] border border-[#FBCBC9] bg-[#FEEAEA] px-3 text-[12px] font-semibold text-[#B42318]"
                >
                  Report Issue
                </button>
                <button
                  type="button"
                  onClick={() => openComposer("feature")}
                  className="h-8 rounded-[8px] border border-[#BFD5FF] bg-[#EAF1FF] px-3 text-[12px] font-semibold text-[#1E4FA3]"
                >
                  Suggest Feature
                </button>
              </div>
            </div>
          </div>
          <div className="grid min-h-0 flex-1 gap-0 lg:grid-cols-[240px_minmax(0,1fr)]">
              {!!entries.length && (
                <aside className="hidden h-full overflow-y-auto border-r border-[#D7DEE8] bg-white lg:block">
                  <div className="space-y-1 p-2 pr-1">
                    {entries.map((entry) => {
                      const isActive = activeVersion === entry.version;
                      return (
                        <button
                          key={`side_${entry.version}_${entry.capturedAtIso}`}
                          type="button"
                          onClick={() => scrollToVersion(entry.version)}
                          className={`flex h-9 w-full items-center justify-between gap-2 rounded-[8px] px-3 text-left text-[13px] font-semibold transition ${
                            isActive
                              ? "border border-[#CFE0FF] bg-[#EAF1FF] text-[#1E4FA3]"
                              : "border border-transparent text-[#334155] hover:bg-[#F3F6FB]"
                          }`}
                        >
                          <span className="truncate">{entry.version || "Unknown"}</span>
                          <span className="shrink-0 text-[11px] font-medium text-[#64748B]">
                            {formatUpdateDate(entry.capturedAtIso)}
                          </span>
                        </button>
                      );
                    })}
                  </div>
                </aside>
              )}

              <div ref={contentScrollRef} className="h-full min-h-0 space-y-4 overflow-auto bg-[#F5F7FB] p-3 md:p-4 lg:p-5">
                  {isDevUser && showDevReports && (
                    <div className="rounded-[14px] border border-[#D7DEE8] bg-white p-3 shadow-[0_10px_24px_rgba(15,23,42,0.09),0_2px_6px_rgba(15,23,42,0.05)]">
                      <div className="mb-2 flex items-center justify-between">
                        <p className="text-[14px] font-semibold text-[#111827]">User Reports</p>
                        <div className="flex items-center gap-2">
                          <button
                            type="button"
                            onClick={() => setDevReportFilter("all")}
                            className={`h-7 rounded-[8px] border px-3 text-[11px] font-semibold ${
                              devReportFilter === "all"
                                ? "border-[#D0D5DD] bg-[#F2F4F7] text-[#344054]"
                                : "border-[#D7DEE8] bg-white text-[#334155]"
                            }`}
                          >
                            All
                          </button>
                          <button
                            type="button"
                            onClick={() => setDevReportFilter("issue")}
                            className={`h-7 rounded-[8px] border px-3 text-[11px] font-semibold ${
                              devReportFilter === "issue"
                                ? "border-[#FBCBC9] bg-[#FEEAEA] text-[#B42318]"
                                : "border-[#D7DEE8] bg-white text-[#334155]"
                            }`}
                          >
                            Reports
                          </button>
                          <button
                            type="button"
                            onClick={() => setDevReportFilter("feature")}
                            className={`h-7 rounded-[8px] border px-3 text-[11px] font-semibold ${
                              devReportFilter === "feature"
                                ? "border-[#2F6BFF] bg-[#EAF1FF] text-[#1E4FA3]"
                                : "border-[#D7DEE8] bg-white text-[#334155]"
                            }`}
                          >
                            Features
                          </button>
                          <button
                            type="button"
                            onClick={() => setDevReportStatusFilter("open")}
                            className={`h-7 rounded-[8px] border px-3 text-[11px] font-semibold ${
                              devReportStatusFilter === "open"
                                ? "border-[#D0D5DD] bg-[#F2F4F7] text-[#344054]"
                                : "border-[#D7DEE8] bg-white text-[#334155]"
                            }`}
                          >
                            Open
                          </button>
                          <button
                            type="button"
                            onClick={() => setDevReportStatusFilter("completed")}
                            className={`h-7 rounded-[8px] border px-3 text-[11px] font-semibold ${
                              devReportStatusFilter === "completed"
                                ? "border-[#D0D5DD] bg-[#F2F4F7] text-[#344054]"
                                : "border-[#D7DEE8] bg-white text-[#334155]"
                            }`}
                          >
                            Completed
                          </button>
                          <p className="text-[12px] text-[#667085]">{visibleDevReports.length} total</p>
                        </div>
                      </div>
                      {reportsLoading ? (
                        <p className="text-[13px] text-[#667085]">Loading reports...</p>
                      ) : !visibleDevReports.length ? (
                        <p className="text-[13px] text-[#667085]">No reports yet.</p>
                      ) : (
                        <div className="space-y-2">
                          {visibleDevReports.map((report) => (
                            <div
                              key={report.id}
                              className={`rounded-[10px] border px-3 py-2 transition ${
                                report.completed
                                  ? "border-[#D0D5DD] bg-[#F2F4F7] opacity-75"
                                  : "border-[#DCE3EC] bg-[#F8FAFC]"
                              }`}
                            >
                              <div className="mb-1 flex flex-wrap items-center gap-x-2 gap-y-1">
                                <span
                                  className={`inline-flex h-6 items-center rounded-[999px] px-2 text-[11px] font-semibold ${
                                    report.kind === "issue"
                                      ? "bg-[#FEEAEA] text-[#B42318]"
                                      : "bg-[#EAF1FF] text-[#1E4FA3]"
                                  }`}
                                >
                                  {report.kind === "issue" ? "Issue" : "Feature"}
                                </span>
                                <span className="text-[11px] text-[#667085]">
                                  {formatReportDate(report.createdAtIso)}{"   |   "}{formatReportTime(report.createdAtIso)}{"   |   "}
                                  {formatVersionLabel(report.appVersion)}{"   |   "}{formatDeviceLabel(report.deviceType)}{"   |   "}
                                  {report.reporterEmail || report.reporterName}
                                </span>
                                <label className="ml-auto inline-flex items-center gap-1 text-[11px] font-semibold text-[#475467]">
                                  <input
                                    type="checkbox"
                                    checked={Boolean(report.completed)}
                                    onChange={(e) => void onToggleReportCompleted(report.id, e.target.checked)}
                                    className="h-3.5 w-3.5 rounded border-[#98A2B3]"
                                  />
                                  {report.kind === "feature" ? "Complete" : "Resolved"}
                                </label>
                              </div>
                              <p className="text-[13px] font-semibold text-[#111827]">{report.subject || "(No subject)"}</p>
                              <p className="mt-1 whitespace-pre-wrap text-[13px] text-[#344054]">{report.body || "-"}</p>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  )}

                  {!showDevReports && !entries.length && (
                    <div className="rounded-[14px] border border-[#D7DEE8] bg-white p-4 text-[14px] text-[#475467]">
                      No changelog entries yet.
                    </div>
                  )}

                  {!showDevReports && !!entries.length && (
                    <>
                      {entries.map((entry) => (
                        <div
                          key={`${entry.version}_${entry.capturedAtIso}`}
                          ref={(el) => {
                            entryRefs.current[entry.version] = el;
                          }}
                          className="relative flex w-full flex-col overflow-hidden rounded-[14px] border border-[#D7DEE8] bg-white shadow-[0_10px_24px_rgba(15,23,42,0.09),0_2px_6px_rgba(15,23,42,0.05)] text-black"
                        >
                          <div className="flex h-[50px] shrink-0 items-center justify-between border-b border-[#D7DEE8] bg-[#F8FAFC] px-3 rounded-t-[14px]">
                            <p className="text-[20px] font-medium uppercase tracking-[1px] text-black">
                              {entry.version || "Unknown Version"}
                            </p>
                          </div>
                          <div className="px-4 py-4">
                            <div
                              className="text-[15px] leading-7 text-black"
                              dangerouslySetInnerHTML={{
                                __html: updateNotesToDisplayHtml(entry.whatsNew || "- No update notes provided."),
                              }}
                            />
                          </div>
                        </div>
                      ))}
                    </>
                  )}
                </div>
              </div>
          </div>

          {!!composerKind && (
            <div className="fixed inset-0 z-[9998] flex items-center justify-center bg-[rgba(15,23,42,0.36)] backdrop-blur-[2px] p-4">
              <div className="w-full max-w-[760px] overflow-hidden rounded-[14px] border border-[#D7DEE8] bg-white shadow-[0_24px_55px_rgba(15,23,42,0.35)]">
                <div className="flex h-[50px] items-center justify-between border-b border-[#D7DEE8] bg-[#F8FAFC] px-3">
                  <p className="text-[18px] font-medium uppercase tracking-[1px] text-black">
                    {composerKind === "issue" ? "Report Issue" : "Suggest Feature"}
                  </p>
                  <button
                    type="button"
                    onClick={closeComposer}
                    className="h-8 rounded-[8px] border border-[#D7DEE8] bg-white px-3 text-[12px] font-semibold text-[#334155]"
                  >
                    Close
                  </button>
                </div>
                <div className="space-y-3 p-4">
                  <select
                    value={composerDevice}
                    onChange={(e) => setComposerDevice((String(e.target.value || "").toLowerCase() as ReportDeviceType) || "desktop")}
                    className="h-10 w-full rounded-[8px] border border-[#D8DEE8] bg-white px-3 text-[13px]"
                  >
                    <option value="desktop">Desktop</option>
                    <option value="tablet">Tablet</option>
                    <option value="mobile">Mobile</option>
                  </select>
                  <input
                    value={subject}
                    onChange={(e) => setSubject(e.target.value)}
                    placeholder="Subject"
                    className="h-10 w-full rounded-[8px] border border-[#D8DEE8] bg-white px-3 text-[13px]"
                  />
                  <textarea
                    value={body}
                    onChange={(e) => setBody(e.target.value)}
                    placeholder="Body"
                    className="min-h-[200px] w-full rounded-[8px] border border-[#D8DEE8] bg-white p-3 text-[13px]"
                  />
                  <div className="flex items-center justify-between">
                    <p className="text-[12px] text-[#667085]">App Version: {appVersion || entries[0]?.version || "-"}</p>
                    <button
                      type="button"
                      onClick={() => void onSubmitReport()}
                      disabled={submitBusy}
                      className={`h-9 rounded-[8px] px-4 text-[12px] font-semibold text-white ${
                        composerKind === "issue" ? "bg-[#D92D20]" : "bg-[#2F6BFF]"
                      } ${submitBusy ? "opacity-60" : ""}`}
                    >
                      {submitBusy ? "Submitting..." : "Submit"}
                    </button>
                  </div>
                  {!!composerError && <p className="text-[12px] font-semibold text-[#B42318]">{composerError}</p>}
                </div>
              </div>
            </div>
          )}
      </AppShell>
    </ProtectedRoute>
  );
}
