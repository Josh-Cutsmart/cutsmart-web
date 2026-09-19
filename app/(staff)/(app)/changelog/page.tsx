"use client";

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Search } from "lucide-react";
import { useAuth } from "@/lib/auth-context";
import {
  fetchAppChangelogHistory,
  fetchAppReports,
  setAppReportCompleted,
  submitAppReport,
  type AppReportKind,
  type AppReportRow,
} from "@/lib/firestore-data";
import {
  normalizeChangelogHistory,
  parseUpdateNotesText,
  type UpdateChangelogEntry,
  updateNotesToDisplayHtml,
} from "@/lib/update-notes-utils";
import { captureGlassModalOrigin, useGlassModalPopOrigin, type GlassModalOrigin } from "@/lib/use-glass-modal-pop-origin";
import { retryAsync } from "@/lib/load-retry";
type ReportDeviceType = "desktop" | "tablet" | "mobile";
const HEADER_HEIGHT = 56;
const DESKTOP_TAB_BAR_HEIGHT = 48;

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
  const PAGE_SIZE_OPTIONS = [10, 20, 50] as const;
  const { user } = useAuth();
  const [entries, setEntries] = useState<UpdateChangelogEntry[]>([]);
  const [activeVersion, setActiveVersion] = useState("");
  const [entriesPerPage, setEntriesPerPage] = useState<number>(10);
  const [visibleEntryCount, setVisibleEntryCount] = useState<number>(10);
  const [isDevUser, setIsDevUser] = useState(false);
  const [appVersion, setAppVersion] = useState("");
  const [showDevReports, setShowDevReports] = useState(false);
  const [reportsLoading, setReportsLoading] = useState(false);
  const [reports, setReports] = useState<AppReportRow[]>([]);
  const [reportVisibleCount, setReportVisibleCount] = useState<number>(10);
  const [devReportFilter, setDevReportFilter] = useState<AppReportKind | "all">("all");
  const [devReportStatusFilter, setDevReportStatusFilter] = useState<"open" | "completed">("open");
  const [devReportUserFilter, setDevReportUserFilter] = useState("all");
  const [devReportVersionFilter, setDevReportVersionFilter] = useState("all");
  const [devReportDateFilter, setDevReportDateFilter] = useState("");
  const [devReportSearch, setDevReportSearch] = useState("");
  const [composerKind, setComposerKind] = useState<AppReportKind | "">("");
  const [composerDevice, setComposerDevice] = useState<ReportDeviceType>("desktop");
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [submitBusy, setSubmitBusy] = useState(false);
  const [composerError, setComposerError] = useState("");
  const entryRefs = useRef<Record<string, HTMLDivElement | null>>({});
  const pendingScrollVersionRef = useRef("");
  const pageHeaderRef = useRef<HTMLDivElement | null>(null);
  const sidebarPlaceholderRef = useRef<HTMLDivElement | null>(null);
  const [sidebarLeft, setSidebarLeft] = useState<number | null>(null);
  const suppressScrollSyncRef = useRef(false);
  const suppressScrollSyncTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [composerOrigin, setComposerOrigin] = useState<GlassModalOrigin>(null);
  const composerPanelRef = useRef<HTMLDivElement | null>(null);
  const shouldRenderComposer = useGlassModalPopOrigin(Boolean(composerKind), composerOrigin, composerPanelRef);
  const [versionHighlightRect, setVersionHighlightRect] = useState<{ top: number; height: number } | null>(null);
  const versionListRef = useRef<HTMLDivElement | null>(null);
  const versionItemRefs = useRef<Record<string, HTMLButtonElement | null>>({});

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
      setVisibleEntryCount((current) => {
        const minimum = entriesPerPage;
        const next = current > minimum ? current : minimum;
        return Math.min(Math.max(minimum, next), rows.length || minimum);
      });

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
  }, [user?.uid, entriesPerPage]);

  useEffect(() => {
    if (!showDevReports || !isDevUser) return;
    let cancelled = false;
    const loadReports = async () => {
      setReportsLoading(true);
      try {
        const rows = await retryAsync(() => fetchAppReports(), { attempts: 2, delayMs: 350 });
        if (!cancelled) {
          setReports(rows);
          setReportVisibleCount(entriesPerPage);
        }
      } finally {
        if (!cancelled) setReportsLoading(false);
      }
    };
    void loadReports();
    return () => {
      cancelled = true;
    };
  }, [showDevReports, isDevUser]);

  const visibleEntries = useMemo(
    () => entries.slice(0, Math.min(entries.length, visibleEntryCount)),
    [entries, visibleEntryCount],
  );

  useLayoutEffect(() => {
    const measure = () => {
      const container = versionListRef.current;
      const el = activeVersion ? versionItemRefs.current[activeVersion] : null;
      if (!container || !el) {
        setVersionHighlightRect(null);
        return;
      }
      const containerRect = container.getBoundingClientRect();
      const elRect = el.getBoundingClientRect();
      setVersionHighlightRect({ top: elRect.top - containerRect.top + container.scrollTop, height: elRect.height });
    };
    measure();
    if (typeof window === "undefined") return;
    window.addEventListener("resize", measure);
    return () => window.removeEventListener("resize", measure);
    // `sidebarLeft` gates whether the <aside> containing versionListRef is even
    // mounted (it only renders once `sidebarLeft !== null`) — without it here,
    // this can run while the container is still null, and never re-run once the
    // aside actually mounts (since neither `activeVersion` nor `entries` change
    // at that point), leaving the highlight missing until a version is clicked.
  }, [activeVersion, entries, sidebarLeft]);

  useLayoutEffect(() => {
    const measure = () => {
      const el = sidebarPlaceholderRef.current;
      if (!el || el.getBoundingClientRect().width === 0) {
        setSidebarLeft(null);
        return;
      }
      setSidebarLeft(el.getBoundingClientRect().left);
    };
    measure();
    if (typeof window === "undefined") return;
    window.addEventListener("resize", measure);
    return () => window.removeEventListener("resize", measure);
  }, [entries.length]);

  useEffect(() => {
    const pendingVersion = String(pendingScrollVersionRef.current || "").trim();
    if (!pendingVersion) return;
    const target = entryRefs.current[pendingVersion];
    if (!target) return;
    const frame = window.requestAnimationFrame(() => {
      scrollToVersion(pendingVersion);
      pendingScrollVersionRef.current = "";
    });
    return () => {
      window.cancelAnimationFrame(frame);
    };
  }, [visibleEntries]);

  useEffect(() => {
    if (typeof window === "undefined" || showDevReports || !visibleEntries.length) return;

    const syncActiveVersionFromScroll = () => {
      if (suppressScrollSyncRef.current) return;

      const atBottom = window.innerHeight + window.scrollY >= document.documentElement.scrollHeight - 4;
      if (atBottom) {
        const lastVersion = visibleEntries[visibleEntries.length - 1]?.version;
        if (lastVersion) {
          setActiveVersion((current) => (current === lastVersion ? current : lastVersion));
        }
        return;
      }

      const headerBottom = pageHeaderRef.current?.getBoundingClientRect().bottom ?? HEADER_HEIGHT;
      const anchorY = headerBottom + 72;
      let nextActive = visibleEntries[0]?.version || "";
      let bestDistance = Number.POSITIVE_INFINITY;

      for (const entry of visibleEntries) {
        const target = entryRefs.current[entry.version];
        if (!target) continue;
        const targetRect = target.getBoundingClientRect();
        const distance = Math.abs(targetRect.top - anchorY);
        if (targetRect.bottom >= headerBottom + 24 && distance < bestDistance) {
          bestDistance = distance;
          nextActive = entry.version;
        }
      }

      if (nextActive) {
        setActiveVersion((current) => (current === nextActive ? current : nextActive));
      }
    };

    syncActiveVersionFromScroll();
    window.addEventListener("scroll", syncActiveVersionFromScroll, { passive: true });
    window.addEventListener("resize", syncActiveVersionFromScroll);
    return () => {
      window.removeEventListener("scroll", syncActiveVersionFromScroll);
      window.removeEventListener("resize", syncActiveVersionFromScroll);
    };
  }, [showDevReports, visibleEntries]);

  const scrollToVersion = (version: string) => {
    const target = entryRefs.current[version];
    if (!target) return;
    setActiveVersion(version);
    if (suppressScrollSyncTimeoutRef.current) {
      clearTimeout(suppressScrollSyncTimeoutRef.current);
    }
    suppressScrollSyncRef.current = true;
    suppressScrollSyncTimeoutRef.current = setTimeout(() => {
      suppressScrollSyncRef.current = false;
    }, 700);
    const headerBottom = pageHeaderRef.current?.getBoundingClientRect().bottom ?? HEADER_HEIGHT;
    const targetRect = target.getBoundingClientRect();
    const nextTop = window.scrollY + targetRect.top - headerBottom - 16;
    window.scrollTo({ top: Math.max(0, nextTop), behavior: "smooth" });
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

  const openVersionFromSidebar = (version: string) => {
    const normalizedTarget = normalizeVersionToken(version);
    const targetIndex = entries.findIndex(
      (entry) => normalizeVersionToken(entry.version) === normalizedTarget,
    );
    if (targetIndex < 0) return;
    const requiredCount = targetIndex + 1;
    setActiveVersion(version);
    if (requiredCount > visibleEntryCount) {
      pendingScrollVersionRef.current = version;
      setVisibleEntryCount(requiredCount);
      return;
    }
    scrollToVersion(version);
  };

  const onChangeEntriesPerPage = (value: number) => {
    const nextSize = PAGE_SIZE_OPTIONS.includes(value as (typeof PAGE_SIZE_OPTIONS)[number]) ? value : 10;
    setEntriesPerPage(nextSize);
    setVisibleEntryCount(Math.min(entries.length || nextSize, nextSize));
    const currentTopVersion = visibleEntries[0]?.version || entries[0]?.version || "";
    if (currentTopVersion) {
      pendingScrollVersionRef.current = currentTopVersion;
    }
  };

  const openComposer = (kind: AppReportKind, origin: GlassModalOrigin) => {
    setComposerOrigin(origin);
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
  const userFilterOptions = useMemo(
    () =>
      Array.from(
        new Set(
          reports
            .map((row) => String(row.reporterName || row.reporterEmail || "").trim())
            .filter(Boolean),
        ),
      ).sort((a, b) => a.localeCompare(b)),
    [reports],
  );
  const versionFilterOptions = useMemo(
    () =>
      Array.from(
        new Set(
          reports
            .map((row) => formatVersionLabel(row.appVersion))
            .filter((value) => value && value !== "-"),
        ),
      ).sort((a, b) => b.localeCompare(a)),
    [reports],
  );
  const visibleDevReports = filteredDevReports.filter((row) => {
    if (devReportStatusFilter === "completed" ? !row.completed : row.completed) {
      return false;
    }
    const reporterLabel = String(row.reporterName || row.reporterEmail || "").trim();
    if (devReportUserFilter !== "all" && reporterLabel !== devReportUserFilter) {
      return false;
    }
    if (devReportVersionFilter !== "all" && formatVersionLabel(row.appVersion) !== devReportVersionFilter) {
      return false;
    }
    if (devReportDateFilter) {
      const reportDate = String(row.createdAtIso || "").slice(0, 10);
      if (reportDate !== devReportDateFilter) {
        return false;
      }
    }
    const search = String(devReportSearch || "").trim().toLowerCase();
    if (search) {
      const haystack = [
        row.subject,
        row.body,
        row.reporterName,
        row.reporterEmail,
        row.appVersion,
        formatVersionLabel(row.appVersion),
      ]
        .join(" ")
        .toLowerCase();
      if (!haystack.includes(search)) {
        return false;
      }
    }
    return true;
  });
  const pagedDevReports = visibleDevReports.slice(0, Math.min(visibleDevReports.length, reportVisibleCount));

  useEffect(() => {
    setReportVisibleCount(entriesPerPage);
  }, [entriesPerPage, showDevReports, devReportFilter, devReportStatusFilter, devReportUserFilter, devReportVersionFilter, devReportDateFilter, devReportSearch]);

  const formatDeviceLabel = (value: ReportDeviceType | "") => {
    if (value === "mobile") return "Mobile";
    if (value === "tablet") return "Tablet";
    return "Desktop";
  };
  return (
    <>
        <div
          className="-mt-3 flex flex-col bg-transparent md:-mt-4 lg:-mt-4"
          style={{
            marginLeft: "calc(-1 * max(12px, env(safe-area-inset-left)))",
            marginRight: "calc(-1 * max(12px, env(safe-area-inset-right)))",
          }}
        >
          <div
            ref={pageHeaderRef}
            className="glass-page-header sticky top-[104px] z-[95] flex h-[56px] shrink-0 items-center justify-between gap-2 px-4 md:px-5 lg:top-12"
          >
            <div className="flex min-w-0 flex-wrap items-center gap-5">
              <div className="inline-flex min-w-0 items-center gap-2">
                <Search size={16} style={{ color: "var(--text-main)" }} strokeWidth={2.1} />
                <p className="truncate text-[14px] font-medium uppercase tracking-[1px]" style={{ color: "var(--text-main)" }}>
                  Changelog
                </p>
              </div>
              <div className="hidden items-center gap-2 border-l pl-5 sm:flex" style={{ borderColor: "var(--glass-border)" }}>
                <span className="text-[11px] font-bold uppercase tracking-[0.4px]" style={{ color: "var(--text-muted)" }}>
                  Current version
                </span>
                <span
                  className="rounded-full border px-2.5 py-1 text-[11px] font-bold"
                  style={{ borderColor: "var(--glass-border)", backgroundColor: "var(--panel-muted)", color: "var(--text-muted)" }}
                >
                  {formatVersionLabel(appVersion || entries[0]?.version || "")}
                </span>
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-3">
              <select
                value={entriesPerPage}
                onChange={(e) => onChangeEntriesPerPage(Number(e.target.value || 10))}
                className="h-8 rounded-[8px] border px-3 text-[12px] font-bold outline-none"
                style={{ borderColor: "var(--glass-border)", backgroundColor: "var(--panel-muted)", color: "var(--text-main)" }}
              >
                <option value={10}>10 per page</option>
                <option value={20}>20 per page</option>
                <option value={50}>50 per page</option>
              </select>
              {isDevUser && (
                <div className="flex items-center border-l pl-3" style={{ borderColor: "var(--glass-border)" }}>
                  <button
                    type="button"
                    onClick={() => setShowDevReports((prev) => !prev)}
                    className="h-8 rounded-[8px] border px-3 text-[12px] font-bold transition hover:brightness-95"
                    style={
                      showDevReports
                        ? { backgroundImage: "var(--brand-gradient)", borderColor: "var(--brand-strong)", color: "#fff" }
                        : { borderColor: "var(--glass-border)", backgroundColor: "var(--panel-muted)", color: "var(--text-main)" }
                    }
                  >
                    {showDevReports ? "View Changelog" : "View Reports"}
                  </button>
                </div>
              )}
              <div className="flex items-center gap-2 border-l pl-3" style={{ borderColor: "var(--glass-border)" }}>
                <button
                  type="button"
                  onClick={(e) => openComposer("issue", captureGlassModalOrigin(e))}
                  className="h-8 rounded-[8px] border px-3 text-[12px] font-bold text-white transition hover:brightness-95"
                  style={{ backgroundImage: "var(--danger-gradient)", borderColor: "var(--danger-strong)" }}
                >
                  Report Issue
                </button>
                <button
                  type="button"
                  onClick={(e) => openComposer("feature", captureGlassModalOrigin(e))}
                  className="h-8 rounded-[8px] border px-3 text-[12px] font-bold text-white transition hover:brightness-95"
                  style={{ backgroundImage: "var(--brand-gradient)", borderColor: "var(--brand-strong)" }}
                >
                  Suggest Feature
                </button>
              </div>
            </div>
          </div>
          <div className="grid gap-0 lg:grid-cols-[240px_minmax(0,1fr)]">
              {!!entries.length && <div ref={sidebarPlaceholderRef} aria-hidden="true" className="hidden lg:block" />}

              <div className="space-y-4 p-3 md:p-4 lg:p-5">
                  {isDevUser && showDevReports && (
                    <div
                      className="rounded-[16px] border p-3"
                      style={{
                        borderColor: "var(--glass-border)",
                        backgroundColor: "var(--glass-bg-strong)",
                        backdropFilter: "blur(20px) saturate(180%)",
                        WebkitBackdropFilter: "blur(20px) saturate(180%)",
                        boxShadow: "var(--shadow-glass)",
                      }}
                    >
                      <div className="mb-2 flex items-center justify-between gap-3">
                        <div className="flex min-w-0 items-center gap-3">
                          <p className="shrink-0 text-[14px] font-bold" style={{ color: "var(--text-main)" }}>User Reports</p>
                          <div className="relative w-[260px] max-w-full">
                            <Search
                              size={14}
                              style={{ color: "var(--text-muted)" }}
                              strokeWidth={2}
                              className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2"
                            />
                            <input
                              value={devReportSearch}
                              onChange={(e) => setDevReportSearch(e.target.value)}
                              placeholder="Search reports..."
                              className="h-8 w-full rounded-[8px] border pl-9 pr-3 text-[12px] outline-none"
                              style={{ borderColor: "var(--glass-border)", backgroundColor: "var(--panel-muted)", color: "var(--text-main)" }}
                            />
                          </div>
                          <select
                            value={devReportDateFilter}
                            onChange={(e) => setDevReportDateFilter(String(e.target.value || ""))}
                            className="h-8 rounded-[8px] border px-3 text-[12px] font-semibold outline-none"
                            style={{ borderColor: "var(--glass-border)", backgroundColor: "var(--panel-muted)", color: "var(--text-main)" }}
                          >
                            <option value="">All dates</option>
                            {Array.from(
                              new Set(
                                reports
                                  .map((row) => String(row.createdAtIso || "").slice(0, 10))
                                  .filter(Boolean),
                              ),
                            )
                              .sort((a, b) => b.localeCompare(a))
                              .map((dateValue) => (
                                <option key={dateValue} value={dateValue}>
                                  {formatReportDate(dateValue)}
                                </option>
                              ))}
                          </select>
                          <select
                            value={devReportUserFilter}
                            onChange={(e) => setDevReportUserFilter(String(e.target.value || "all"))}
                            className="h-8 rounded-[8px] border px-3 text-[12px] font-semibold outline-none"
                            style={{ borderColor: "var(--glass-border)", backgroundColor: "var(--panel-muted)", color: "var(--text-main)" }}
                          >
                            <option value="all">All users</option>
                            {userFilterOptions.map((userValue) => (
                              <option key={userValue} value={userValue}>
                                {userValue}
                              </option>
                            ))}
                          </select>
                          <select
                            value={devReportVersionFilter}
                            onChange={(e) => setDevReportVersionFilter(String(e.target.value || "all"))}
                            className="h-8 rounded-[8px] border px-3 text-[12px] font-semibold outline-none"
                            style={{ borderColor: "var(--glass-border)", backgroundColor: "var(--panel-muted)", color: "var(--text-main)" }}
                          >
                            <option value="all">All versions</option>
                            {versionFilterOptions.map((versionValue) => (
                              <option key={versionValue} value={versionValue}>
                                {versionValue}
                              </option>
                            ))}
                          </select>
                        </div>
                        <div className="flex items-center gap-2">
                          <button
                            type="button"
                            onClick={() => setDevReportFilter("all")}
                            className="h-7 rounded-[8px] border px-3 text-[11px] font-bold transition hover:brightness-95"
                            style={
                              devReportFilter === "all"
                                ? { backgroundImage: "var(--brand-gradient)", borderColor: "var(--brand-strong)", color: "#fff" }
                                : { borderColor: "var(--glass-border)", backgroundColor: "var(--panel-muted)", color: "var(--text-main)" }
                            }
                          >
                            All
                          </button>
                          <button
                            type="button"
                            onClick={() => setDevReportFilter("issue")}
                            className="h-7 rounded-[8px] border px-3 text-[11px] font-bold transition hover:brightness-95"
                            style={
                              devReportFilter === "issue"
                                ? { borderColor: "var(--danger-border)", backgroundColor: "var(--danger-soft)", color: "var(--danger-strong)" }
                                : { borderColor: "var(--glass-border)", backgroundColor: "var(--panel-muted)", color: "var(--text-main)" }
                            }
                          >
                            Reports
                          </button>
                          <button
                            type="button"
                            onClick={() => setDevReportFilter("feature")}
                            className="h-7 rounded-[8px] border px-3 text-[11px] font-bold transition hover:brightness-95"
                            style={
                              devReportFilter === "feature"
                                ? { backgroundImage: "var(--brand-gradient)", borderColor: "var(--brand-strong)", color: "#fff" }
                                : { borderColor: "var(--glass-border)", backgroundColor: "var(--panel-muted)", color: "var(--text-main)" }
                            }
                          >
                            Features
                          </button>
                          <button
                            type="button"
                            onClick={() => setDevReportStatusFilter("open")}
                            className="h-7 rounded-[8px] border px-3 text-[11px] font-bold transition hover:brightness-95"
                            style={
                              devReportStatusFilter === "open"
                                ? { backgroundImage: "var(--brand-gradient)", borderColor: "var(--brand-strong)", color: "#fff" }
                                : { borderColor: "var(--glass-border)", backgroundColor: "var(--panel-muted)", color: "var(--text-main)" }
                            }
                          >
                            Open
                          </button>
                          <button
                            type="button"
                            onClick={() => setDevReportStatusFilter("completed")}
                            className="h-7 rounded-[8px] border px-3 text-[11px] font-bold transition hover:brightness-95"
                            style={
                              devReportStatusFilter === "completed"
                                ? { backgroundImage: "var(--brand-gradient)", borderColor: "var(--brand-strong)", color: "#fff" }
                                : { borderColor: "var(--glass-border)", backgroundColor: "var(--panel-muted)", color: "var(--text-main)" }
                            }
                          >
                            Completed
                          </button>
                          <p className="text-[12px] font-semibold" style={{ color: "var(--text-muted)" }}>{visibleDevReports.length} total</p>
                        </div>
                      </div>
                      {reportsLoading ? (
                        <p className="text-[13px] font-semibold" style={{ color: "var(--text-muted)" }}>Loading reports...</p>
                      ) : !visibleDevReports.length ? (
                        <p className="text-[13px] font-semibold" style={{ color: "var(--text-muted)" }}>No reports yet.</p>
                      ) : (
                        <div className="space-y-2">
                          {pagedDevReports.map((report) => (
                            <div
                              key={report.id}
                              className="rounded-[12px] border px-3 py-2 transition"
                              style={
                                report.completed
                                  ? { borderColor: "var(--glass-border)", backgroundColor: "var(--panel-muted)", opacity: 0.75 }
                                  : { borderColor: "var(--glass-border)", backgroundColor: "var(--glass-bg-strong)" }
                              }
                            >
                              <div className="mb-1 flex flex-wrap items-center gap-x-2 gap-y-1">
                                <span
                                  className="inline-flex h-6 items-center rounded-[999px] px-2 text-[11px] font-bold"
                                  style={
                                    report.kind === "issue"
                                      ? { backgroundColor: "var(--danger-soft)", color: "var(--danger-strong)" }
                                      : { backgroundColor: "var(--brand-soft)", color: "var(--brand-strong)" }
                                  }
                                >
                                  {report.kind === "issue" ? "Issue" : "Feature"}
                                </span>
                                <span className="text-[11px] font-semibold" style={{ color: "var(--text-muted)" }}>
                                  {formatReportDate(report.createdAtIso)}{"   |   "}{formatReportTime(report.createdAtIso)}{"   |   "}
                                  {formatVersionLabel(report.appVersion)}{"   |   "}{formatDeviceLabel(report.deviceType)}{"   |   "}
                                  {report.reporterEmail || report.reporterName}
                                </span>
                                <label className="ml-auto inline-flex items-center gap-1 text-[11px] font-bold" style={{ color: "var(--text-main)" }}>
                                  <input
                                    type="checkbox"
                                    checked={Boolean(report.completed)}
                                    onChange={(e) => void onToggleReportCompleted(report.id, e.target.checked)}
                                    className="h-3.5 w-3.5 rounded"
                                    style={{ borderColor: "var(--glass-border)" }}
                                  />
                                  {report.kind === "feature" ? "Complete" : "Resolved"}
                                </label>
                              </div>
                              <p className="text-[13px] font-bold" style={{ color: "var(--text-main)" }}>{report.subject || "(No subject)"}</p>
                              <p className="mt-1 whitespace-pre-wrap text-[13px]" style={{ color: "var(--text-muted)" }}>{report.body || "-"}</p>
                            </div>
                          ))}
                          {reportVisibleCount < visibleDevReports.length && (
                            <div className="flex justify-center pt-1">
                              <button
                                type="button"
                                onClick={() =>
                                  setReportVisibleCount((current) =>
                                    Math.min(visibleDevReports.length, current + entriesPerPage),
                                  )
                                }
                                className="h-10 rounded-[10px] border px-5 text-[13px] font-bold transition hover:brightness-95"
                                style={{ borderColor: "var(--brand-strong)", backgroundColor: "var(--brand-soft)", color: "var(--brand-strong)" }}
                              >
                                Show More
                              </button>
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  )}

                  {!showDevReports && !entries.length && (
                    <div
                      className="rounded-[14px] border p-4 text-[14px] font-semibold"
                      style={{ borderColor: "var(--glass-border)", backgroundColor: "var(--panel-muted)", color: "var(--text-muted)" }}
                    >
                      No changelog entries yet.
                    </div>
                  )}

                  {!showDevReports && !!entries.length && (
                    <>
                      {visibleEntries.map((entry) => (
                        <div
                          key={`${entry.version}_${entry.capturedAtIso}`}
                          ref={(el) => {
                            entryRefs.current[entry.version] = el;
                          }}
                          className="relative flex w-full flex-col overflow-hidden rounded-[16px] border"
                          style={{
                            borderColor: "var(--glass-border)",
                            backgroundColor: "var(--glass-bg-strong)",
                            backdropFilter: "blur(20px) saturate(180%)",
                            WebkitBackdropFilter: "blur(20px) saturate(180%)",
                            boxShadow: "var(--shadow-glass)",
                          }}
                        >
                          <div
                            className="flex h-[50px] shrink-0 items-center justify-between border-b px-3"
                            style={{ borderColor: "var(--glass-border)" }}
                          >
                            <p className="text-[20px] font-bold uppercase tracking-[1px]" style={{ color: "var(--text-main)" }}>
                              {entry.version || "Unknown Version"}
                            </p>
                          </div>
                          <div className="px-4 py-4">
                            <div
                              className="text-[15px] leading-7"
                              style={{ color: "var(--text-main)" }}
                              dangerouslySetInnerHTML={{
                                __html: updateNotesToDisplayHtml(entry.whatsNew || "- No update notes provided."),
                              }}
                            />
                          </div>
                        </div>
                      ))}
                      {visibleEntryCount < entries.length && (
                        <div className="flex justify-center pt-1">
                          <button
                            type="button"
                            onClick={() =>
                              setVisibleEntryCount((current) =>
                                Math.min(entries.length, current + entriesPerPage),
                              )
                            }
                            className="h-10 rounded-[10px] border px-5 text-[13px] font-bold transition hover:brightness-95"
                            style={{ borderColor: "var(--brand-strong)", backgroundColor: "var(--brand-soft)", color: "var(--brand-strong)" }}
                          >
                            Show More
                          </button>
                        </div>
                      )}
                    </>
                  )}
                </div>
              </div>
          </div>

          {!!entries.length && sidebarLeft !== null && (
            <aside
              className="fixed hidden overflow-y-auto overscroll-contain border-r lg:block"
              style={{
                left: sidebarLeft,
                width: 240,
                top: DESKTOP_TAB_BAR_HEIGHT + HEADER_HEIGHT,
                height: `calc(100svh - ${DESKTOP_TAB_BAR_HEIGHT + HEADER_HEIGHT}px)`,
                borderColor: "var(--glass-border)",
                backgroundColor: "var(--glass-bg-strong)",
                backdropFilter: "blur(20px) saturate(180%)",
                WebkitBackdropFilter: "blur(20px) saturate(180%)",
              }}
            >
              <div ref={versionListRef} className="glass-scroll relative space-y-0.5 p-2 pr-1">
                {versionHighlightRect && (
                  <div
                    aria-hidden="true"
                    className="absolute left-2 right-3 rounded-[8px]"
                    style={{
                      top: versionHighlightRect.top,
                      height: versionHighlightRect.height,
                      backgroundColor: "var(--brand-soft)",
                      transition: "top 260ms cubic-bezier(0.22, 1, 0.36, 1), height 260ms cubic-bezier(0.22, 1, 0.36, 1)",
                      zIndex: 0,
                    }}
                  />
                )}
                {entries.map((entry) => {
                  const isActive = activeVersion === entry.version;
                  return (
                    <button
                      key={`side_${entry.version}_${entry.capturedAtIso}`}
                      ref={(el) => {
                        versionItemRefs.current[entry.version] = el;
                      }}
                      type="button"
                      onClick={() => openVersionFromSidebar(entry.version)}
                      className={`relative z-[1] flex h-9 w-full items-center justify-between gap-2 rounded-[8px] px-3 text-left text-[13px] font-bold transition-colors ${!isActive ? "hover:bg-[var(--panel-muted)]" : ""}`}
                      style={{ color: isActive ? "var(--brand)" : "var(--text-main)" }}
                    >
                      <span className="truncate">{entry.version || "Unknown"}</span>
                      <span className="shrink-0 text-[11px] font-semibold" style={{ color: isActive ? "var(--brand)" : "var(--text-muted)" }}>
                        {formatUpdateDate(entry.capturedAtIso)}
                      </span>
                    </button>
                  );
                })}
              </div>
            </aside>
          )}

          {shouldRenderComposer && typeof document !== "undefined" && createPortal(
            <div className="fixed inset-0 z-[9998] flex items-center justify-center p-4">
              <button
                type="button"
                aria-label="Close report composer backdrop"
                onClick={() => {
                  if (subject.trim() || body.trim()) return;
                  closeComposer();
                }}
                className="glass-modal-backdrop absolute inset-0"
              />
              <div ref={composerPanelRef} className="glass-modal-panel relative w-full max-w-[760px] overflow-hidden">
                <div className="glass-modal-header flex h-[50px] items-center justify-between px-4">
                  <p className="text-[15px] font-bold uppercase tracking-[1px]" style={{ color: "var(--text-main)" }}>
                    {composerKind === "issue" ? "Report Issue" : "Suggest Feature"}
                  </p>
                  <button
                    type="button"
                    onClick={closeComposer}
                    className="h-8 rounded-[8px] border px-3 text-[12px] font-bold transition hover:brightness-95"
                    style={{ borderColor: "var(--glass-border)", backgroundColor: "var(--panel-muted)", color: "var(--text-main)" }}
                  >
                    Close
                  </button>
                </div>
                <div className="space-y-4 p-4 sm:p-6">
                  <select
                    value={composerDevice}
                    onChange={(e) => setComposerDevice((String(e.target.value || "").toLowerCase() as ReportDeviceType) || "desktop")}
                    className="h-10 w-full max-w-[280px] rounded-[10px] border px-3 text-[13px] outline-none"
                    style={{ borderColor: "var(--glass-border)", backgroundColor: "var(--panel-bg)", color: "var(--text-main)" }}
                  >
                    <option value="desktop">Desktop</option>
                    <option value="tablet">Tablet</option>
                    <option value="mobile">Mobile</option>
                  </select>
                  <input
                    value={subject}
                    onChange={(e) => setSubject(e.target.value)}
                    placeholder="Subject"
                    className="h-10 w-full max-w-[480px] rounded-[10px] border px-3 text-[13px] outline-none"
                    style={{ borderColor: "var(--glass-border)", backgroundColor: "var(--panel-bg)", color: "var(--text-main)" }}
                  />
                  <textarea
                    value={body}
                    onChange={(e) => setBody(e.target.value)}
                    placeholder="Body"
                    className="min-h-[150px] w-full rounded-[10px] border p-3 text-[13px] outline-none"
                    style={{ borderColor: "var(--glass-border)", backgroundColor: "var(--panel-bg)", color: "var(--text-main)" }}
                  />
                  <div className="flex items-center justify-between">
                    <p className="text-[12px] font-semibold" style={{ color: "var(--text-muted)" }}>App Version: {appVersion || entries[0]?.version || "-"}</p>
                    <button
                      type="button"
                      onClick={() => void onSubmitReport()}
                      disabled={submitBusy}
                      className="h-9 rounded-[8px] border px-4 text-[12px] font-bold text-white transition hover:brightness-95 disabled:opacity-60"
                      style={{ backgroundColor: "#16A34A", borderColor: "#166534" }}
                    >
                      {submitBusy ? "Submitting..." : "Submit"}
                    </button>
                  </div>
                  {!!composerError && (
                    <p className="text-[12px] font-bold" style={{ color: "var(--danger-strong)" }}>{composerError}</p>
                  )}
                </div>
              </div>
            </div>,
            document.body,
          )}
    </>
  );
}
