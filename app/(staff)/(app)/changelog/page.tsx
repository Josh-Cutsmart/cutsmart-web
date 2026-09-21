"use client";

import { useEffect, useLayoutEffect, useMemo, useRef, useState, type TouchEvent as ReactTouchEvent } from "react";
import { createPortal } from "react-dom";
import { useRouter } from "next/navigation";
import { ChevronLeft, Search } from "lucide-react";
import { useAuth } from "@/lib/auth-context";
import { useSwipeToClose } from "@/lib/use-swipe-to-close";
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
import { useAppTabs } from "@/lib/app-tabs-context";
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
  const router = useRouter();
  const { setReduceMainTopPadding } = useAppTabs();
  // This page's own sticky header used a negative top margin on its ancestor to cancel <main>'s
  // default top padding, which reproducibly froze the header at its unshifted (i.e. under the
  // fixed global top bar) position on load instead of the intended flush-below-it start — the
  // exact bug already diagnosed and fixed for project details/company settings/recently deleted
  // (see those pages' own comments). Opting out of <main>'s own top padding here directly, the
  // same way, fixes it without a negative margin.
  useEffect(() => {
    setReduceMainTopPadding(true);
    return () => setReduceMainTopPadding(false);
  }, [setReduceMainTopPadding]);
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
  // Title bar (just "Changelog" + version badge) and the buttons bar (entries-per-page, dev
  // report toggle, Report Issue, Suggest Feature) below it are two separate sticky rows — a
  // single combined row used to wrap its buttons onto extra lines inside a fixed h-[56px] box on
  // narrow viewports, clipping them. pageHeaderRef always points at whichever is the LOWER of the
  // two (the buttons bar), since that's the real boundary content should scroll under.
  // Mobile only (below lg) — desktop has room to keep the original single combined row (title +
  // version badge + buttons together); this bar only splits off on narrow screens, where it used
  // to wrap its buttons onto extra lines inside a fixed h-[56px] box, clipping them.
  const [isCompactChangelogViewport, setIsCompactChangelogViewport] = useState(false);
  useEffect(() => {
    if (typeof window === "undefined") return;
    const query = window.matchMedia("(max-width: 1023px)");
    setIsCompactChangelogViewport(query.matches);
    const onChange = (event: MediaQueryListEvent) => setIsCompactChangelogViewport(event.matches);
    query.addEventListener("change", onChange);
    return () => query.removeEventListener("change", onChange);
  }, []);
  const titleBarRef = useRef<HTMLDivElement | null>(null);
  const pageHeaderRef = useRef<HTMLDivElement | null>(null);
  const [buttonsBarHeight, setButtonsBarHeight] = useState(0);
  useLayoutEffect(() => {
    if (typeof ResizeObserver === "undefined") return;
    const el = pageHeaderRef.current;
    if (!el) {
      setButtonsBarHeight(0);
      return;
    }
    const observer = new ResizeObserver((entries) => {
      for (const entry of entries) {
        setButtonsBarHeight(Math.ceil(entry.borderBoxSize?.[0]?.blockSize ?? entry.contentRect.height));
      }
    });
    observer.observe(el);
    setButtonsBarHeight(el.getBoundingClientRect().height);
    return () => observer.disconnect();
  }, [isCompactChangelogViewport]);
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
  // Mobile-only version list drawer: the desktop sidebar (versionListRef's own <aside>, hidden
  // below lg) becomes a swipe-in edge drawer on mobile instead — same push-the-whole-page-over
  // mechanism as the project page's Specs/Quote Version History drawers (see that file's own
  // comment on why a transform on the page's own outer ref also drags its `position: sticky`
  // title/buttons bars along, since a transformed ancestor becomes their containing block).
  const changelogPageRef = useRef<HTMLDivElement | null>(null);
  const mobileVersionsPanelRef = useRef<HTMLDivElement | null>(null);
  const [isMobileVersionsPanelOpen, setIsMobileVersionsPanelOpen] = useState(false);
  const mobileVersionsSwipe = useSwipeToClose(
    isCompactChangelogViewport && isMobileVersionsPanelOpen,
    () => setIsMobileVersionsPanelOpen(false),
    mobileVersionsPanelRef,
    { edge: "left", pushRef: changelogPageRef },
  );
  // Swiping anywhere on the page (not already inside the open drawer, which handles its own
  // drag-to-close) opens it — mirrors the project page's own makeSpecsQuoteMobileSwipeHandlers,
  // just one direction/one panel here instead of two.
  const mobileVersionsSwipeStartRef = useRef<{ x: number; y: number; axis: "" | "horizontal" | "vertical" } | null>(null);
  const MOBILE_VERSIONS_SWIPE_THRESHOLD_PX = 60;
  const mobileVersionsSwipeHandlers = {
    onTouchStart: (event: ReactTouchEvent<HTMLElement>) => {
      if (!isCompactChangelogViewport || isMobileVersionsPanelOpen) {
        mobileVersionsSwipeStartRef.current = null;
        return;
      }
      const touch = event.touches[0];
      if (!touch) return;
      mobileVersionsSwipeStartRef.current = { x: touch.clientX, y: touch.clientY, axis: "" };
    },
    onTouchMove: (event: ReactTouchEvent<HTMLElement>) => {
      const start = mobileVersionsSwipeStartRef.current;
      if (!start) return;
      const touch = event.touches[0];
      if (!touch) return;
      if (!start.axis) {
        const dx = touch.clientX - start.x;
        const dy = touch.clientY - start.y;
        if (Math.abs(dx) < 8 && Math.abs(dy) < 8) return;
        start.axis = Math.abs(dx) > Math.abs(dy) ? "horizontal" : "vertical";
      }
    },
    onTouchEnd: (event: ReactTouchEvent<HTMLElement>) => {
      const start = mobileVersionsSwipeStartRef.current;
      mobileVersionsSwipeStartRef.current = null;
      if (!start || start.axis !== "horizontal") return;
      const touch = event.changedTouches[0];
      if (!touch) return;
      const dx = touch.clientX - start.x;
      if (dx < -MOBILE_VERSIONS_SWIPE_THRESHOLD_PX) {
        setIsMobileVersionsPanelOpen(true);
      }
    },
  };

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
          ref={changelogPageRef}
          className="flex flex-col bg-transparent"
          style={{
            marginLeft: "calc(-1 * max(12px, env(safe-area-inset-left)))",
            marginRight: "calc(-1 * max(12px, env(safe-area-inset-right)))",
          }}
          {...(isCompactChangelogViewport ? mobileVersionsSwipeHandlers : {})}
        >
          <div
            ref={titleBarRef}
            className={
              isCompactChangelogViewport
                ? "glass-page-header sticky top-0 z-[95] flex h-[56px] shrink-0 items-center gap-5 px-4 md:px-5 lg:top-[48px]"
                : "glass-page-header sticky top-0 z-[95] flex h-[56px] shrink-0 items-center justify-between gap-2 px-4 md:px-5 lg:top-[48px]"
            }
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
            {/* Mobile only — Report Issue/Suggest Feature live in the top bar itself here (not the
                second row below, which keeps just entries-per-page/dev toggle), with a Back chevron
                pinned to the true right edge via the flex-1 scroll area ahead of it taking up all
                remaining space — same "let it run off-screen and scroll rather than wrap" and
                "right-aligned Back button" conventions as the project page's own mobile bars. */}
            {isCompactChangelogViewport && (
              <div className="hide-native-scrollbar flex min-w-0 flex-1 items-center justify-end gap-2 overflow-x-auto">
                <button
                  type="button"
                  onClick={(e) => openComposer("issue", captureGlassModalOrigin(e))}
                  className="h-8 shrink-0 whitespace-nowrap rounded-[8px] border px-3 text-[12px] font-bold text-white transition hover:brightness-95"
                  style={{ backgroundImage: "var(--danger-gradient)", borderColor: "var(--danger-strong)" }}
                >
                  Report Issue
                </button>
                <button
                  type="button"
                  onClick={(e) => openComposer("feature", captureGlassModalOrigin(e))}
                  className="h-8 shrink-0 whitespace-nowrap rounded-[8px] border px-3 text-[12px] font-bold text-white transition hover:brightness-95"
                  style={{ backgroundImage: "var(--success-gradient)", borderColor: "var(--success-strong)" }}
                >
                  Suggest Feature
                </button>
              </div>
            )}
            {isCompactChangelogViewport && (
              <button
                type="button"
                onClick={() => router.back()}
                className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-[10px] border hover:brightness-95"
                style={{ backgroundImage: "var(--brand-gradient)", borderColor: "var(--brand-strong)" }}
                aria-label="Back"
              >
                <ChevronLeft size={18} color="#ffffff" strokeWidth={2.5} />
              </button>
            )}
            {/* Desktop only — same button group as the mobile bar below, just inline on this one
                combined row instead of a second row, since desktop has the width for both. */}
            {!isCompactChangelogViewport && (
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
                    style={{ backgroundImage: "var(--success-gradient)", borderColor: "var(--success-strong)" }}
                  >
                    Suggest Feature
                  </button>
                </div>
              </div>
            )}
          </div>
          {isCompactChangelogViewport && (
            <div
              ref={pageHeaderRef}
              className="glass-page-header sticky top-[56px] z-[94] flex flex-wrap items-center gap-3 border-t px-4 py-2.5 md:px-5"
              style={{ borderColor: "var(--glass-border)" }}
            >
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
            </div>
          )}
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
                top: DESKTOP_TAB_BAR_HEIGHT + HEADER_HEIGHT + buttonsBarHeight,
                height: `calc(100svh - ${DESKTOP_TAB_BAR_HEIGHT + HEADER_HEIGHT + buttonsBarHeight}px)`,
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

          {/* Mobile-only version list drawer — same content as the desktop <aside> above, but its
              own separate DOM/refs (not sharing versionListRef/versionItemRefs, since the desktop
              <aside> stays mounted, just CSS-hidden, at mobile widths too — sharing refs between
              two simultaneously-mounted elements would have them fight over the same ref) and no
              sliding highlight bar, just a plain active-row tint. Closes itself after a version is
              picked, same as tapping a version used to just scroll to it on desktop. */}
          {isCompactChangelogViewport && !!entries.length && mobileVersionsSwipe.shouldRender && (
            <div className="fixed inset-0 z-[120]">
              <button
                type="button"
                data-swipe-backdrop="true"
                className="absolute inset-0 bg-[rgba(15,23,42,0.45)]"
                onClick={() => setIsMobileVersionsPanelOpen(false)}
                aria-label="Close versions backdrop"
              />
              <div
                ref={mobileVersionsPanelRef}
                {...mobileVersionsSwipe.touchHandlers}
                className="hide-scrollbar absolute inset-y-0 left-0 z-[1] flex h-full w-[85%] max-w-[340px] flex-col gap-0.5 overflow-y-auto p-2"
                style={{ backgroundColor: "var(--bg-app)", paddingTop: 56 + 12, boxShadow: "var(--shadow-glass)" }}
              >
                <p className="mb-1 px-1 text-[11px] font-bold uppercase tracking-[0.6px]" style={{ color: "var(--text-muted)" }}>
                  Versions
                </p>
                {entries.map((entry) => {
                  const isActive = activeVersion === entry.version;
                  return (
                    <button
                      key={`mobile_side_${entry.version}_${entry.capturedAtIso}`}
                      type="button"
                      onClick={() => {
                        openVersionFromSidebar(entry.version);
                        setIsMobileVersionsPanelOpen(false);
                      }}
                      className="flex h-9 w-full shrink-0 items-center justify-between gap-2 rounded-[8px] px-3 text-left text-[13px] font-bold transition-colors"
                      style={{
                        backgroundColor: isActive ? "var(--brand-soft)" : "transparent",
                        color: isActive ? "var(--brand)" : "var(--text-main)",
                      }}
                    >
                      <span className="truncate">{entry.version || "Unknown"}</span>
                      <span className="shrink-0 text-[11px] font-semibold" style={{ color: isActive ? "var(--brand)" : "var(--text-muted)" }}>
                        {formatUpdateDate(entry.capturedAtIso)}
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>
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
