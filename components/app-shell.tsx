"use client";

import { setActiveCompanyFormats } from "@/lib/company-formats";
import { GlobalSearch } from "@/components/global-search";
import { ViewAsRoleBanner } from "@/components/view-as-role-banner";
import { useViewAsRole } from "@/lib/view-as-role";
import { GlassModalHeader } from "@/components/glass-modal-header";
import { glassShineStyle } from "@/lib/glass-shine";
import { Fragment, useEffect, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type TouchEvent as ReactTouchEvent } from "react";
import { createPortal } from "react-dom";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { doc, serverTimestamp, setDoc } from "@/lib/firestore-client";
import { getDownloadURL, ref as storageRef, uploadBytes } from "firebase/storage";
import {
  Archive,
  CalendarDays,
  ChartColumn,
  Check,
  ChevronDown,
  ChevronLeft,
  Download,
  FileText,
  FolderPlus,
  GripVertical,
  Hammer,
  ImagePlus,
  Images,
  Inbox,
  LayoutDashboard,
  LogOut,
  Mail,
  MapPin,
  Pencil,
  Phone,
  Plus,
  RefreshCw,
  Save,
  Search,
  Settings,
  Sparkles,
  Tag,
  UserRound,
  Users,
  X,
} from "lucide-react";
import { useAuth } from "@/lib/auth-context";
import { NEW_PROJECT_EVENT, normalizeSmallJobStatuses, SMALL_JOB_COLOR } from "@/lib/small-jobs";
import { modalCloseButtonClass } from "@/components/settings-ui";
import { DownloadsModal } from "@/components/downloads-modal";
import { authorizedFetch } from "@/lib/api-fetch";
import { useAppTabs } from "@/lib/app-tabs-context";
import { setCompletionActor } from "@/lib/completed-projects";
import { MOBILE_TOP_BAR_UPDATED_EVENT, readMobileTopBarEnabled, readSidebarResizeLockEnabled, SIDEBAR_RESIZE_LOCK_UPDATED_EVENT } from "@/lib/ui-preferences";
// Side-effect only — registers the `beforeinstallprompt` listener as early as possible (this
// component mounts on every staff page), since the browser only ever delivers that event once and
// User Settings' own "Download App" button needs it captured long before someone visits that page.
import "@/lib/pwa-install";
import {
  archiveDueCompletedProjects,
  cleanupCompletedReportsForNewVersion,
  fetchAppChangelogHistory,
  fetchCompanyDoc,
  fetchCompanyMembers,
  fetchUserUpdateNoticeSeenVersions,
  hasUnsentCutlistChanges,
  isLikelyOffline,
  markUserUpdateNoticeSeen,
  resyncCompanyProjectTagUsage,
  sendOfflineCutlistChanges,
    syncCompanyClientProfileFromProject,
    upsertCompanyClientProfileOnProjectCreate,
    fetchCompanyClients,
    notifyColumnAutomationMove,
    type CompanyClientRow,
  } from "@/lib/firestore-data";
import { db, hasFirebaseConfig, storage } from "@/lib/firebase";
import { cn } from "@/lib/utils";
import { QuoteDocumentEditor } from "@/components/quote-document-editor";
import { fetchCompanyAccess, fetchPrimaryMembership } from "@/lib/membership";
import { getFirebaseStorageQuotaExceededMessage, isFirebaseStorageQuotaExceeded } from "@/lib/firebase-storage-errors";
import { applyThemeMode, readThemeMode, THEME_MODE_UPDATED_EVENT, type ThemeMode } from "@/lib/theme-mode";
import type { LeadCustomFieldSnapshot, ProjectImageItem } from "@/lib/types";
import { normalizeChangelogHistory, parseUpdateNotesText, WHATS_NEW_URL_PARAM, type WhatsNewHighlight } from "@/lib/update-notes-utils";
import {
  APP_VERSION_PUBLISHED_EVENT,
  APP_VERSION_SCHEDULE_CHANGED_EVENT,
  fetchPublishStatus,
  OPEN_WHATS_NEW_DRAFT_EVENT,
  OPEN_WHATS_NEW_EVENT,
  useReleaseCountdown,
  WhatsNewSheet,
  type WaitingPublish,
} from "@/components/whats-new-sheet";
import { devButtonClass, useDevModeOn, useIsDevUser } from "@/lib/dev-mode";
import {
  LEAD_PROJECT_CREATED_EVENT,
  OPEN_NEW_PROJECT_EVENT,
  type NewProjectPrefillPayload,
} from "@/lib/new-project-bridge";
import { captureGlassModalOrigin, useGlassModalPopOrigin, type GlassModalOrigin } from "@/lib/use-glass-modal-pop-origin";
import { useSwipeToClose } from "@/lib/use-swipe-to-close";
import { usePublishKeyboardInsetVars } from "@/lib/use-keyboard-inset";
import { swallowNextClick } from "@/lib/swallow-dismiss-click";
import { isAnyPopupOpen } from "@/components/scroll-lock-watcher";
import { USER_COLOR_UPDATED_EVENT, type UserColorUpdatedDetail } from "@/lib/user-color-sync";
import { SidebarUserSettingsPanel } from "@/components/sidebar-user-settings-panel";
import { usePushNotificationsOnAppOpen } from "@/lib/push-client";
import { VerifyAccountModal } from "@/components/verify-account-modal";
import { GlassScrollbarThumb } from "@/components/glass-scrollbar-thumb";
import { isPreviewMode } from "@/lib/preview-mode";
import { flatPageBg, isFlatPage, startsUnderTopBar } from "@/lib/flat-page";
import { useUndo } from "@/components/undo-bar";
const ACTIVE_COMPANY_STORAGE_KEY = "cutsmart_active_company_id";
// The sidebar's Downloads button and the gap below it, above the account row.
const SIDEBAR_DOWNLOADS_ROW_HEIGHT = 46;
const COMPANY_BRANDING_CACHE_KEY_PREFIX = "cutsmart_company_branding_";
const COMPANY_ACCESS_CACHE_KEY_PREFIX = "cutsmart_company_access_";
const UPDATE_NOTICE_SEEN_STORAGE_KEY_PREFIX = "cutsmart_update_notice_seen_";
const ZAPIER_LEADS_VISIBILITY_UPDATED_EVENT = "cutsmart:zapier-leads-visibility-updated";
const COMPANY_ACCESS_CACHE_TTL_MS = 5 * 60 * 1000;
const SIDEBAR_FULL_WIDTH_PX = 240;
const SIDEBAR_ICON_ONLY_WIDTH_PX = 72;
const SIDEBAR_WIDTH_STORAGE_KEY_PREFIX = "cutsmart_sidebar_width_";
// Only ever two valid widths — full or icon-only, nothing in between — so any stored/dragged
// value snaps to whichever of the two it's closest to.
const SIDEBAR_WIDTH_MIDPOINT_PX = (SIDEBAR_FULL_WIDTH_PX + SIDEBAR_ICON_ONLY_WIDTH_PX) / 2;
function snapSidebarWidth(value: number) {
  return value >= SIDEBAR_WIDTH_MIDPOINT_PX ? SIDEBAR_FULL_WIDTH_PX : SIDEBAR_ICON_ONLY_WIDTH_PX;
}

type CompanyBrandingCache = {
  themeColor: string;
  logoPath: string;
  name: string;
};

type CompanyAccessCache = {
  role: string;
  permissionKeys: string[];
  isZapierLeadsEnabled: boolean;
  cachedAt: number;
};

type GapAllowancesSettings = {
  baseBelowBenchToTopOfDoorDrawer: string;
  baseHorizontalGapNormalHandles: string;
  baseHorizontalGapWrapOverHandles: string;
  baseVerticalGapDoorsPanels: string;
  tallTopOfDoorToTopWithScribers: string;
  tallTopOfDoorToTopNoScribers: string;
  tallVerticalGapDoorsPanels: string;
};

const brandingMemoryCacheByCompany: Record<string, CompanyBrandingCache> = {};
const companyAccessMemoryCacheByKey: Record<string, CompanyAccessCache> = {};

function normalizeGapAllowancesSettings(raw: unknown): GapAllowancesSettings {
  const row = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  return {
    baseBelowBenchToTopOfDoorDrawer: String(row.baseBelowBenchToTopOfDoorDrawer ?? "").trim(),
    baseHorizontalGapNormalHandles: String(row.baseHorizontalGapNormalHandles ?? "").trim(),
    baseHorizontalGapWrapOverHandles: String(row.baseHorizontalGapWrapOverHandles ?? "").trim(),
    baseVerticalGapDoorsPanels: String(row.baseVerticalGapDoorsPanels ?? "").trim(),
    tallTopOfDoorToTopWithScribers: String(row.tallTopOfDoorToTopWithScribers ?? "").trim(),
    tallTopOfDoorToTopNoScribers: String(row.tallTopOfDoorToTopNoScribers ?? "").trim(),
    tallVerticalGapDoorsPanels: String(row.tallVerticalGapDoorsPanels ?? "").trim(),
  };
}

// The sidebar's pages, in its sections' order — each section's name heads its pages (visibleNavGroups below), so a
// section none of whose pages someone can see doesn't show at all.
const topNav = [
  { href: "/dashboard", label: "Dashboard", icon: LayoutDashboard, group: "Production" },
  // Quick jobs and small fixes, without a whole project each (lib/small-jobs.ts) — for whoever can see the Dashboard.
  { href: "/small-jobs", label: "Small Jobs", icon: Hammer, group: "Production" },
  { href: "/leads", label: "Leads", icon: Inbox, group: "Sales" },
  // The company's figures — only for a role holding company.report (see canAccessReports).
  { href: "/reports", label: "Reports", icon: ChartColumn, group: "Sales" },
  { href: "/contacts", label: "Contacts", icon: Users, group: "Company" },
  { href: "/calendar", label: "Calendar", icon: CalendarDays, group: "Company" },
  // Company Wrapped (/wrapped) is hidden from the sidebar for now — the page is still there, and its year's stats keep
  // being tallied. To bring it back: { href: "/wrapped", label: "Company Wrapped", icon: PartyPopper, group: "Company" }
  // here (and PartyPopper back in the lucide-react import above).
  // Archived leads, projects and contacts — what used to be Recently Deleted (/recently-deleted now
  // redirects here). Every Delete/Archive button in the app files things here.
  { href: "/archived", label: "Archive", icon: Archive, group: "Company" },
  { href: "/company-settings", label: "Company Settings", icon: Settings, group: "Company" },
  { href: "/changelog", label: "Changelog", icon: Search, group: "Application" },
];

// The sidebar's sections someone's folded away (by name) — remembered for each person on this device, so the sidebar
// comes back the same after a reload.
const foldedNavGroupsStorageKey = (uid: string) => `cutsmart.web.sidebar.sections.${uid}`;
function readFoldedNavGroups(storageKey: string): Record<string, boolean> {
  if (!storageKey || typeof window === "undefined") return {};
  try {
    const parsed = JSON.parse(window.localStorage.getItem(storageKey) || "{}") as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    return Object.fromEntries(Object.entries(parsed as Record<string, unknown>).filter(([, on]) => on === true).map(([name]) => [name, true]));
  } catch {
    return {};
  }
}
// A menu in New Project that floats over it (fixed, at the page — not clipped by the pop-up's scrolling body, nor cut off
// by its footer): at its trigger's left and at least its width, below it — or above it, with more room there — and no
// taller than the room it's in.
type FloatingMenuPos = { left: number; width: number; top?: number; bottom?: number; maxHeight: number };
function floatingMenuPosFor(anchor: HTMLElement, wantedHeight: number, minWidth = 0): FloatingMenuPos {
  const rect = anchor.getBoundingClientRect();
  const width = Math.min(Math.max(rect.width, minWidth), window.innerWidth - 16);
  const left = Math.min(Math.max(8, rect.left), window.innerWidth - width - 8);
  const roomBelow = window.innerHeight - rect.bottom - 12;
  const roomAbove = rect.top - 12;
  if (roomBelow >= wantedHeight || roomBelow >= roomAbove) return { left, width, top: rect.bottom + 4, maxHeight: Math.max(0, roomBelow) };
  return { left, width, bottom: window.innerHeight - rect.top + 4, maxHeight: Math.max(0, roomAbove) };
}
// New Project's text boxes: never the browser's own autofill (saved names, emails, phone numbers, addresses — its list
// would cover the pop-up's own, the existing contacts). Chrome ignores autocomplete="off" for some of those; a value it
// doesn't recognise turns them off (as settings-ui's measurement boxes) — and password managers leave them alone too.
const NEW_PROJECT_NO_AUTOFILL = {
  autoComplete: "cs-new-project",
  "data-1p-ignore": "",
  "data-lpignore": "true",
  "data-bwignore": "true",
  "data-form-type": "other",
};
const FLOATING_MENU_STYLE = {
  borderColor: "var(--glass-border)",
  backgroundColor: "var(--glass-modal-bg)",
  backdropFilter: "blur(12px) saturate(220%)",
  WebkitBackdropFilter: "blur(12px) saturate(220%)",
  // Over the pop-up (z-9000).
  zIndex: 9600,
};
// A section folding away or opening out, and the page highlight's own slide (and fade, for a folded section's page).
const NAV_GROUP_FOLD_MS = 260;
const NAV_GROUP_FOLD_TRANSITION = `grid-template-rows ${NAV_GROUP_FOLD_MS}ms cubic-bezier(0.22, 1, 0.36, 1)`;
const NAV_HIGHLIGHT_TRANSITION = "top 260ms cubic-bezier(0.22, 1, 0.36, 1), height 260ms cubic-bezier(0.22, 1, 0.36, 1), opacity 200ms ease";

function hasPermissionKey(permissionKeys: string[] | undefined, key: string): boolean {
  const target = String(key || "").trim().toLowerCase();
  if (!target) {
    return false;
  }
  return (permissionKeys ?? []).some((item) => {
    const normalized = String(item || "").trim().toLowerCase();
    if (normalized === "company.*" || normalized === target) {
      return true;
    }
    if (normalized === "leads.*" && (target === "leads.view" || target === "leads.view.others")) {
      return true;
    }
    return false;
  });
}

function normalizeRoleKey(value: unknown): string {
  return String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "_");
}

function extractRolePermissionKeys(
  companyDoc: Record<string, unknown> | null | undefined,
  roleCandidates: Array<unknown>,
): string[] {
  const roles = Array.isArray(companyDoc?.roles) ? (companyDoc?.roles as Array<Record<string, unknown>>) : [];
  if (!roles.length) return [];
  const wanted = new Set(roleCandidates.map((value) => normalizeRoleKey(value)).filter(Boolean));
  if (!wanted.size) return [];
  const out = new Set<string>();
  for (const role of roles) {
    const roleKey = normalizeRoleKey(role.id ?? role.name);
    if (!roleKey || !wanted.has(roleKey)) continue;
    const permissions =
      role.permissions && typeof role.permissions === "object" && !Array.isArray(role.permissions)
        ? (role.permissions as Record<string, unknown>)
        : {};
    for (const [key, value] of Object.entries(permissions)) {
      if (value === true) {
        out.add(String(key || "").trim());
      }
    }
  }
  return Array.from(out).filter(Boolean);
}

function rolePriority(role: string): number {
  const normalized = String(role || "").trim().toLowerCase();
  if (normalized === "owner") return 3;
  if (normalized === "admin") return 2;
  return 1;
}

function mergeRoleValue(primary: string, fallback: string): string {
  const first = String(primary || "").trim().toLowerCase();
  const second = String(fallback || "").trim().toLowerCase();
  if (!first) return second;
  if (!second) return first;
  return rolePriority(first) >= rolePriority(second) ? first : second;
}

function mergePermissionValues(primary: string[] | undefined, fallback: string[] | undefined): string[] {
  return Array.from(
    new Set([
      ...(primary ?? []).map((item) => String(item || "").trim()).filter(Boolean),
      ...(fallback ?? []).map((item) => String(item || "").trim()).filter(Boolean),
    ]),
  );
}

function initials(name: string) {
  const parts = String(name || "")
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  if (!parts.length) return "U";
  return parts
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase() ?? "")
    .join("");
}

function createProjectId() {
  const rand = Math.random().toString(36).slice(2, 8);
  return `prj_${Date.now().toString(36)}_${rand}`;
}

function formatMobileLikeDesktop(input: string) {
  const digits = String(input || "").replace(/\D/g, "").slice(0, 32);
  const a = digits.slice(0, 3);
  const b = digits.slice(3, 6);
  const c = digits.slice(6);
  if (!a) return "";
  if (!b) return a;
  if (!c) return `${a} ${b}`;
  return `${a} ${b} ${c}`;
}

function normalizeTagValue(raw: string) {
  return String(raw || "").replace(/,/g, " ").replace(/\s+/g, " ").trim();
}

function buildCompanyAccessCacheKey(companyId: string, uid: string) {
  const cleanCompanyId = String(companyId || "").trim();
  const cleanUid = String(uid || "").trim();
  if (!cleanCompanyId || !cleanUid) return "";
  return `${cleanCompanyId}::${cleanUid}`;
}

function readCompanyAccessCache(cacheKey: string): CompanyAccessCache | null {
  const cleanKey = String(cacheKey || "").trim();
  if (!cleanKey) return null;
  const memoryValue = companyAccessMemoryCacheByKey[cleanKey];
  if (memoryValue && Date.now() - Number(memoryValue.cachedAt || 0) <= COMPANY_ACCESS_CACHE_TTL_MS) {
    return memoryValue;
  }
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(`${COMPANY_ACCESS_CACHE_KEY_PREFIX}${cleanKey}`);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const cached: CompanyAccessCache = {
      role: String(parsed.role || "").trim(),
      permissionKeys: Array.isArray(parsed.permissionKeys)
        ? parsed.permissionKeys.map((item) => String(item || "").trim()).filter(Boolean)
        : [],
      isZapierLeadsEnabled: Boolean(parsed.isZapierLeadsEnabled),
      cachedAt: Number(parsed.cachedAt || 0),
    };
    if (!cached.cachedAt || Date.now() - cached.cachedAt > COMPANY_ACCESS_CACHE_TTL_MS) {
      return null;
    }
    companyAccessMemoryCacheByKey[cleanKey] = cached;
    return cached;
  } catch {
    return null;
  }
}

function writeCompanyAccessCache(cacheKey: string, payload: Omit<CompanyAccessCache, "cachedAt">) {
  const cleanKey = String(cacheKey || "").trim();
  if (!cleanKey) return;
  const cached: CompanyAccessCache = {
    ...payload,
    cachedAt: Date.now(),
  };
  companyAccessMemoryCacheByKey[cleanKey] = cached;
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(`${COMPANY_ACCESS_CACHE_KEY_PREFIX}${cleanKey}`, JSON.stringify(cached));
  } catch {
    // ignore storage write issues
  }
}

function escapeHtml(value: string): string {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function notesToDisplayHtml(value: unknown): string {
  const raw = String(value ?? "");
  if (!raw.trim()) return "";
  const looksLikeHtml = /<\/?[a-z][\s\S]*>/i.test(raw);
  if (looksLikeHtml) return raw;
  return escapeHtml(raw).replace(/\n/g, "<br />");
}

function notesHtmlIsEmpty(value: string): boolean {
  const plain = String(value || "")
    .replace(/<br\s*\/?>/gi, "")
    .replace(/&nbsp;/gi, " ")
    .replace(/<[^>]*>/g, "")
    .trim();
  return !plain;
}

type LocalPhoto = { id: string; file: File; previewUrl: string; aspectRatio: number; name: string };
type PrefilledProjectImage = ProjectImageItem & { id: string };
type StaffOption = { uid: string; name: string; email: string; color?: string };
type PreviewRect = { left: number; top: number; width: number; height: number };
type PreviewAnimState = {
  id: string;
  phase: "opening" | "open" | "closing";
  from: PreviewRect;
  to: PreviewRect;
};
export function AppShell({
  children,
  hideSidebar = false,
}: {
  children: React.ReactNode;
  hideSidebar?: boolean;
}) {
  const pathname = usePathname();
  const router = useRouter();
  const { user, logout, isDemoMode, membershipStatus } = useAuth();
  const {
    chromeHidden,
    ownsMobileScroll,
    isSheetZoomedAwayFromEdgeRef,
    fillMainViewport,
    reduceMainTopPadding,
    mobileNavOpen,
    setMobileNavOpen,
    notifOpen,
    setNotifOpen,
    saveAndBackHandler,
  } = useAppTabs();
  const effectiveHideSidebar = hideSidebar || chromeHidden;
  const [showNewProject, setShowNewProject] = useState(false);
  const [newProjectOrigin, setNewProjectOrigin] = useState<GlassModalOrigin>(null);
  // New Small Job (Small Jobs' button — lib/small-jobs.ts): the same pop-up, for a small job — its name a job's, no
  // tags, and it starts in the first small-job status. Back to New Project once it's closed.
  const [newProjectIsSmallJob, setNewProjectIsSmallJob] = useState(false);
  const [defaultSmallJobStatus, setDefaultSmallJobStatus] = useState("Open");
  const [defaultSmallJobStatusColor, setDefaultSmallJobStatusColor] = useState("#16A34A");
  const newProjectPanelRef = useRef<HTMLDivElement | null>(null);
  const newProjectModalOriginElRef = useRef<HTMLElement | null>(null);
  const shouldRenderNewProjectModal = useGlassModalPopOrigin(
    showNewProject,
    newProjectOrigin,
    newProjectPanelRef,
    undefined,
    newProjectModalOriginElRef,
  );
  const [showLogoutConfirm, setShowLogoutConfirm] = useState(false);
  // The sidebar's Downloads (above the account row): its pop-up, and the company it's for (read as it opens).
  const [showDownloads, setShowDownloads] = useState(false);
  const [downloadsOrigin, setDownloadsOrigin] = useState<GlassModalOrigin>(null);
  const downloadsOriginElRef = useRef<HTMLElement | null>(null);
  const [downloadsCompanyId, setDownloadsCompanyId] = useState("");
  const [logoutConfirmOrigin, setLogoutConfirmOrigin] = useState<GlassModalOrigin>(null);
  const logoutConfirmPanelRef = useRef<HTMLDivElement | null>(null);
  // Prototype site for the "push" nudge on the origin element itself (see
  // applyOriginPushNudge's own comment in use-glass-modal-pop-origin.ts) — picked as the first
  // rollout target because it's the simplest possible case: a single, always-mounted nav/menu
  // button, never inside a list, never at risk of unmounting mid-animation. Set fresh at click
  // time by both onRequestLogout call sites below (desktop/mobile menu variants), same as
  // logoutConfirmOrigin's own rect.
  const logoutConfirmOriginElRef = useRef<HTMLElement | null>(null);
  const shouldRenderLogoutConfirmModal = useGlassModalPopOrigin(
    showLogoutConfirm,
    logoutConfirmOrigin,
    logoutConfirmPanelRef,
    undefined,
    logoutConfirmOriginElRef,
  );
  const [isAutoVerifyModalOpen, setIsAutoVerifyModalOpen] = useState(false);
  // Prompts once per freshly-signed-in session (covers both "just registered" and "just logged
  // into an account that's still unverified") — keyed off uid so it never re-fires just because
  // `user.verified` itself recomputes (e.g. while the profile fetch is still in flight) or because
  // of unrelated re-renders while the user keeps browsing already-unverified in the same session.
  const autoVerifyPromptedUidRef = useRef<string | null>(null);
  useEffect(() => {
    const uid = user?.uid || null;
    if (!uid) {
      autoVerifyPromptedUidRef.current = null;
      return;
    }
    // membershipStatus === "ready" is required alongside verified === false — a slow/failed
    // membership load leaves user.verified as an UNKNOWN (not a confirmed false), and without
    // this guard an already-verified user hitting that fallback got this popup opened purely
    // from fetch latency, not real account state (the reported "phantom verification prompt").
    if (membershipStatus === "ready" && user?.verified === false && autoVerifyPromptedUidRef.current !== uid) {
      autoVerifyPromptedUidRef.current = uid;
      setIsAutoVerifyModalOpen(true);
    }
  }, [membershipStatus, user?.uid, user?.verified]);
  // App-wide: dragging (kanban cards, custom scrollbars, resize handles, click-drag-scrolling a
  // panel, etc.) shouldn't ever leave a trail of accidentally-highlighted text behind it — a
  // side effect of the browser's own default text-selection behavior kicking in on any mouse/touch
  // move while the button is down, regardless of what's actually being dragged. When a selection
  // tries to start during a press that began on a drag source, it's cancelled (selectstart).
  //
  // Only for presses that START on a real drag source, though — isDragSource below — so ordinary
  // click-and-drag text selection over normal content still works everywhere else.
  //
  // This used to put a class on <body> for every press on a drag source (and work out "is this a
  // drag source" — up to 25 computed-style reads — on every single press anywhere). The class
  // restyled the whole page on the way down and again on the way up, which made clicks on tabs,
  // cards and scrollbars hitch. Now nothing changes on the page, and the check only runs when a
  // selection actually tries to start.
  //
  // isDragSource recognizes a drag source via signals this codebase's own drag interactions
  // already carry, rather than requiring every one of them to be individually re-tagged: the
  // native HTML5 draggable="true" attribute (kanban cards, sales items, etc.), or a grab/grabbing/
  // resize cursor (custom scrollbar thumbs, the sidebar's own resize handle, click-drag-scroll
  // strips) — ordinary text/content never carries either of these.
  useEffect(() => {
    const isTextEditable = (target: EventTarget | null) => {
      const node = target instanceof HTMLElement ? target : null;
      return Boolean(node?.closest('input, textarea, [contenteditable="true"], [contenteditable=""]'));
    };
    const DRAG_CURSORS = new Set(["grab", "grabbing", "ns-resize", "ew-resize", "col-resize", "row-resize"]);
    const isDragSource = (target: EventTarget | null) => {
      let node = target instanceof HTMLElement ? target : null;
      if (!node) return false;
      if (node.closest('[draggable="true"]')) return true;
      // Walked manually (no native "closest computed style" API) — capped so a pathologically
      // deep tree can't turn every pointerdown into an unbounded walk to the document root.
      for (let depth = 0; node && depth < 25; depth += 1, node = node.parentElement) {
        if (DRAG_CURSORS.has(window.getComputedStyle(node).cursor)) return true;
      }
      return false;
    };
    // Where the current press started (null while no button is down), and whether that's a drag
    // source — worked out the first time a selection tries to start during the press.
    let pressTarget: EventTarget | null = null;
    let pressIsDrag: boolean | null = null;
    const onPointerDown = (e: PointerEvent) => {
      pressTarget = e.target;
      pressIsDrag = null;
    };
    const onPointerUp = () => {
      pressTarget = null;
      pressIsDrag = null;
    };
    const onSelectStart = (e: Event) => {
      if (!pressTarget || isTextEditable(pressTarget)) return;
      if (pressIsDrag === null) pressIsDrag = isDragSource(pressTarget);
      if (pressIsDrag) e.preventDefault();
    };
    document.addEventListener("pointerdown", onPointerDown, true);
    document.addEventListener("selectstart", onSelectStart, true);
    window.addEventListener("pointerup", onPointerUp, true);
    window.addEventListener("pointercancel", onPointerUp, true);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown, true);
      document.removeEventListener("selectstart", onSelectStart, true);
      window.removeEventListener("pointerup", onPointerUp, true);
      window.removeEventListener("pointercancel", onPointerUp, true);
    };
  }, []);
  // Publishes the on-screen keyboard's current height as a CSS variable every .glass-modal-panel
  // reads (see app/globals.css) to keep itself centered above the keyboard instead of the full
  // screen — mounted once here (AppShell wraps every staff page) rather than per-modal, since
  // every modal already shares that one class.
  usePublishKeyboardInsetVars();
  // Phone/desktop notifications (lib/push-client.ts): keep this device current, clear the icon badge.
  usePushNotificationsOnAppOpen(user?.uid);
  // Cutlist changes made offline and kept on this device (lib/firestore-data.ts): sent as the app opens, and whenever
  // the browser's back online — whichever page is open.
  useEffect(() => {
    if (!user?.uid) return;
    const send = () => void sendOfflineCutlistChanges();
    send();
    window.addEventListener("online", send);
    return () => window.removeEventListener("online", send);
  }, [user?.uid]);
  // Closing or reloading the app while cutlist changes are on their way to the database: the browser asks first — left,
  // they'd wait on this device till it's next opened. Not while offline: they're kept here till then anyway, and staying
  // wouldn't send them.
  useEffect(() => {
    const onBeforeUnload = (event: BeforeUnloadEvent) => {
      if (isLikelyOffline() || !hasUnsentCutlistChanges()) return;
      event.preventDefault();
      // (Older browsers ask only with this set.)
      event.returnValue = true;
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, []);
  const [projectName, setProjectName] = useState("");
  const [clientFirstName, setClientFirstName] = useState("");
  const [clientLastName, setClientLastName] = useState("");
  const [clientPhone, setClientPhone] = useState("");
  const [clientEmail, setClientEmail] = useState("");
  const [projectAddress, setProjectAddress] = useState("");
  const [projectNotes, setProjectNotes] = useState("");
  const [isNewProjectNotesEditing, setIsNewProjectNotesEditing] = useState(false);
  const [newProjectNotesToolbarHost, setNewProjectNotesToolbarHost] = useState<HTMLDivElement | null>(null);
  const [tagInput, setTagInput] = useState("");
  const [tags, setTags] = useState<string[]>([]);
  const [isTagInputOpen, setIsTagInputOpen] = useState(false);
  const [showTagSuggestions, setShowTagSuggestions] = useState(false);
  const [photos, setPhotos] = useState<LocalPhoto[]>([]);
  const [prefilledProjectImages, setPrefilledProjectImages] = useState<PrefilledProjectImage[]>([]);
  // The Undo bar, after a tag or photo's taken out of New Project (removeTag, removePhoto…). Each filling-in of the form
  // is counted (projectFormRunRef — up one each time it's cleared or filled afresh): Undo pressed once that form's gone
  // has nothing to put it back into, so it leaves the next one be.
  const offerUndo = useUndo();
  const projectFormRunRef = useRef(0);
  const [editingProjectPhotoNameKey, setEditingProjectPhotoNameKey] = useState("");
  const [projectPhotoNameDraft, setProjectPhotoNameDraft] = useState("");
  const [sourceLeadId, setSourceLeadId] = useState("");
  const [sourceLeadCompanyId, setSourceLeadCompanyId] = useState("");
  // Lead custom fields not already mapped into one of the fixed fields above — carried through so
  // they're still visible on the project after conversion (see lib/new-project-bridge.ts).
  const [prefilledLeadCustomFields, setPrefilledLeadCustomFields] = useState<LeadCustomFieldSnapshot[]>([]);
  // Made from a lead: its notes, for the Notes box's "Import from Notes" (a bullet each) — and whether they've been added.
  const [prefilledLeadNotes, setPrefilledLeadNotes] = useState<string[]>([]);
  const [leadNotesImported, setLeadNotesImported] = useState(false);
  const [previewPhotoId, setPreviewPhotoId] = useState("");
  const [previewAnim, setPreviewAnim] = useState<PreviewAnimState | null>(null);
  const [previewBackdropOpacity, setPreviewBackdropOpacity] = useState(0);
  const [previewClosePopped, setPreviewClosePopped] = useState(false);
  const [staffOptions, setStaffOptions] = useState<StaffOption[]>([]);
  const [assigneeUid, setAssigneeUid] = useState("");
  const [assigneeSearch, setAssigneeSearch] = useState("");
  const [assigneeMenuOpen, setAssigneeMenuOpen] = useState(false);
  const [projectFormError, setProjectFormError] = useState("");
  const [creatingProject, setCreatingProject] = useState(false);
  // New Project's field left empty that it can't do without (its name, its client's) — outlined in red, said under it,
  // and cleared as it's filled in. And photos being dragged over its Photos.
  const [newProjectInvalidField, setNewProjectInvalidField] = useState<"" | "name" | "client">("");
  const [isNewProjectPhotoDragOver, setIsNewProjectPhotoDragOver] = useState(false);
  const newProjectNameInputRef = useRef<HTMLInputElement | null>(null);
  const newProjectClientInputRef = useRef<HTMLInputElement | null>(null);
  // Its client: as their name, phone or email's typed, the contacts this person can see (as on Contacts — read the first
  // time one of those is gone into) that it matches, floating under that field — one picked fills them in, and the new
  // project's linked to that contact card. Which field they're under (none: closed), where, and the one ready for Enter.
  const [newProjectContacts, setNewProjectContacts] = useState<CompanyClientRow[] | null>(null);
  const newProjectContactsLoadingRef = useRef(false);
  const [newProjectContact, setNewProjectContact] = useState<CompanyClientRow | null>(null);
  const [contactSuggestField, setContactSuggestField] = useState<"" | "name" | "phone" | "email">("");
  const [contactSuggestPos, setContactSuggestPos] = useState<FloatingMenuPos | null>(null);
  const [contactSuggestIndex, setContactSuggestIndex] = useState(0);
  const contactSuggestRef = useRef<HTMLDivElement | null>(null);
  const newProjectClientNameRowRef = useRef<HTMLDivElement | null>(null);
  // Assign to's list: floating at its field (FloatingMenuPos).
  const [assigneeMenuPos, setAssigneeMenuPos] = useState<FloatingMenuPos | null>(null);
  const assigneeMenuRef = useRef<HTMLDivElement | null>(null);
  // The company's contact categories' colours (by name) — a contact's badge, as on Contacts.
  const [contactCategoryColors, setContactCategoryColors] = useState<Record<string, string>>({});
  const [navHighlightRect, setNavHighlightRect] = useState<{ top: number; height: number; folded: boolean } | null>(null);
  const navHighlightRef = useRef<HTMLDivElement | null>(null);
  const navListRef = useRef<HTMLDivElement | null>(null);
  // The phone's menu: its list, and — while a section folds or opens (toggleNavGroup) — which, and where each of the
  // list's rows was just before, to slide them from there.
  const mobileNavListRef = useRef<HTMLDivElement | null>(null);
  const mobileNavFoldRef = useRef<{ group: string; opening: boolean; rects: Map<HTMLElement, DOMRect> } | null>(null);
  // The sidebar's sections folded away (their headings' arrows), as each person left them (readFoldedNavGroups) —
  // straight from what's saved until they fold or open one here.
  const foldedNavGroupsKey = user?.uid ? foldedNavGroupsStorageKey(user.uid) : "";
  const savedFoldedNavGroups = useMemo(() => readFoldedNavGroups(foldedNavGroupsKey), [foldedNavGroupsKey]);
  const [foldedNavGroupsState, setFoldedNavGroupsState] = useState<{ key: string; folded: Record<string, boolean> }>({ key: "", folded: {} });
  const foldedNavGroups = foldedNavGroupsState.key === foldedNavGroupsKey ? foldedNavGroupsState.folded : savedFoldedNavGroups;
  // The section just folded or opened by hand — only it animates (not the ones already folded as the sidebar loads).
  const [animatedNavGroup, setAnimatedNavGroup] = useState("");
  // Bumped once a section's finished folding or opening: the page highlight measured again where its page's settled.
  const [navLayoutTick, setNavLayoutTick] = useState(0);
  const navLinkRefs = useRef<Record<string, HTMLAnchorElement | null>>({});
  const mobileNavPanelRef = useRef<HTMLDivElement | null>(null);
  // The page's own content wrapper (everything below the fixed global top bar).
  const mainPushRef = useRef<HTMLDivElement | null>(null);
  // Phones: the menu (and the notifications panel, in global-app-tabs-bar.tsx) slides in OVER the page
  // as frosted glass — the page stays where it is, blurred behind it — rather than shoving the page
  // over to make room, which is what pushRef did.
  const { shouldRender: shouldRenderMobileNav, touchHandlers: mobileNavTouchHandlers } = useSwipeToClose(
    mobileNavOpen,
    () => setMobileNavOpen(false),
    mobileNavPanelRef,
    { edge: "left" },
  );
  const [isUserSettingsPanelOpen, setIsUserSettingsPanelOpen] = useState(false);
  const desktopAsideRef = useRef<HTMLElement | null>(null);
  // Desktop sidebar collapse/resize — user-draggable between icon-only and its full width,
  // persisted per user so it stays how they left it across refreshes/sessions. Published as the
  // --sidebar-width-px CSS variable (see the effect below) rather than passed as a prop, since two
  // OTHER components whose own layout depends on this width — this page's own content margin
  // further down, and GlobalAppTabsBar's fixed top bar, a separate component entirely — need it
  // too; a CSS variable reaches both without threading it through unrelated component trees.
  const [sidebarWidthPx, setSidebarWidthPx] = useState(SIDEBAR_FULL_WIDTH_PX);
  const [sidebarWidthHydrated, setSidebarWidthHydrated] = useState(false);
  const sidebarResizeDragRef = useRef<{ startX: number; startWidth: number; moved: boolean } | null>(null);
  // User Settings > "Lock Sidebar Resizing" — freezes the divider at whatever width it's
  // currently at; the width itself is untouched here, only the drag/click handlers below stop
  // responding to it.
  const [isSidebarResizeLocked, setIsSidebarResizeLocked] = useState(false);
  useEffect(() => {
    setIsSidebarResizeLocked(readSidebarResizeLockEnabled());
    if (typeof window === "undefined") return;
    const onUpdated = (event: Event) => {
      const detail = (event as CustomEvent<{ enabled: boolean }>).detail;
      setIsSidebarResizeLocked(Boolean(detail?.enabled));
    };
    window.addEventListener(SIDEBAR_RESIZE_LOCK_UPDATED_EVENT, onUpdated as EventListener);
    return () => {
      window.removeEventListener(SIDEBAR_RESIZE_LOCK_UPDATED_EVENT, onUpdated as EventListener);
    };
  }, []);
  useEffect(() => {
    const uid = String(user?.uid || "").trim();
    if (!uid) return;
    try {
      const raw = window.localStorage.getItem(`${SIDEBAR_WIDTH_STORAGE_KEY_PREFIX}${uid}`);
      const parsed = raw ? Number.parseInt(raw, 10) : NaN;
      if (Number.isFinite(parsed)) setSidebarWidthPx(snapSidebarWidth(parsed));
    } catch {
      // ignore — falls back to the default full width
    }
    setSidebarWidthHydrated(true);
  }, [user?.uid]);
  useEffect(() => {
    if (!sidebarWidthHydrated) return;
    const uid = String(user?.uid || "").trim();
    if (!uid) return;
    try {
      window.localStorage.setItem(`${SIDEBAR_WIDTH_STORAGE_KEY_PREFIX}${uid}`, String(sidebarWidthPx));
    } catch {
      // ignore — nothing to persist to
    }
  }, [sidebarWidthHydrated, sidebarWidthPx, user?.uid]);
  useEffect(() => {
    document.documentElement.style.setProperty("--sidebar-width-px", `${sidebarWidthPx}px`);
  }, [sidebarWidthPx]);
  // Window-level pointermove/pointerup listeners registered once (not re-subscribed per drag) —
  // same shape as glass-scrollbar-thumb.tsx's own drag handling, reading the live drag from a ref
  // rather than closing over stale state from whichever render started the drag.
  useEffect(() => {
    const onMove = (e: PointerEvent) => {
      const drag = sidebarResizeDragRef.current;
      if (!drag) return;
      const delta = e.clientX - drag.startX;
      if (Math.abs(delta) > 3) drag.moved = true;
      const raw = Math.max(SIDEBAR_ICON_ONLY_WIDTH_PX, Math.min(SIDEBAR_FULL_WIDTH_PX, drag.startWidth + delta));
      setSidebarWidthPx(snapSidebarWidth(raw));
    };
    const onUp = () => {
      const drag = sidebarResizeDragRef.current;
      sidebarResizeDragRef.current = null;
      // A genuine click (no drag movement) toggles the other way — quick one-click collapse/restore,
      // alongside dragging past the midpoint for the same snap.
      if (drag && !drag.moved) {
        setSidebarWidthPx((current) =>
          current <= SIDEBAR_ICON_ONLY_WIDTH_PX ? SIDEBAR_FULL_WIDTH_PX : SIDEBAR_ICON_ONLY_WIDTH_PX,
        );
      }
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    };
  }, []);
  const isSidebarIconOnly = sidebarWidthPx <= SIDEBAR_ICON_ONLY_WIDTH_PX + 8;
  // Content (name text, nav labels, the bottom bar's own markup) lags behind isSidebarIconOnly
  // on EXPAND only — collapsing narrows content immediately (nothing to wait for, and delaying it
  // would leave wide content overflowing a shrinking box), but expanding widens content only once
  // the aside's own width transition has ACTUALLY finished, so labels/the full user badge don't
  // render into a still-narrow sidebar and flash oversized for a moment before it catches up.
  // Driven by the real "transitionend" event on the aside rather than a setTimeout guessing at the
  // same 200ms duration — a JS timer's clock starts when this effect runs (after React's commit),
  // while the CSS transition's own clock starts when the browser next paints that style, which can
  // lag the timer by a frame or two; that drift was enough for content to still flip a beat before
  // the box actually finished widening. A fallback timer only covers transitionend never firing.
  const [isSidebarIconOnlyContent, setIsSidebarIconOnlyContent] = useState(isSidebarIconOnly);
  useEffect(() => {
    if (isSidebarIconOnly) {
      setIsSidebarIconOnlyContent(true);
      return;
    }
    const asideEl = desktopAsideRef.current;
    const showFullContent = () => setIsSidebarIconOnlyContent(false);
    const onTransitionEnd = (e: TransitionEvent) => {
      if (e.target === asideEl && e.propertyName === "width") showFullContent();
    };
    asideEl?.addEventListener("transitionend", onTransitionEnd);
    const fallbackTimer = window.setTimeout(showFullContent, 260);
    return () => {
      asideEl?.removeEventListener("transitionend", onTransitionEnd);
      window.clearTimeout(fallbackTimer);
    };
  }, [isSidebarIconOnly]);
  const bottomRestContentRef = useRef<HTMLDivElement | null>(null);
  const bottomPanelContentRef = useRef<HTMLDivElement | null>(null);
  const [restContentHeight, setRestContentHeight] = useState<number | null>(null);
  const [panelContentHeight, setPanelContentHeight] = useState<number | null>(null);
  // Same rest-row/panel crossfade as the desktop sidebar's bottom section (shares
  // isUserSettingsPanelOpen — only one of the two is ever actually mounted+visible at a time,
  // gated by the same lg: breakpoint the drawer/sidebar split already uses), but with its own
  // height measurements: the mobile drawer's full-screen flex column lets the surrounding nav
  // list just shrink/scroll naturally via flex-1 as this section grows, so it doesn't need
  // desktop's own slack/push-with-clearance math — plain flex reflow does the same job.
  const mobileBottomRestRef = useRef<HTMLDivElement | null>(null);
  const mobileBottomPanelRef = useRef<HTMLDivElement | null>(null);
  const [mobileRestContentHeight, setMobileRestContentHeight] = useState<number | null>(null);
  const [mobilePanelContentHeight, setMobilePanelContentHeight] = useState<number | null>(null);
  // Depends on shouldRenderMobileNav (not just []) — the drawer (and these refs) only exist in
  // the DOM once it's been opened at least once, so a mount-only effect would find them null on
  // first render and never attach. Same lesson as the project page's header-height ResizeObserver
  // elsewhere in this codebase.
  useLayoutEffect(() => {
    if (typeof ResizeObserver === "undefined") return;
    const restEl = mobileBottomRestRef.current;
    const panelEl = mobileBottomPanelRef.current;
    if (!restEl || !panelEl) return;
    const observer = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const height = Math.ceil(entry.borderBoxSize?.[0]?.blockSize ?? entry.contentRect.height);
        if (entry.target === restEl) setMobileRestContentHeight(height);
        else if (entry.target === panelEl) setMobilePanelContentHeight(height);
      }
    });
    observer.observe(restEl);
    observer.observe(panelEl);
    setMobileRestContentHeight(restEl.getBoundingClientRect().height);
    setMobilePanelContentHeight(panelEl.getBoundingClientRect().height);
    return () => observer.disconnect();
  }, [shouldRenderMobileNav]);
  const [showUpdateNotice, setShowUpdateNotice] = useState(false);
  const [updateNoticeVersion, setUpdateNoticeVersion] = useState("");
  const [updateNoticeText, setUpdateNoticeText] = useState("");
  // The What's New page (components/whats-new-sheet.tsx): the published version's feature cards and date —
  // or, for Dev users, the deployed version that isn't published yet (a draft), to preview and publish.
  const [updateNoticeHighlights, setUpdateNoticeHighlights] = useState<WhatsNewHighlight[]>([]);
  const [updateNoticeDateIso, setUpdateNoticeDateIso] = useState("");
  const [draftUpdate, setDraftUpdate] = useState<{ version: string; whatsNew: string; highlights: WhatsNewHighlight[] } | null>(null);
  const [whatsNewIsDraft, setWhatsNewIsDraft] = useState(false);
  const draftPublishedRef = useRef(false);
  const isDevUser = useIsDevUser();
  // Dev users: a publish scheduled for later — previewable from any page (it carries its notes), with a
  // countdown on the Dev button.
  const [waitingPublish, setWaitingPublish] = useState<WaitingPublish | null>(null);
  const releaseCountdown = useReleaseCountdown(waitingPublish?.scheduledForIso ?? "");
  // What a Dev previews: this deploy's draft, or else the scheduled one.
  const previewDraft: { version: string; whatsNew: string; highlights: WhatsNewHighlight[] } | null =
    draftUpdate ?? (waitingPublish ? { version: waitingPublish.version, whatsNew: waitingPublish.whatsNew, highlights: waitingPublish.highlights } : null);
  const previewIsScheduled = Boolean(waitingPublish && previewDraft && waitingPublish.version.toLowerCase() === previewDraft.version.toLowerCase());
  const [companyThemeColor, setCompanyThemeColor] = useState("#2F6BFF");
  const [companyLogoPath, setCompanyLogoPath] = useState("");
  // Warms the browser's own image cache the moment the logo URL is known, rather than waiting
  // for the mobile nav drawer to actually mount its own <img> the first time it's opened — the
  // desktop sidebar's identical <img> (further down) doesn't help here since it's display:none
  // on mobile (an ancestor's `hidden lg:flex`), which still skips the fetch in most browsers.
  //
  // A <link rel="preload"> element in <head>, not `new Image()`: a bare `new Image()` with
  // nothing holding a reference to it is eligible for garbage collection while its request is
  // still in flight, and at least Safari/WebKit can actually cancel the fetch when that happens
  // instead of letting it finish in the background — which is exactly the "opens, then the logo
  // pops in a few seconds later" symptom this was meant to fix. A <link> is a real, persistent
  // DOM node (this effect holds the only reference, so it stays alive for as long as the
  // component does), which every major browser recognizes as a dedicated preload hint.
  useEffect(() => {
    if (!companyLogoPath || typeof document === "undefined") return;
    const link = document.createElement("link");
    link.rel = "preload";
    link.as = "image";
    link.href = companyLogoPath;
    document.head.appendChild(link);
    return () => {
      link.remove();
    };
  }, [companyLogoPath]);
  const [companyDisplayName, setCompanyDisplayName] = useState("");
  const [isZapierLeadsEnabled, setIsZapierLeadsEnabled] = useState(false);
  // Latest value for the access effect below, which only stores it alongside the cached access — as a
  // dependency it made that whole effect (membership, company doc, access check) run twice per load.
  const isZapierLeadsEnabledRef = useRef(false);
  useEffect(() => {
    isZapierLeadsEnabledRef.current = isZapierLeadsEnabled;
  }, [isZapierLeadsEnabled]);
  const [companyTagSuggestions, setCompanyTagSuggestions] = useState<string[]>([]);
  const [defaultProjectStatus, setDefaultProjectStatus] = useState("New");
  const [defaultProjectStatusColor, setDefaultProjectStatusColor] = useState("#64748B");
  const [defaultQuoteExtras, setDefaultQuoteExtras] = useState<string[]>([]);
  const [defaultGapAllowancesSettings, setDefaultGapAllowancesSettings] = useState<GapAllowancesSettings>({
    baseBelowBenchToTopOfDoorDrawer: "",
    baseHorizontalGapNormalHandles: "",
    baseHorizontalGapWrapOverHandles: "",
    baseVerticalGapDoorsPanels: "",
    tallTopOfDoorToTopWithScribers: "",
    tallTopOfDoorToTopNoScribers: "",
    tallVerticalGapDoorsPanels: "",
  });
  const [effectiveCompanyRole, setEffectiveCompanyRole] = useState("");
  const [effectiveCompanyPermissions, setEffectiveCompanyPermissions] = useState<string[]>([]);
  const [themeMode, setThemeMode] = useState<ThemeMode>("light");
  // The phone's status bar / Dynamic Island tint (the theme-color meta, app/layout.tsx): the page's
  // background, light or dark.
  useEffect(() => {
    document.querySelector('meta[name="theme-color"]')?.setAttribute("content", themeMode === "dark" ? "#0b0d12" : "#f5f7fa");
  }, [themeMode]);
  // The phone menu's and notifications panel's glass: the top tab bar's, a little stronger so what's in
  // them stays easy to read over the page.
  const mobilePanelGlass = {
    backgroundColor: themeMode === "dark" ? "rgba(11, 13, 18, 0.62)" : "rgba(245, 247, 250, 0.62)",
    backdropFilter: "blur(22px) saturate(180%)",
    WebkitBackdropFilter: "blur(22px) saturate(180%)",
  };
  const photoThumbRefs = useRef<Record<string, HTMLButtonElement | null>>({});
  const previewPanelRef = useRef<HTMLDivElement | null>(null);
  const previewTimerRef = useRef<number | null>(null);
  const previewCloseRafRef = useRef<number | null>(null);
  const newProjectTagInputRef = useRef<HTMLInputElement | null>(null);
  const newProjectScrollRef = useRef<HTMLDivElement | null>(null);
  const assigneeFieldRef = useRef<HTMLDivElement | null>(null);
  const userInitials = useMemo(() => initials(user?.displayName || "User"), [user?.displayName]);
  const userEmblemColor = String(user?.userColor || "").trim() || companyThemeColor;
  const [isDesktopViewport, setIsDesktopViewport] = useState(false);
  // useLayoutEffect, not useEffect — same reasoning as the project page's own
  // isCompactProjectViewport: this starts false (mobile-first default) regardless of the real
  // device, and layout that depends on it would otherwise render wrong for one frame on desktop
  // before a plain useEffect corrects it after the browser has already painted.
  useLayoutEffect(() => {
    if (typeof window === "undefined") return;
    const query = window.matchMedia("(min-width: 1024px)");
    setIsDesktopViewport(query.matches);
    const onChange = (event: MediaQueryListEvent) => setIsDesktopViewport(event.matches);
    query.addEventListener("change", onChange);
    return () => query.removeEventListener("change", onChange);
  }, []);

  // User Settings > "Mobile top navigation bar" now governs the pull-down gesture banner below
  // (Reload/Dashboard/Save & Back) — the actual hamburger/tabs/bell strip in global-app-tabs-bar.tsx
  // always renders regardless of this setting.
  const [mobileTopBarEnabled, setMobileTopBarEnabled] = useState(true);
  useEffect(() => {
    setMobileTopBarEnabled(readMobileTopBarEnabled());
    if (typeof window === "undefined") return;
    const onUpdated = (event: Event) => {
      const detail = (event as CustomEvent<{ enabled: boolean }>).detail;
      setMobileTopBarEnabled(detail?.enabled ?? true);
    };
    window.addEventListener(MOBILE_TOP_BAR_UPDATED_EVENT, onUpdated as EventListener);
    return () => {
      window.removeEventListener(MOBILE_TOP_BAR_UPDATED_EVENT, onUpdated as EventListener);
    };
  }, []);

  // Lets a swipe anywhere on <main> (not just a drag starting on an already-open panel — that's
  // useSwipeToClose's job, inside each panel) open the left nav or notifications, mirroring how
  // swiping an open panel closes it. Same axis-lock approach as useSwipeToClose (6px of movement
  // before committing to horizontal vs vertical) so a vertical scroll never gets hijacked.
  // scroller / scrollerLeft: the page's own horizontal swiper the touch started on (data-horizontal-swipe-scroll — the
  // dashboard's board), and where it was scrolled to then.
  const mainSwipeStartRef = useRef<{
    x: number;
    y: number;
    axis: "" | "horizontal" | "vertical";
    horizontalExempt: boolean;
    scroller: HTMLElement | null;
    scrollerLeft: number;
  } | null>(null);
  const MAIN_SWIPE_OPEN_THRESHOLD_PX = 70;
  // Live-drag state for the OPEN side of this gesture — separate from useSwipeToClose's own
  // internal drag state (which only ever runs once a panel is ALREADY open, for the CLOSE side).
  // `kind` is set the instant the drag axis locks horizontal, which also fires setMobileNavOpen/
  // setNotifOpen right away (mounting the panel) so every subsequent touchmove tick can drag its
  // real transform to follow the finger — this is what makes the panel visibly slide in DURING the
  // drag instead of only animating once after release.
  const mainOpenDragRef = useRef<{ kind: "nav" | "notif" | null }>({ kind: null });
  // Mirrors useSwipeToClose's own applyPush/edge-sign math (see that file for the full reasoning)
  // but driven by a live pixel offset instead of a 0..1 progress value, since this runs every
  // touchmove tick rather than only at fixed open/close endpoints. `dx` is the raw, unclamped
  // horizontal distance from where the finger started.
  const applyMainOpenDrag = (kind: "nav" | "notif", dx: number) => {
    const panel = kind === "nav"
      ? mobileNavPanelRef.current
      : document.querySelector<HTMLElement>('[data-mobile-notif-panel="true"]');
    if (!panel) return;
    const width = panel.getBoundingClientRect().width || window.innerWidth;
    // Only the panel moves — it slides in over the page (see mobilePanelGlass).
    if (kind === "nav") {
      // edge "left": closed = translateX(-100%), fully open = translateX(0).
      const clampedDx = Math.max(0, Math.min(width, dx));
      panel.style.transition = "none";
      panel.style.transform = `translateX(calc(-100% + ${clampedDx}px))`;
    } else {
      // edge "right": closed = translateX(100%), fully open = translateX(0).
      const clampedDx = Math.max(-width, Math.min(0, dx));
      panel.style.transition = "none";
      panel.style.transform = `translateX(calc(100% + ${clampedDx}px))`;
    }
  };
  // Pull-to-navigate: dragging down past the top of an already-at-top page (the same gesture
  // that would otherwise just rubber-band bounce) reveals a full-width action bar pinned to the
  // true top of the viewport (position: fixed, not a normal-flow element pushing content down —
  // that's what left a strip of bare page background above it before, since it started below
  // whatever top padding/bar the page already had). It has two zones: "Dashboard" on the right
  // (the default/rest side) and "Reload" on the left — whichever side the finger is currently
  // over when released past the pull threshold is the one that fires. Tracked with direct DOM
  // writes (not React state) during the drag itself, matching useSwipeToClose's approach, so
  // dragging doesn't re-render on every touchmove.
  const mainScrollRef = useRef<HTMLElement | null>(null);
  const pullBannerRef = useRef<HTMLDivElement | null>(null);
  const pullReloadZoneRef = useRef<HTMLDivElement | null>(null);
  const pullDashboardZoneRef = useRef<HTMLDivElement | null>(null);
  const pullSaveBackZoneRef = useRef<HTMLDivElement | null>(null);
  // The real tab bar (global-app-tabs-bar.tsx) is now the ONE persistent bar surface — its
  // background/blur/border never fade and never disappear, only its CONTENT does (see
  // data-app-top-bar-content, separate from the outer data-app-top-bar div). This banner has no
  // background of its own anymore; it just holds the pulldown menu's icons, which fade IN over the
  // exact same surface as the tab bar's own content fades OUT — one bar, swapping what's drawn on
  // it, rather than two bars with two different backgrounds crossfading into each other. Both refs
  // resolved once per gesture in onMainTouchStart, not re-queried every touchmove tick.
  const pullTopBarElRef = useRef<HTMLElement | null>(null);
  const pullTopBarContentElRef = useRef<HTMLElement | null>(null);
  // The bar's own height as it rests (its inline height — a fullscreen view's glass backdrop has no other, the tab
  // bar's is its class, so ""), put back once a pull's over. Clearing it instead left that backdrop no height at all:
  // after any touch begun at the top of a fullscreen view, its glass was gone, its title over the page unreadable.
  const pullTopBarRestHeightRef = useRef("");
  const findPullTopBar = () => {
    const topBarEl = document.querySelector<HTMLElement>('[data-app-top-bar="true"]');
    if (topBarEl && !topBarEl.hasAttribute("data-pulling")) pullTopBarRestHeightRef.current = topBarEl.style.height;
    pullTopBarElRef.current = topBarEl;
  };
  type PullZone = "reload" | "dashboard" | "saveBack";
  const pullDashboardRef = useRef<{ startY: number; active: boolean; armed: boolean; selected: PullZone } | null>(null);
  // The bar's resting height (matches the tab bar's own h-12) and how tall it can grow if you keep
  // pulling past that — "it should be able to stretch higher, not stop at the tab bar's own
  // height." Both the real tab bar's outer div AND this banner are set to the SAME live height
  // every touchmove tick (see onMainTouchMove) so they stay perfectly overlaid as one surface
  // while it grows, instead of just this banner growing underneath/behind a still-48px tab bar.
  const PULL_BANNER_MIN_HEIGHT_PX = 48;
  const PULL_BANNER_MAX_HEIGHT_PX = 108;
  // Also doubles as the arming distance — a zone only "arms" (will fire on release) once the bar
  // has been pulled all the way out to its current full height, not at some shorter, separate
  // threshold partway through the grow. Releasing before the bar is fully stretched out never
  // fires anything, no matter which zone the finger was over.
  const PULL_HEIGHT_GROW_DISTANCE_PX = 160;
  // How far the finger has to travel for the tab-bar-content/pulldown-icons crossfade to go 0 → 1
  // — deliberately SHORT, independent of the (longer) height-grow distance above. The bubble-travel
  // animation is a fixed-duration CSS animation triggered whenever the selected zone changes
  // (driven by horizontal finger position, not vertical drag distance), so it doesn't need a long
  // drag to "have room to play out" — it plays the same either way. What DOES need to be short is
  // this: the tab bar's own content should be gone and the pulldown icons fully in place almost the
  // instant you start pulling, not gradually over a long drag.
  const PULL_FADE_DISTANCE_PX = 22;
  // A single shared circle that lives at whichever zone is currently selected — not three, one per
  // zone. Switching zones just slides this ONE element's left/top from the departing icon's
  // position to the arriving one's via a plain CSS transition — constant size throughout, no
  // shrink/stretch/liquid effect. A visible, deliberate slide (not an instant teleport), kept
  // simple on purpose.
  const pullActivePillRef = useRef<HTMLDivElement | null>(null);
  const pullPrevSelectedRef = useRef<PullZone>("dashboard");
  const PULL_TRAVEL_DURATION_MS = 220;
  // Guards syncPullPillVertical (called every touchmove tick to keep the circle glued to its icon
  // as the bar keeps growing taller) from fighting an in-flight slide — while one's playing, the
  // transition owns left/top; the sync resumes once it's landed.
  const pullTravelInFlightRef = useRef(false);
  const pullZoneRefByKey: Record<PullZone, React.RefObject<HTMLDivElement | null>> = {
    reload: pullReloadZoneRef,
    dashboard: pullDashboardZoneRef,
    saveBack: pullSaveBackZoneRef,
  };
  const pullPillColorFor = (armed: boolean) =>
    armed
      ? { backgroundImage: "var(--brand-gradient)", backgroundColor: "" }
      : { backgroundImage: "none", backgroundColor: "var(--panel-bg)" };
  // Icon-relative-to-pill-container coordinates: getBoundingClientRect() is viewport-relative, but
  // the pill's own left/top/width are relative to its own positioned ancestor (the banner itself)
  // — subtracting the banner's own rect puts both in the same coordinate space. Includes `top`
  // because the icon is no longer vertically centered in the banner on its own (the label now
  // sits below it, in the same flex column, which shifts the icon's own center above the banner's
  // true midpoint) — assuming banner-center for the pill would leave it floating below the icon.
  const pullIconRectRelativeToContainer = (zone: PullZone) => {
    const container = pullBannerRef.current;
    const icon = pullZoneRefByKey[zone].current?.querySelector<HTMLElement>("[data-pull-icon]");
    if (!container || !icon) return null;
    const containerRect = container.getBoundingClientRect();
    const iconRect = icon.getBoundingClientRect();
    return { left: iconRect.left - containerRect.left, top: iconRect.top - containerRect.top, width: iconRect.width, height: iconRect.height };
  };
  const setPillRect = (
    pill: HTMLDivElement,
    rect: { left: number; top: number; width: number; height: number },
  ) => {
    pill.style.left = `${rect.left}px`;
    pill.style.top = `${rect.top}px`;
    pill.style.width = `${rect.width}px`;
    pill.style.height = `${rect.height}px`;
  };
  const snapPullPillToZone = (zone: PullZone, armed: boolean) => {
    const pill = pullActivePillRef.current;
    const rect = pullIconRectRelativeToContainer(zone);
    if (!pill || !rect) return;
    pill.style.transition = "none";
    setPillRect(pill, rect);
    Object.assign(pill.style, pullPillColorFor(armed));
  };
  // Keeps the circle glued to the SELECTED zone's icon as the bar's own height grows over the
  // course of the drag — without this, the icon (re-centered by the growing bar's flex layout)
  // would drift away from the circle, which only otherwise moves when triggerPullBubbleTravel fires.
  const syncPullPillVertical = (selected: PullZone) => {
    if (pullTravelInFlightRef.current) return;
    const pill = pullActivePillRef.current;
    const rect = pullIconRectRelativeToContainer(selected);
    if (!pill || !rect) return;
    pill.style.transition = "none";
    setPillRect(pill, rect);
  };
  const triggerPullBubbleTravel = (fromZone: PullZone, toZone: PullZone, armed: boolean) => {
    const pill = pullActivePillRef.current;
    const fromRect = pullIconRectRelativeToContainer(fromZone);
    const toRect = pullIconRectRelativeToContainer(toZone);
    if (!pill || !fromRect || !toRect) return;
    // Snap to the departure point with no transition first (in case it wasn't already there — e.g.
    // this is the very first slide of the gesture)...
    pill.style.transition = "none";
    setPillRect(pill, fromRect);
    Object.assign(pill.style, pullPillColorFor(armed));
    void pill.offsetWidth;
    // ...then, next frame, let a plain CSS transition carry it to the arrival point.
    pullTravelInFlightRef.current = true;
    pill.style.transition = `left ${PULL_TRAVEL_DURATION_MS}ms ease, top ${PULL_TRAVEL_DURATION_MS}ms ease`;
    setPillRect(pill, toRect);
    window.setTimeout(() => {
      pullTravelInFlightRef.current = false;
    }, PULL_TRAVEL_DURATION_MS);
  };
  const applyPullZoneStyles = (selected: PullZone, armed: boolean) => {
    const zones: Array<[PullZone, HTMLDivElement | null]> = [
      ["reload", pullReloadZoneRef.current],
      ["dashboard", pullDashboardZoneRef.current],
      ["saveBack", pullSaveBackZoneRef.current],
    ];
    const zoneChanged = pullPrevSelectedRef.current !== selected;
    if (zoneChanged) {
      triggerPullBubbleTravel(pullPrevSelectedRef.current, selected, armed);
      pullPrevSelectedRef.current = selected;
    } else {
      // Same zone, but armed/not-armed can still have flipped (finger held still while crossing
      // the arm threshold) — the pill needs its color updated even without a travel animation.
      Object.assign(pullActivePillRef.current?.style ?? {}, pullPillColorFor(armed));
    }
    // The label (data-pull-label) is hidden (icon-only) except on the selected zone, where it
    // fades in below the icon — it never affects the pill's own width (see PULL_FADE_DISTANCE_PX's
    // own comment on why the pill stays icon-sized rather than trying to track the label).
    for (const [zone, el] of zones) {
      if (!el) continue;
      const isSelected = zone === selected;
      const icon = el.querySelector<HTMLElement>("[data-pull-icon]");
      const label = el.querySelector<HTMLElement>("[data-pull-label]");
      if (icon) icon.style.color = isSelected ? (armed ? "#FFFFFF" : "var(--brand-strong)") : "var(--text-muted)";
      if (label) label.style.opacity = isSelected ? "1" : "0";
    }
  };
  // Previously pushed the top tab bar (`top`) and the page content (`margin-top`) down by the same
  // pixel amount every touchmove tick, so the whole page read as sliding down to reveal a SEPARATE
  // banner growing in height underneath — a box that GROWS while everything else stays still reads
  // as a new thing arriving, however well any fade layered on top of it is timed. The tab bar is
  // now the ONE persistent bar: its own outer div (data-app-top-bar) never fades and is what
  // actually grows taller as you pull, while only its inner CONTENT (data-app-top-bar-content —
  // hamburger/tabs/bell) fades out. This banner has no background of its own; it mirrors the SAME
  // live height every tick (see onMainTouchMove) so its icons sit inside that same growing surface,
  // and only ITS opacity (the icons fading in) moves. One bar, changing both its size and its
  // content, never two things sliding/growing past each other.
  const PULL_BANNER_RESET_DURATION_MS = 200;
  const resetPullBanner = (animate: boolean) => {
    const transition = animate ? `opacity ${PULL_BANNER_RESET_DURATION_MS}ms ease, height ${PULL_BANNER_RESET_DURATION_MS}ms ease` : "none";
    const banner = pullBannerRef.current;
    if (banner) {
      banner.style.transition = transition;
      banner.style.opacity = "0";
      banner.style.height = `${PULL_BANNER_MIN_HEIGHT_PX}px`;
      banner.style.pointerEvents = "none";
    }
    const topBarEl = pullTopBarElRef.current;
    if (topBarEl) {
      topBarEl.style.transition = animate ? `height ${PULL_BANNER_RESET_DURATION_MS}ms ease` : "none";
      topBarEl.style.height = pullTopBarRestHeightRef.current;
      topBarEl.removeAttribute("data-pulling");
    }
    const topBarContentEl = pullTopBarContentElRef.current;
    if (topBarContentEl) {
      topBarContentEl.style.transition = animate ? `opacity ${PULL_BANNER_RESET_DURATION_MS}ms ease` : "none";
      topBarContentEl.style.opacity = "1";
      topBarContentEl.style.pointerEvents = "";
    }
    applyPullZoneStyles("dashboard", false);
  };
  // Dev mode's "test navigation" button (phones/tablets, where the pull-down menu is): shows the menu
  // pulled all the way down, to look at — the same bar and banner the pull gesture drives. Tapping a
  // zone in it only shows that zone selected, then armed (the blue circle) — nothing it does is done.
  const devModeOn = useDevModeOn();
  const [pullPreviewOpen, setPullPreviewOpen] = useState(false);
  const pullPreviewZoneRef = useRef<{ zone: PullZone; armed: boolean }>({ zone: "dashboard", armed: false });
  if (pullPreviewOpen && !devModeOn) setPullPreviewOpen(false);
  const openPullPreview = () => {
    if (typeof document === "undefined") return;
    findPullTopBar();
    pullTopBarContentElRef.current = document.querySelector<HTMLElement>('[data-app-top-bar-content="true"]');
    const transition = `opacity ${PULL_BANNER_RESET_DURATION_MS}ms ease, height ${PULL_BANNER_RESET_DURATION_MS}ms ease`;
    const banner = pullBannerRef.current;
    if (!banner) return;
    banner.style.transition = transition;
    banner.style.height = `${PULL_BANNER_MAX_HEIGHT_PX}px`;
    banner.style.opacity = "1";
    banner.style.pointerEvents = "auto";
    const topBarEl = pullTopBarElRef.current;
    if (topBarEl) {
      topBarEl.style.transition = `height ${PULL_BANNER_RESET_DURATION_MS}ms ease`;
      topBarEl.style.height = `${PULL_BANNER_MAX_HEIGHT_PX}px`;
      topBarEl.setAttribute("data-pulling", "true");
    }
    const topBarContentEl = pullTopBarContentElRef.current;
    if (topBarContentEl) {
      topBarContentEl.style.transition = `opacity ${PULL_BANNER_RESET_DURATION_MS}ms ease`;
      topBarContentEl.style.opacity = "0";
      topBarContentEl.style.pointerEvents = "none";
    }
    pullPrevSelectedRef.current = "dashboard";
    pullPreviewZoneRef.current = { zone: "dashboard", armed: false };
    applyPullZoneStyles("dashboard", false);
    // The circle goes under the icon once the bar's finished growing (the icons move as it grows).
    window.setTimeout(() => snapPullPillToZone("dashboard", false), PULL_BANNER_RESET_DURATION_MS + 20);
    setPullPreviewOpen(true);
  };
  const closePullPreview = () => {
    resetPullBanner(true);
    setPullPreviewOpen(false);
  };
  // A tap on the open preview: that third of it selected — or, already selected, armed / un-armed.
  const onPullPreviewTap = (clientX: number) => {
    const fraction = clientX / window.innerWidth;
    const zone: PullZone = fraction < 1 / 3 ? "reload" : fraction < 2 / 3 ? "dashboard" : "saveBack";
    const current = pullPreviewZoneRef.current;
    const armed = zone === current.zone ? !current.armed : false;
    pullPreviewZoneRef.current = { zone, armed };
    applyPullZoneStyles(zone, armed);
  };
  useEffect(() => {
    // Dev mode turned off with the preview open: put the bar back.
    if (!devModeOn && pullBannerRef.current && pullBannerRef.current.style.opacity === "1" && !pullDashboardRef.current) {
      resetPullBanner(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [devModeOn]);
  const onMainTouchStart = (event: ReactTouchEvent<HTMLElement>) => {
    // data-app-gesture-exempt is a page surface that owns BOTH axes of its own touch handling
    // entirely (e.g. Nesting/CNC's mobile Visibility slide-up panel) — without it, tapping into
    // that panel's search box could get swept into this page-level pull-to-reveal/nav-swipe
    // system. Deliberately NOT used for Quote/Specifications' own sheet preview (pinch-zoom) —
    // that would ALSO block a genuine single-finger drag-down there from ever reaching this
    // gesture; a pinch's two fingers are instead caught more precisely by the
    // event.touches.length > 1 check just below, which only bails out for an actual multi-touch
    // start.
    //
    // data-horizontal-swipe-scroll is narrower: a page's own horizontal swiper (e.g. the
    // dashboard's board-view columns) needs the same left/right drag gesture for its own
    // purposes, so THAT direction should stay hands-off — but a touch that starts there can still
    // resolve to a genuinely VERTICAL drag (e.g. a column that's already scrolled to its own top,
    // handed the scroll off to the page — the page moving further is a vertical gesture, not a
    // horizontal one), and that should still be free to arm pull-to-reveal/reload like anywhere
    // else on the page. So this one is only checked once the axis is known, in onMainTouchMove's
    // horizontal branch, not bailed out of here.
    const startedOnGestureExempt = (event.target as HTMLElement | null)?.closest('[data-app-gesture-exempt="true"]');
    // event.touches.length > 1: a pinch's two fingers can easily read as one finger dragging
    // (the exact motion that pulls down the nav bar or swipes open the nav/notif drawers here) —
    // belt-and-braces alongside startedOnGestureExempt above, which is what actually stops this in
    // the common case of a pinch starting on a marked surface (e.g. the Quote/Specs sheet preview).
    //
    // isAnyPopupOpen(): while a pop-up is up (anything components/scroll-lock-watcher.tsx counts — a
    // modal, a drawer, a confirm), a drag on it belongs to the pop-up — dragging down shouldn't pull the
    // top menu down over it, and a sideways drag shouldn't slide a drawer in under/over it.
    if (isDesktopViewport || mobileNavOpen || notifOpen || startedOnGestureExempt || event.touches.length > 1 || isAnyPopupOpen()) {
      mainSwipeStartRef.current = null;
      pullDashboardRef.current = null;
      // Also clear a stale kind, not just the two refs above — a previous gesture that committed
      // to "nav"/"notif" but never made it to onMainTouchEnd (e.g. mobileNavOpen is already true
      // here precisely because of that) would otherwise leave mainOpenDragRef.current.kind sitting
      // non-null, ready to be picked up as already-decided by this NEXT touch's own
      // onMainTouchMove (its own `if (!mainOpenDragRef.current.kind)` check reads false against
      // this stale leftover instead of resolving its own fresh direction).
      mainOpenDragRef.current.kind = null;
      return;
    }
    const horizontalScroller = (event.target as HTMLElement | null)?.closest<HTMLElement>('[data-horizontal-swipe-scroll="true"]') ?? null;
    const touch = event.touches[0];
    if (!touch) return;
    mainSwipeStartRef.current = {
      x: touch.clientX,
      y: touch.clientY,
      axis: "",
      horizontalExempt: Boolean(horizontalScroller),
      scroller: horizontalScroller,
      scrollerLeft: horizontalScroller?.scrollLeft ?? 0,
    };
    mainOpenDragRef.current.kind = null;
    // Checking ONLY <main>'s own scrollTop isn't enough — the dashboard's board-view columns
    // become their own independently-scrollable regions once their sticky panel locks in place
    // (see dashboard/page.tsx's own setCardListsScrollable), and <main> itself stops advancing
    // once that happens. That left <main>.scrollTop reading 0 (or some small, stale value) while
    // the user was genuinely scrolled deep into a locked column's card list, arming the pull-down
    // menu mid-scroll instead of only at the true top of the page. Walking up from the actual
    // touch target catches any such nested scrolled region, not just the outer page scroll.
    const touchTarget = event.target as HTMLElement | null;
    let hasScrolledAncestor = false;
    for (let node = touchTarget; node && node !== mainScrollRef.current; node = node.parentElement) {
      if (node.scrollTop > 0) {
        hasScrolledAncestor = true;
        break;
      }
    }
    // Some chromeHidden fullscreen views (Quote, Specifications) own their real scroll
    // independently of <main> — <main> is height-matched to its single child there, so its own
    // scrollTop never leaves 0 — AND portal a large share of their touchable UI (the Version
    // History/Extras drawers, Download menu, Save/Reset/Send/Custom-Price modals) straight to
    // document.body. A touch starting on any of that portaled content has no DOM path back to
    // the view's actual scroll container, so the ancestor walk above can't find it and always
    // concludes "not scrolled," arming the pulldown regardless of how far the view is actually
    // scrolled. Such a view marks its own true scroll owner with data-app-scroll-root — when
    // present, cross-check it directly (authoritative regardless of where the touch started)
    // rather than relying solely on DOM ancestry, which portals deliberately break out of.
    const scrollRootEl =
      typeof document !== "undefined" ? document.querySelector<HTMLElement>('[data-app-scroll-root="true"]') : null;
    if (scrollRootEl && scrollRootEl.scrollTop > 0) {
      hasScrolledAncestor = true;
    }
    const alreadyAtTop = (mainScrollRef.current?.scrollTop ?? 0) <= 0 && !hasScrolledAncestor;
    // isSheetZoomedAwayFromEdge: Quote/Specifications' own sheet preview pans/zooms via a CSS
    // transform on its own canvas, not real scroll — <main>'s scrollTop (and the data-app-scroll-
    // root cross-check above) both still read "at the top" no matter where inside a zoomed sheet
    // the user is currently panned to, so without this a one-finger drag to pan around a zoomed-in
    // sheet gets misread as the start of this pulldown gesture every time, fighting the sheet's own
    // pan for the same vertical touch (see isSheetZoomedAwayFromEdge's own comment in
    // lib/app-tabs-context.tsx). Reading the REF here, not the state value destructured above —
    // this handler fires directly off a native touchstart, not a React render, so it needs
    // whatever's true at this exact instant; the state value can still be one or more renders
    // behind on a real device, when a second gesture (e.g. a quick re-grab right after a pinch)
    // starts before React has caught up, which let this pulldown arm mid-zoom.
    if (alreadyAtTop && mobileTopBarEnabled && !isSheetZoomedAwayFromEdgeRef.current) {
      pullDashboardRef.current = { startY: touch.clientY, active: false, armed: false, selected: "dashboard" };
      if (typeof document !== "undefined") findPullTopBar();
      else pullTopBarElRef.current = null;
      pullTopBarContentElRef.current =
        typeof document !== "undefined" ? document.querySelector<HTMLElement>('[data-app-top-bar-content="true"]') : null;
      pullPrevSelectedRef.current = "dashboard";
      snapPullPillToZone("dashboard", false);
    } else {
      pullDashboardRef.current = null;
    }
  };
  const onMainTouchMove = (event: ReactTouchEvent<HTMLElement>) => {
    const start = mainSwipeStartRef.current;
    if (!start) return;
    // A second finger landing mid-gesture (a pinch starting just after this one already passed
    // startedOnGestureExempt, e.g. right at a marked surface's edge) — unwind whichever drag was in
    // flight the same way its own early-abort path already does (mirroring onMainTouchEnd's <
    // MAIN_SWIPE_OPEN_THRESHOLD_PX branch and onMainTouchMove's own dy <= 0 pull-cancel branch
    // below) rather than just dropping the ref, which would leave a nav/notif panel or the pulldown
    // banner permanently stuck mid-drag with nothing left to ever finish animating it closed.
    if (event.touches.length > 1) {
      const kind = mainOpenDragRef.current.kind;
      mainOpenDragRef.current.kind = null;
      if (kind === "nav") setMobileNavOpen(false);
      else if (kind === "notif") setNotifOpen(false);
      if (kind && typeof document !== "undefined") document.body.style.touchAction = "";
      const pull = pullDashboardRef.current;
      if (pull?.active) resetPullBanner(false);
      pullDashboardRef.current = null;
      mainSwipeStartRef.current = null;
      return;
    }
    const touch = event.touches[0];
    if (!touch) return;
    if (!start.axis) {
      const dx = touch.clientX - start.x;
      const dy = touch.clientY - start.y;
      if (Math.abs(dx) < 6 && Math.abs(dy) < 6) return;
      // On the page's own horizontal swiper (the dashboard's board), sideways wins unless it's clearly a vertical
      // drag: a swipe across the columns that happens to start a little downwards was read as vertical, and at the
      // top of the page that pulled the menu down instead — taking the touch (preventDefault) so the board stopped dead.
      start.axis = start.horizontalExempt
        ? Math.abs(dy) > Math.abs(dx) * 1.5
          ? "vertical"
          : "horizontal"
        : Math.abs(dx) > Math.abs(dy)
          ? "horizontal"
          : "vertical";
    }
    if (start.axis === "horizontal") {
      // The touch started on the page's own horizontal swiper (e.g. dashboard board columns) —
      // leave it alone entirely so the native horizontal scroll-snap keeps working, same as
      // before. A vertical resolve for the same touch is NOT covered by this — see onMainTouchStart.
      if (start.horizontalExempt) return;
      const dx = touch.clientX - start.x;
      // First tick of a horizontal drag decides which panel it's opening and fires the real
      // state update right away — this is what mounts the panel (via useSwipeToClose's own
      // shouldRender) early enough for the drag below to actually have something to move. On the
      // very tick this fires the panel usually isn't in the DOM yet (React hasn't re-rendered),
      // so applyMainOpenDrag below just no-ops until a later tick finds it.
      //
      // !chromeHidden: a chromeHidden fullscreen view (Quote, Specifications, Compare, etc.) is
      // rendered as a plain (non-exempt) child of <main>, and several of ITS OWN controls — most
      // notably the small top-left "Back" button that leaves the view entirely — have no touch
      // handlers of their own, so a tap on one that carries even a few incidental pixels of
      // horizontal movement bubbles up and lands right here. Committing to "nav"/"notif" at that
      // point calls setMobileNavOpen/setNotifOpen(true) immediately — invisibly, since
      // effectiveHideSidebar (hideSidebar || chromeHidden) keeps the panel unrendered while still
      // inside the fullscreen view — and nothing ever resets it back: the only navigation-keyed
      // reset is pathname-based (below), but leaving a chromeHidden view is a local state change
      // (e.g. setSalesNav("overview")), not a route change. The stale `true` then surfaces the
      // instant chromeHidden flips back to false and the drawer becomes visible again, reading as
      // "closing the fullscreen view randomly opened the nav drawer." Bailing out here entirely
      // while chromeHidden is far simpler than auditing every current and future control inside
      // every such view for the same gap — these fullscreen views already own this exact gesture
      // space themselves (e.g. Quote/Specifications' own swipe-to-open-Version-History), so the
      // global drawer swipe has nothing legitimate to do here anyway. Deliberately NOT folded into
      // onMainTouchStart's own early bail-out above: that would also drop mainSwipeStartRef/
      // pullDashboardRef, breaking the vertical pull-down-to-reveal-menu gesture, which DOES need
      // to keep working inside these views (it's how several of them are meant to be left).
      if (!mainOpenDragRef.current.kind && !chromeHidden) {
        if (dx > 0) {
          mainOpenDragRef.current.kind = "nav";
          setMobileNavOpen(true);
          // touch-action: none on the whole page for the rest of this gesture — belt-and-braces
          // alongside preventDefault() below. Dragging open the LEFT (nav) drawer starts right at
          // the screen's left edge, which on iOS Safari can be claimed by the OS's own "swipe from
          // edge to go back" gesture recognizer before our touchmove handler ever runs, no matter
          // how early preventDefault() is called — that's what showed up as the page behind the
          // drawer doing its own separate native scroll/rubber-band bounce, and as still being
          // able to scroll vertically mid-drag. Setting touch-action directly is respected earlier
          // in the browser's own gesture-recognition pipeline than a JS preventDefault() call can
          // be, which is what actually suppresses it. Reset in onMainTouchEnd.
          if (typeof document !== "undefined") document.body.style.touchAction = "none";
        } else if (dx < 0) {
          mainOpenDragRef.current.kind = "notif";
          setNotifOpen(true);
          if (typeof document !== "undefined") document.body.style.touchAction = "none";
        }
      }
      const kind = mainOpenDragRef.current.kind;
      if (kind) {
        event.preventDefault();
        applyMainOpenDrag(kind, dx);
      }
      return;
    }
    const pull = pullDashboardRef.current;
    if (!pull || start.axis !== "vertical") return;
    // The board's already moving sideways under the finger (the browser took it as a horizontal scroll): never pull
    // the menu down over it — that would stop it.
    if (start.scroller && Math.abs(start.scroller.scrollLeft - start.scrollerLeft) > 1 && !pull.active) return;
    const dy = touch.clientY - pull.startY;
    if (dy <= 0) {
      if (pull.active) {
        pull.active = false;
        pull.armed = false;
        resetPullBanner(false);
      }
      return;
    }
    pull.active = true;
    event.preventDefault();
    // Two independent progress values over the SAME raw drag distance (dy), on purpose different
    // lengths: fadeProgress (content crossfade) completes in a short PULL_FADE_DISTANCE_PX so the
    // tab bar's own content is gone and the pulldown icons are in almost instantly; heightProgress
    // (how much taller the shared bar surface has grown) keeps responding over a much longer
    // PULL_HEIGHT_GROW_DISTANCE_PX, so continuing to pull keeps visibly doing something.
    const fadeProgress = Math.max(0, Math.min(1, dy / PULL_FADE_DISTANCE_PX));
    const heightProgress = Math.max(0, Math.min(1, dy / PULL_HEIGHT_GROW_DISTANCE_PX));
    const barHeight = PULL_BANNER_MIN_HEIGHT_PX + (PULL_BANNER_MAX_HEIGHT_PX - PULL_BANNER_MIN_HEIGHT_PX) * heightProgress;
    // Armed only once the bar has been pulled all the way out to its current full height — not at
    // some earlier, shorter distance — so a zone only "activates" when the menu is fully revealed.
    pull.armed = heightProgress >= 1;
    // Three equal zones left-to-right: Reload / Dashboard / Save & Back.
    const fraction = touch.clientX / window.innerWidth;
    pull.selected = fraction < 1 / 3 ? "reload" : fraction < 2 / 3 ? "dashboard" : "saveBack";
    // The tab bar's own outer div is the ONE persistent surface (see resetPullBanner's own
    // comment) — it grows taller here, in lockstep with this banner mirroring the exact same
    // height, so the pulldown icons always sit inside whatever that surface's current bounds are.
    const banner = pullBannerRef.current;
    if (banner) {
      banner.style.transition = "none";
      banner.style.height = `${barHeight}px`;
      banner.style.opacity = String(fadeProgress);
      banner.style.pointerEvents = fadeProgress > 0 ? "auto" : "none";
    }
    const topBarEl = pullTopBarElRef.current;
    if (topBarEl) {
      topBarEl.style.transition = "none";
      topBarEl.style.height = `${barHeight}px`;
      // Shows the bar's glass while it's pulled down (globals.css).
      topBarEl.setAttribute("data-pulling", "true");
    }
    const topBarContentEl = pullTopBarContentElRef.current;
    if (topBarContentEl) {
      topBarContentEl.style.transition = "none";
      topBarContentEl.style.opacity = String(1 - fadeProgress);
      topBarContentEl.style.pointerEvents = "none";
    }
    applyPullZoneStyles(pull.selected, pull.armed);
    syncPullPillVertical(pull.selected);
  };
  const onMainTouchEnd = (event: ReactTouchEvent<HTMLElement>) => {
    const start = mainSwipeStartRef.current;
    const pull = pullDashboardRef.current;
    mainSwipeStartRef.current = null;
    pullDashboardRef.current = null;
    // Always reset, not just when a nav/notif drag actually happened — cheap no-op otherwise, and
    // this is the one place that must never leave touch-action stuck at "none" (which would break
    // scrolling everywhere) no matter which path through this gesture the touch actually took.
    if (typeof document !== "undefined") document.body.style.touchAction = "";
    // Unconditional now, not gated behind pull?.active — a drag that had already been cancelled
    // mid-gesture (dragged down then back past the start point, which flips .active back to
    // false and does its own mid-drag reset) left nothing to force the push/banner back to their
    // resting values AT RELEASE beyond whatever that mid-drag reset already did. If any later
    // finger movement re-armed and re-pushed by even a pixel before lifting, .active would be
    // true again and this ran anyway — but if it didn't, the page could be left sitting pushed
    // down under the top bar with nothing to snap it back. Forcing a reset here whenever a pull
    // was tracked at all (armed or not, active or not) closes that gap for good.
    if (pull) {
      resetPullBanner(true);
    }
    if (pull?.active) {
      if (pull.armed) {
        // Let the banner's own release animation (just kicked off above, via the unconditional
        // resetPullBanner(true)) actually play before firing the action, instead of it starting to
        // slide back to hidden and then immediately being torn away by a reload/navigation — this
        // is what makes it read as "sliding back closed while the task it was released on runs" the
        // way a native pull-to-refresh spinner does, rather than snapping away instantly.
        window.setTimeout(() => {
          if (pull.selected === "reload") {
            window.location.reload();
          } else if (pull.selected === "dashboard") {
            // router.push("/dashboard") while already ON /dashboard is a same-URL no-op in the
            // App Router — no remount, no re-render tied to the route, so the dashboard's own
            // client-side project-loading effect never re-runs and the list is left showing
            // whatever it already had (stale, or still empty after a failed load). A full reload
            // is the only thing that reliably forces that effect to run again from a cold state,
            // same as the "Reload" zone immediately above.
            if (pathname === "/dashboard") {
              window.location.reload();
            } else {
              router.push("/dashboard");
            }
          } else if (saveAndBackHandler) {
            void saveAndBackHandler();
          } else {
            router.back();
          }
        }, PULL_BANNER_RESET_DURATION_MS);
      }
      return;
    }
    if (!start || start.axis !== "horizontal") {
      mainOpenDragRef.current.kind = null;
      return;
    }
    const kind = mainOpenDragRef.current.kind;
    mainOpenDragRef.current.kind = null;
    if (!kind) return;
    const touch = event.changedTouches[0];
    if (!touch) return;
    const dx = touch.clientX - start.x;
    const panel = kind === "nav"
      ? mobileNavPanelRef.current
      : document.querySelector<HTMLElement>('[data-mobile-notif-panel="true"]');
    const width = panel?.getBoundingClientRect().width || window.innerWidth;
    const progress = kind === "nav"
      ? Math.max(0, Math.min(1, dx / width))
      : Math.max(0, Math.min(1, -dx / width));
    if (progress < MAIN_SWIPE_OPEN_THRESHOLD_PX / width) {
      // Didn't drag far enough — abort. setMobileNavOpen/setNotifOpen(false) hands off to
      // useSwipeToClose's own close effect, which transitions from wherever this drag left the
      // panel rather than snapping back to fully open first (see that hook's own comment).
      if (kind === "nav") setMobileNavOpen(false);
      else setNotifOpen(false);
      return;
    }
    // Dragged far enough — commit. isOpen was already set true the moment this drag started, so
    // useSwipeToClose's own open effect already ran (and won't fire again); settle the rest of
    // the way to fully open ourselves, matching that hook's own duration/easing.
    if (panel) {
      const transition = "transform 260ms cubic-bezier(0.32, 0.72, 0, 1)";
      panel.style.transition = transition;
      panel.style.transform = "translateX(0px)";
    }
  };
  // An owner or admin viewing the app as one of the company's roles (lib/view-as-role.ts): the sidebar, New Project and
  // the rest here go by that role's permissions instead of theirs — a preview only.
  const viewAsRole = useViewAsRole();
  const realRoleForUi = String(effectiveCompanyRole || user?.role || "").trim().toLowerCase();
  const viewingAsRole = Boolean(viewAsRole) && (realRoleForUi === "owner" || realRoleForUi === "admin");
  const normalizedEffectivePermissions = useMemo(
    () => (viewingAsRole && viewAsRole ? viewAsRole.permissionKeys : effectiveCompanyPermissions).map((item) => String(item || "").trim().toLowerCase()),
    [effectiveCompanyPermissions, viewingAsRole, viewAsRole],
  );

  const roleForUi = viewingAsRole ? "staff" : realRoleForUi;

  const canCreateForOthers = useMemo(() => {
    const role = roleForUi;
    if (role === "owner" || role === "admin") return true;
    return hasPermissionKey(normalizedEffectivePermissions, "projects.create.others");
  }, [normalizedEffectivePermissions, roleForUi]);

  // Their role's Create Projects permission (Company Settings › Roles) — every way into New Project goes by it: the
  // sidebar's button, the dashboard's, a lead's Create Project, and saving it.
  const canCreateProject = useMemo(() => {
    if (!user) return false;
    const role = roleForUi;
    if (role === "owner" || role === "admin") return true;
    return (
      hasPermissionKey(normalizedEffectivePermissions, "projects.create") ||
      hasPermissionKey(normalizedEffectivePermissions, "projects.create.others")
    );
  }, [normalizedEffectivePermissions, roleForUi, user]);

  const canAccessCompanySettings = useMemo(() => {
    const role = roleForUi;
    if (role === "owner" || role === "admin") return true;
    return hasPermissionKey(normalizedEffectivePermissions, "company.settings");
  }, [normalizedEffectivePermissions, roleForUi]);

  const canAccessDashboard = useMemo(() => {
    const role = roleForUi;
    if (role === "owner" || role === "admin") return true;
    return hasPermissionKey(normalizedEffectivePermissions, "company.dashboard.view");
  }, [normalizedEffectivePermissions, roleForUi]);

  const canAccessLeads = useMemo(() => {
    const role = roleForUi;
    if (role === "owner" || role === "admin") return true;
    return hasPermissionKey(normalizedEffectivePermissions, "leads.view");
  }, [normalizedEffectivePermissions, roleForUi]);

  const canAccessClients = useMemo(() => {
    const role = roleForUi;
    if (role === "owner" || role === "admin") return true;
    return (
      hasPermissionKey(normalizedEffectivePermissions, "clients.view") ||
      hasPermissionKey(normalizedEffectivePermissions, "clients.view.all")
    );
  }, [normalizedEffectivePermissions, roleForUi]);
  const canViewAllClients = useMemo(
    () => roleForUi === "owner" || roleForUi === "admin" || hasPermissionKey(normalizedEffectivePermissions, "clients.view.all"),
    [normalizedEffectivePermissions, roleForUi],
  );

  // Calendar: role permission calendar.view (calendar.edit is dropped, but old roles carrying it still get in).
  const canAccessCalendar = useMemo(() => {
    const role = roleForUi;
    if (role === "owner" || role === "admin") return true;
    return (
      hasPermissionKey(normalizedEffectivePermissions, "calendar.view") ||
      hasPermissionKey(normalizedEffectivePermissions, "calendar.edit")
    );
  }, [normalizedEffectivePermissions, roleForUi]);

  // Reports: only a role that holds company.report (or company.*, everything) — not every owner / admin as the tabs
  // above, since a role counts as admin for holding company.settings alone.
  const canAccessReports = useMemo(
    () => hasPermissionKey(normalizedEffectivePermissions, "company.report"),
    [normalizedEffectivePermissions],
  );

  const visibleTopNav = useMemo(
    () =>
      topNav.filter((item) => {
        if (item.href === "/dashboard") return canAccessDashboard;
        if (item.href === "/small-jobs") return canAccessDashboard;
        if (item.href === "/contacts") return canAccessClients;
        if (item.href === "/leads") return canAccessLeads;
        if (item.href === "/calendar") return canAccessCalendar;
        if (item.href === "/company-settings") return canAccessCompanySettings;
        if (item.href === "/reports") return canAccessReports;
        return true;
      }),
    [canAccessCalendar, canAccessClients, canAccessCompanySettings, canAccessDashboard, canAccessLeads, canAccessReports],
  );
  // The pages in their sections, in order.
  const visibleNavGroups = useMemo(() => {
    const groups: Array<{ name: string; items: typeof visibleTopNav }> = [];
    for (const item of visibleTopNav) {
      const last = groups[groups.length - 1];
      if (last && last.name === item.group) last.items.push(item);
      else groups.push({ name: item.group, items: [item] });
    }
    return groups;
  }, [visibleTopNav]);
  // A section's arrow: folds it away or opens it back out, remembered for next time. On a computer the page highlight
  // keeps to its page as the pages above it move (straight with it, no slide of its own), then it's measured again
  // once they've settled.
  const toggleNavGroup = (name: string) => {
    const mobileList = isDesktopViewport ? null : mobileNavListRef.current;
    if (mobileList) {
      const rows = Array.from(mobileList.children) as HTMLElement[];
      mobileNavFoldRef.current = { group: name, opening: Boolean(foldedNavGroups[name]), rects: new Map(rows.map((row) => [row, row.getBoundingClientRect()])) };
    }
    const next = { ...foldedNavGroups };
    if (next[name]) delete next[name];
    else next[name] = true;
    setFoldedNavGroupsState({ key: foldedNavGroupsKey, folded: next });
    setAnimatedNavGroup(name);
    if (foldedNavGroupsKey) {
      try {
        window.localStorage.setItem(foldedNavGroupsKey, JSON.stringify(next));
      } catch {
        // Storage unavailable — it just won't be remembered.
      }
    }
    // (The page highlight is the computer's sidebar's — nothing to keep up with on a phone.)
    if (!isDesktopViewport) return;
    let settled = false;
    const follow = () => {
      const container = navListRef.current;
      const highlight = navHighlightRef.current;
      const activeHref = visibleTopNav.find((item) => pathname?.startsWith(item.href))?.href;
      const link = activeHref ? navLinkRefs.current[activeHref] : null;
      if (settled || !container || !highlight || !link) return;
      highlight.style.transition = "opacity 200ms ease";
      highlight.style.top = `${link.getBoundingClientRect().top - container.getBoundingClientRect().top + container.scrollTop}px`;
      window.requestAnimationFrame(follow);
    };
    window.requestAnimationFrame(follow);
    window.setTimeout(() => {
      settled = true;
      if (navHighlightRef.current) navHighlightRef.current.style.transition = NAV_HIGHLIGHT_TRANSITION;
      setNavLayoutTick((tick) => tick + 1);
    }, NAV_GROUP_FOLD_MS + 40);
  };
  // The phone's menu, a section folded or opened (toggleNavGroup): the rows under it slide from where they were to where
  // they are now — a transform, smooth on a phone, where animating the list's own layout (as the computer's sidebar
  // does) stuttered. An opened section's pages fade in under them; a folded one's fade out where they were (a copy,
  // behind the rows) as the rest slides up over them.
  useLayoutEffect(() => {
    const fold = mobileNavFoldRef.current;
    const list = mobileNavListRef.current;
    mobileNavFoldRef.current = null;
    if (!fold || !list) return;
    const timing = { duration: NAV_GROUP_FOLD_MS, easing: "cubic-bezier(0.22, 1, 0.36, 1)" };
    const rows = Array.from(list.children) as HTMLElement[];
    for (const row of rows) {
      const before = fold.rects.get(row);
      if (!before) continue;
      const shift = before.top - row.getBoundingClientRect().top;
      if (Math.abs(shift) > 0.5) row.animate([{ transform: `translateY(${shift}px)` }, { transform: "none" }], timing);
    }
    const section = rows.find((row) => row.dataset.mobileNavGroup === fold.group);
    if (!section) return;
    if (fold.opening) {
      section.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 220, easing: "ease" });
      return;
    }
    const was = fold.rects.get(section);
    if (!was || was.height < 1) return;
    const listRect = list.getBoundingClientRect();
    const ghost = section.cloneNode(true) as HTMLElement;
    delete ghost.dataset.mobileNavGroup;
    ghost.setAttribute("aria-hidden", "true");
    ghost.inert = true;
    Object.assign(ghost.style, {
      position: "absolute",
      left: `${was.left - listRect.left}px`,
      top: `${was.top - listRect.top + list.scrollTop}px`,
      width: `${was.width}px`,
      height: `${was.height}px`,
      margin: "0",
      zIndex: "-1",
      pointerEvents: "none",
      gridTemplateRows: "1fr",
    });
    list.appendChild(ghost);
    void ghost
      .animate([{ opacity: 1 }, { opacity: 0 }], { duration: 180, easing: "ease", fill: "forwards" })
      .finished.catch(() => undefined)
      .finally(() => ghost.remove());
  }, [foldedNavGroups]);
  useLayoutEffect(() => {
    const nextMode = readThemeMode();
    setThemeMode(nextMode);
    applyThemeMode(nextMode);
    if (typeof window === "undefined") return;
    const onThemeModeUpdated = (event: Event) => {
      const detail = (event as CustomEvent<{ mode: ThemeMode }>).detail;
      const next = detail?.mode === "dark" ? "dark" : "light";
      setThemeMode(next);
      applyThemeMode(next);
    };
    window.addEventListener(THEME_MODE_UPDATED_EVENT, onThemeModeUpdated as EventListener);
    return () => {
      window.removeEventListener(THEME_MODE_UPDATED_EVENT, onThemeModeUpdated as EventListener);
    };
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const splitFullName = (value: string) => {
      const parts = String(value || "")
        .trim()
        .split(/\s+/)
        .filter(Boolean);
      if (!parts.length) return { firstName: "", lastName: "" };
      if (parts.length === 1) return { firstName: parts[0], lastName: "" };
      return { firstName: parts[0] || "", lastName: parts.slice(1).join(" ") };
    };
    const onOpenNewProject = (event: Event) => {
      if (!canCreateProject) return;
      const detail = (event as CustomEvent<NewProjectPrefillPayload | undefined>).detail ?? {};
      setNewProjectIsSmallJob(false);
      const fallbackName = splitFullName(String(detail.clientName || "").trim());
      const prefilledAssigneeUid = String(detail.assignedToUid || "").trim();
      setProjectName(String(detail.projectName || "").trim());
      setClientFirstName(String(detail.clientFirstName || fallbackName.firstName || "").trim());
      setClientLastName(String(detail.clientLastName || fallbackName.lastName || "").trim());
      setClientPhone(formatMobileLikeDesktop(String(detail.clientPhone || "")));
      setClientEmail(String(detail.clientEmail || "").trim());
      setProjectAddress(String(detail.projectAddress || "").trim());
      setProjectNotes(String(detail.projectNotes || "").trim());
      setSourceLeadId(String(detail.sourceLeadId || "").trim());
      setPrefilledLeadNotes(Array.isArray(detail.leadNotes) ? detail.leadNotes.map((text) => String(text || "").trim()).filter(Boolean) : []);
      setLeadNotesImported(false);
      setSourceLeadCompanyId(String(detail.sourceLeadCompanyId || "").trim());
      setPrefilledLeadCustomFields(
        Array.isArray(detail.leadCustomFields)
          ? detail.leadCustomFields
              .map((field) => ({
                key: String(field?.key || "").trim(),
                label: String(field?.label || "").trim(),
                value: String(field?.value || "").trim(),
              }))
              .filter((field) => field.key && field.value)
          : [],
      );
      setPrefilledProjectImages(
        Array.isArray(detail.projectImageItems) && detail.projectImageItems.length > 0
          ? detail.projectImageItems
              .map((item, idx) => ({
                id: `prefilled_${idx}_${String(item?.url || "").trim()}`,
                url: String(item?.url || "").trim(),
                name: String(item?.name || "").trim(),
                annotations: Array.isArray(item?.annotations)
                  ? item.annotations
                      .map((annotation) => ({
                        id: String(annotation?.id || "").trim(),
                        x: Number(annotation?.x ?? 0),
                        y: Number(annotation?.y ?? 0),
                        xPx: Number.isFinite(Number(annotation?.xPx)) ? Number(annotation?.xPx) : undefined,
                        yPx: Number.isFinite(Number(annotation?.yPx)) ? Number(annotation?.yPx) : undefined,
                        note: String(annotation?.note || "").trim(),
                        createdByName: String(annotation?.createdByName || "").trim(),
                        createdByColor: String(annotation?.createdByColor || "").trim(),
                      }))
                      .filter((annotation) => annotation.id && annotation.note)
                  : [],
              }))
              .filter((item) => item.url)
              .slice(0, 10)
          : Array.isArray(detail.projectImages)
            ? detail.projectImages
                .map((url, idx) => ({
                  id: `prefilled_${idx}_${String(url || "").trim()}`,
                  url: String(url || "").trim(),
                  name: "",
                  annotations: [],
                }))
                .filter((item) => item.url)
                .slice(0, 10)
            : [],
      );
      setProjectFormError("");
      setTagInput("");
      projectFormRunRef.current += 1;
      setTags([]);
      setIsTagInputOpen(false);
      setShowTagSuggestions(false);
      setPhotos([]);
      setEditingProjectPhotoNameKey("");
      setProjectPhotoNameDraft("");
      setPreviewPhotoId("");
      setAssigneeSearch("");
      setAssigneeMenuOpen(false);
      setAssigneeUid(prefilledAssigneeUid);
      setIsNewProjectNotesEditing(false);
      setNewProjectOrigin(null);
      setShowNewProject(true);
    };
    window.addEventListener(OPEN_NEW_PROJECT_EVENT, onOpenNewProject as EventListener);
    return () => {
      window.removeEventListener(OPEN_NEW_PROJECT_EVENT, onOpenNewProject as EventListener);
    };
  }, [canCreateProject]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const onZapierLeadsVisibilityUpdated = (event: Event) => {
      const detail = (event as CustomEvent<{ companyId?: string; enabled?: boolean }>).detail;
      const eventCompanyId = String(detail?.companyId || "").trim();
      const storedCompanyId = String(window.localStorage.getItem(ACTIVE_COMPANY_STORAGE_KEY) || "").trim();
      const directCompanyId = String(user?.companyId || "").trim();
      const activeCompanyId = storedCompanyId || directCompanyId;
      if (!eventCompanyId || !activeCompanyId || eventCompanyId !== activeCompanyId) return;
      const nextEnabled = Boolean(detail?.enabled);
      setIsZapierLeadsEnabled(nextEnabled);
      const cacheKey = buildCompanyAccessCacheKey(activeCompanyId, String(user?.uid || "").trim());
      const existing = readCompanyAccessCache(cacheKey);
      if (existing) {
        writeCompanyAccessCache(cacheKey, {
          role: existing.role,
          permissionKeys: existing.permissionKeys,
          isZapierLeadsEnabled: nextEnabled,
        });
      }
    };
    window.addEventListener(ZAPIER_LEADS_VISIBILITY_UPDATED_EVENT, onZapierLeadsVisibilityUpdated as EventListener);
    return () => {
      window.removeEventListener(ZAPIER_LEADS_VISIBILITY_UPDATED_EVENT, onZapierLeadsVisibilityUpdated as EventListener);
    };
  }, [user?.companyId, user?.uid]);

  // staffOptions (the assignee-picker badges in the New Project modal) is
  // only populated once from fetchCompanyMembers on load — patch it live so
  // a staff member's icon color updates here too without a reload, matching
  // the dashboard/project/company-settings pages.
  useEffect(() => {
    if (typeof window === "undefined") return;
    const onUserColorUpdated = (event: Event) => {
      const detail = (event as CustomEvent<UserColorUpdatedDetail>).detail;
      const uid = String(detail?.uid || "").trim();
      const color = String(detail?.color || "").trim();
      if (!uid) return;
      setStaffOptions((prev) =>
        prev.map((option) => (option.uid === uid ? { ...option, color } : option)),
      );
    };
    window.addEventListener(USER_COLOR_UPDATED_EVENT, onUserColorUpdated as EventListener);
    return () => {
      window.removeEventListener(USER_COLOR_UPDATED_EVENT, onUserColorUpdated as EventListener);
    };
  }, []);

  useLayoutEffect(() => {
    if (typeof window === "undefined") return;
    const storedCompanyId = String(window.localStorage.getItem(ACTIVE_COMPANY_STORAGE_KEY) || "").trim();
    const directCompanyId = String(user?.companyId || "").trim();
    const companyId = storedCompanyId || directCompanyId;
    if (!companyId) return;

    const fromMemory = brandingMemoryCacheByCompany[companyId];
    if (fromMemory) {
      setCompanyThemeColor(fromMemory.themeColor || "#2F6BFF");
      setCompanyLogoPath(fromMemory.logoPath || "");
      setCompanyDisplayName(fromMemory.name || "");
      return;
    }

    try {
      const raw = window.localStorage.getItem(`${COMPANY_BRANDING_CACHE_KEY_PREFIX}${companyId}`);
      if (!raw) return;
      const parsed = JSON.parse(raw) as Record<string, unknown>;
      const themeColor = String(parsed.themeColor || "").trim() || "#2F6BFF";
      const logoPath = String(parsed.logoPath || "").trim();
      const name = String(parsed.name || "").trim();
      setCompanyThemeColor(themeColor);
      setCompanyLogoPath(logoPath);
      setCompanyDisplayName(name);
      brandingMemoryCacheByCompany[companyId] = { themeColor, logoPath, name };
    } catch {
      // ignore cache parse issues
    }
  }, [user?.companyId]);

  useLayoutEffect(() => {
    const uid = String(user?.uid || "").trim();
    const role = String(user?.role || "").trim().toLowerCase();
    const storedCompanyId =
      typeof window !== "undefined" ? String(window.localStorage.getItem(ACTIVE_COMPANY_STORAGE_KEY) || "").trim() : "";
    const directCompanyId = String(user?.companyId || "").trim();
    const companyId = storedCompanyId || directCompanyId;
    if (!uid || !companyId) {
      setEffectiveCompanyRole(role);
      setEffectiveCompanyPermissions(Array.isArray(user?.permissions) ? user.permissions : []);
      return;
    }
    const cached = readCompanyAccessCache(buildCompanyAccessCacheKey(companyId, uid));
    if (!cached) {
      setEffectiveCompanyRole(role);
      setEffectiveCompanyPermissions(Array.isArray(user?.permissions) ? user.permissions : []);
      return;
    }
    setEffectiveCompanyRole(mergeRoleValue(cached.role, role));
    setEffectiveCompanyPermissions(mergePermissionValues(cached.permissionKeys, Array.isArray(user?.permissions) ? user.permissions : []));
    setIsZapierLeadsEnabled(cached.isZapierLeadsEnabled);
  }, [user?.companyId, user?.permissions, user?.role, user?.uid]);

  useEffect(() => {
    const load = async () => {
      const readBrandingCache = (companyId: string) => {
        if (typeof window === "undefined") return null;
        try {
          const raw = window.localStorage.getItem(`${COMPANY_BRANDING_CACHE_KEY_PREFIX}${companyId}`);
          if (!raw) return null;
          const parsed = JSON.parse(raw) as Record<string, unknown>;
          return {
            themeColor: String(parsed.themeColor || "").trim(),
            logoPath: String(parsed.logoPath || "").trim(),
            name: String(parsed.name || "").trim(),
          };
        } catch {
          return null;
        }
      };
      const writeBrandingCache = (companyId: string, payload: { themeColor: string; logoPath: string; name: string }) => {
        if (typeof window === "undefined") return;
        try {
          window.localStorage.setItem(
            `${COMPANY_BRANDING_CACHE_KEY_PREFIX}${companyId}`,
            JSON.stringify(payload),
          );
        } catch {
          // ignore storage write issues
        }
      };
      const storedCompanyId =
        typeof window !== "undefined" ? String(window.localStorage.getItem(ACTIVE_COMPANY_STORAGE_KEY) || "").trim() : "";
      const directCompanyId = String(user?.companyId || "").trim();
      const fallbackMembership = !directCompanyId && user?.uid ? await fetchPrimaryMembership(user.uid) : null;
      const companyId = storedCompanyId || directCompanyId || String(fallbackMembership?.companyId || "").trim();
      if (!companyId) return;
      const accessCacheKey = buildCompanyAccessCacheKey(companyId, String(user?.uid || "").trim());
      if (typeof window !== "undefined") {
        if (!storedCompanyId) {
          window.localStorage.setItem(ACTIVE_COMPANY_STORAGE_KEY, companyId);
        }
      }
      const memoryBranding = brandingMemoryCacheByCompany[companyId];
      if (memoryBranding) {
        setCompanyThemeColor(memoryBranding.themeColor || "#2F6BFF");
        setCompanyLogoPath(memoryBranding.logoPath || "");
        setCompanyDisplayName(memoryBranding.name || "Company");
      }
      const cachedBranding = readBrandingCache(companyId);
      if (cachedBranding) {
        if (cachedBranding.themeColor) setCompanyThemeColor(cachedBranding.themeColor);
        setCompanyLogoPath(cachedBranding.logoPath);
        setCompanyDisplayName(cachedBranding.name || "Company");
        brandingMemoryCacheByCompany[companyId] = {
          themeColor: cachedBranding.themeColor || "#2F6BFF",
          logoPath: cachedBranding.logoPath || "",
          name: cachedBranding.name || "Company",
        };
      }
      const doc = await fetchCompanyDoc(companyId);
      const color = String((doc as Record<string, unknown> | null)?.themeColor ?? "").trim();
      const integrations =
        doc && typeof (doc as Record<string, unknown>).integrations === "object"
          ? ((doc as Record<string, unknown>).integrations as Record<string, unknown>)
          : {};
      const zapierLeadsDoc =
        integrations.zapierLeads && typeof integrations.zapierLeads === "object"
          ? (integrations.zapierLeads as Record<string, unknown>)
          : {};
      const nextIsZapierLeadsEnabled = Boolean(zapierLeadsDoc.enabled);
      setIsZapierLeadsEnabled(nextIsZapierLeadsEnabled);
      if (color) {
        setCompanyThemeColor(color);
      }
      const logoPath = String((doc as Record<string, unknown> | null)?.logoPath ?? "").trim();
      setCompanyLogoPath(logoPath);
      // The company's currency / measurement unit / date format, used by every price, length and
      // date in the app (lib/company-formats.ts).
      if (doc) {
        const docRecord = doc as Record<string, unknown>;
        setActiveCompanyFormats({ currency: docRecord.defaultCurrency, unit: docRecord.measurementUnit, dateFormat: docRecord.dateFormat });
      }
      const name = String((doc as Record<string, unknown> | null)?.name ?? "").trim();
      setCompanyDisplayName(name || "Company");
      writeBrandingCache(companyId, {
        themeColor: color || "#2F6BFF",
        logoPath,
        name: name || "Company",
      });
      brandingMemoryCacheByCompany[companyId] = {
        themeColor: color || "#2F6BFF",
        logoPath,
        name: name || "Company",
      };
      const existingAccessCache = readCompanyAccessCache(accessCacheKey);
      if (existingAccessCache) {
        writeCompanyAccessCache(accessCacheKey, {
          role: existingAccessCache.role,
          permissionKeys: existingAccessCache.permissionKeys,
          isZapierLeadsEnabled: nextIsZapierLeadsEnabled,
        });
      }
    };
    void load();
  }, [user?.companyId, user?.uid]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const uid = String(user?.uid || "").trim();
    if (!uid) {
      setUpdateNoticeVersion("");
      setUpdateNoticeText("");
      setShowUpdateNotice(false);
      return;
    }
    let cancelled = false;
    const loadUpdateNotes = async () => {
      try {
        const res = await fetch("/release-notes.txt", { cache: "no-store" });
        if (!res.ok) throw new Error(`Failed to load update notes (${res.status})`);
        const raw = await res.text();
        if (cancelled) return;
        const parsed = parseUpdateNotesText(raw);
        const version = String(parsed.version || "").trim();
        const whatsNew = String(parsed.whatsNew || "").trim();
        const storedCompanyId =
          typeof window !== "undefined"
            ? String(window.localStorage.getItem(ACTIVE_COMPANY_STORAGE_KEY) || "").trim()
            : "";
        const directCompanyId = String(user?.companyId || "").trim();
        const fallbackMembership = !directCompanyId && uid ? await fetchPrimaryMembership(uid) : null;
        const companyId = storedCompanyId || directCompanyId || String(fallbackMembership?.companyId || "").trim();
        if (version) {
          const existing = await fetchAppChangelogHistory();
          if (cancelled) return;
          const matched = existing.find(
            (row) => String(row.version || "").trim().toLowerCase() === version.toLowerCase(),
          );
          // Not published yet — a draft. Only Dev users see it (to preview and publish, from the What's New
          // page); for everyone else nothing changes until a Dev publishes it (lib/app-version-server.ts).
          if (!matched) {
            setDraftUpdate({ version, whatsNew, highlights: parsed.highlights });
            setUpdateNoticeVersion("");
            setShowUpdateNotice(false);
            return;
          }
          setDraftUpdate(null);
          setUpdateNoticeVersion(version);
          setUpdateNoticeText(String(matched.whatsNew || whatsNew || "").trim());
          setUpdateNoticeHighlights(matched.highlights ?? []);
          setUpdateNoticeDateIso(matched.publishedAtIso || matched.capturedAtIso || "");
        } else {
          setUpdateNoticeVersion("");
          setUpdateNoticeText(whatsNew);
        }
        if (version) {
          // App-wide cleanup: completed reports/features are removed once per new version.
          await cleanupCompletedReportsForNewVersion(version);
        }
        if (!version) {
          setShowUpdateNotice(false);
          return;
        }
        const seenKey = `${UPDATE_NOTICE_SEEN_STORAGE_KEY_PREFIX}${uid}_${version}`;
        const seenOnDevice = window.localStorage.getItem(seenKey) === "1";
        const seenVersions = await fetchUserUpdateNoticeSeenVersions(uid, companyId);
        if (cancelled) return;
        const seenInAccount = seenVersions.some(
          (item) => String(item || "").trim().toLowerCase() === version.toLowerCase(),
        );
        if (!seenInAccount && seenOnDevice) {
          await markUserUpdateNoticeSeen(uid, companyId, version);
          if (cancelled) return;
        }
        const seen = seenInAccount || seenOnDevice;
        if (seen) {
          window.localStorage.setItem(seenKey, "1");
        } else {
          // Shown once, then never again by itself — it counts as seen the moment it opens (on this device and the
          // account), not only once it's been closed, so however it's left (closed, the page left or reloaded
          // under it) it doesn't open again on the next page.
          window.localStorage.setItem(seenKey, "1");
          void markUserUpdateNoticeSeen(uid, companyId, version);
        }
        setShowUpdateNotice(!seen);
      } catch {
        if (cancelled) return;
        setUpdateNoticeVersion("");
        setUpdateNoticeText("");
        setShowUpdateNotice(false);
      }
    };
    // Not urgent (the "what's new" notice, changelog sync and per-version cleanup are ~5 requests one
    // after another) — wait until the page itself has had a few seconds to load.
    const startTimer = window.setTimeout(() => void loadUpdateNotes(), 3000);
    return () => {
      cancelled = true;
      window.clearTimeout(startTimer);
    };
  }, [user?.uid, user?.companyId]);

  // Who's marking projects complete, for the completed-projects record's "Marked by" (lib/completed-projects.ts).
  useEffect(() => {
    const uid = String(user?.uid || "").trim();
    setCompletionActor(uid ? { uid, name: String(user?.displayName || user?.email || "").trim() } : null);
  }, [user?.displayName, user?.email, user?.uid]);

  // Moves the active company's finished projects into Archived once they're past Company Settings'
  // archive delay. There's no server scheduler, so it runs from here, in the background a few seconds
  // after load; archiveDueCompletedProjects itself limits it to once a day per company on this device
  // and to people who can edit every project.
  useEffect(() => {
    const uid = String(user?.uid || "").trim();
    if (!uid || !user?.verified || typeof window === "undefined") return;
    const storedCompanyId = String(window.localStorage.getItem(ACTIVE_COMPANY_STORAGE_KEY) || "").trim();
    const companyId = storedCompanyId || String(user?.companyId || "").trim();
    if (!companyId) return;
    const timer = window.setTimeout(() => {
      void archiveDueCompletedProjects(companyId, uid).catch(() => {});
    }, 4000);
    return () => window.clearTimeout(timer);
  }, [user?.companyId, user?.uid, user?.verified]);

  useEffect(() => {
    let cancelled = false;
    const loadCompanyAccess = async () => {
      const storedCompanyId =
        typeof window !== "undefined" ? String(window.localStorage.getItem(ACTIVE_COMPANY_STORAGE_KEY) || "").trim() : "";
      const directCompanyId = String(user?.companyId || "").trim();
      const primaryMembership = user?.uid ? await fetchPrimaryMembership(user.uid) : null;
      const fallbackMembership = !directCompanyId ? primaryMembership : null;
      const companyId = storedCompanyId || directCompanyId || String(fallbackMembership?.companyId || "").trim();
      if (!user?.uid || !companyId) {
        if (!cancelled) {
          setEffectiveCompanyRole(
            mergeRoleValue(
              String(primaryMembership?.role || "").trim().toLowerCase(),
              String(user?.role || "").trim().toLowerCase(),
            ),
          );
          setEffectiveCompanyPermissions(
            mergePermissionValues(
              primaryMembership?.permissionKeys,
              Array.isArray(user?.permissions) ? user.permissions : [],
            ),
          );
        }
        return;
      }
      const companyDoc = await fetchCompanyDoc(companyId);
      const roleDerivedPermissions = extractRolePermissionKeys(companyDoc as Record<string, unknown> | null, [
        primaryMembership?.roleId,
        primaryMembership?.role,
        user?.role,
      ]);
      const cacheKey = buildCompanyAccessCacheKey(companyId, user.uid);
      const cached = readCompanyAccessCache(cacheKey);
      if (cached && !cancelled) {
        setEffectiveCompanyRole(
          mergeRoleValue(
            cached.role,
            mergeRoleValue(
              String(primaryMembership?.role || "").trim().toLowerCase(),
              String(user?.role || "").trim().toLowerCase(),
            ),
          ),
        );
        setEffectiveCompanyPermissions(
          mergePermissionValues(
            cached.permissionKeys,
            mergePermissionValues(
              roleDerivedPermissions,
              mergePermissionValues(
                primaryMembership?.permissionKeys,
                Array.isArray(user?.permissions) ? user.permissions : [],
              ),
            ),
          ),
        );
        setIsZapierLeadsEnabled(cached.isZapierLeadsEnabled);
      }
      const companyAccess = await fetchCompanyAccess(companyId, user.uid);
      if (cancelled) return;
      const accessRoleDerivedPermissions = extractRolePermissionKeys(companyDoc as Record<string, unknown> | null, [
        companyAccess?.roleId,
        companyAccess?.role,
        primaryMembership?.roleId,
        primaryMembership?.role,
        user?.role,
      ]);
      const nextRole = mergeRoleValue(
        String(companyAccess?.role || "").trim().toLowerCase(),
        mergeRoleValue(
          String(primaryMembership?.role || "").trim().toLowerCase(),
          String(user?.role || "").trim().toLowerCase(),
        ),
      );
      const nextPermissions = mergePermissionValues(
        companyAccess?.permissionKeys,
        mergePermissionValues(
          accessRoleDerivedPermissions,
          mergePermissionValues(
            primaryMembership?.permissionKeys,
            Array.isArray(user?.permissions) ? user.permissions : [],
          ),
        ),
      );
      setEffectiveCompanyRole(nextRole);
      setEffectiveCompanyPermissions(nextPermissions);
      writeCompanyAccessCache(cacheKey, {
        role: nextRole,
        permissionKeys: nextPermissions,
        isZapierLeadsEnabled: isZapierLeadsEnabledRef.current,
      });
    };
    void loadCompanyAccess();
    return () => {
      cancelled = true;
    };
  }, [user?.companyId, user?.permissions, user?.role, user?.uid]);

  useEffect(() => {
    const openNewProject = (e: Event) => {
      if (!canCreateProject) {
        return;
      }
      const detail = (e as CustomEvent<{ origin?: GlassModalOrigin; smallJob?: boolean }>).detail;
      setAssigneeUid("");
      setNewProjectIsSmallJob(detail?.smallJob === true);
      setNewProjectOrigin(detail?.origin ?? null);
      setShowNewProject(true);
    };
    window.addEventListener(NEW_PROJECT_EVENT, openNewProject as EventListener);
    return () => {
      window.removeEventListener(NEW_PROJECT_EVENT, openNewProject as EventListener);
    };
  }, [canCreateProject]);

  useEffect(() => {
      if (!showNewProject) {
        setAssigneeMenuOpen(false);
        setAssigneeSearch("");
        setCompanyTagSuggestions([]);
        setDefaultProjectStatus("New");
        setNewProjectIsSmallJob(false);
        setDefaultQuoteExtras([]);
        setDefaultGapAllowancesSettings(normalizeGapAllowancesSettings(null));
        return;
      }
    const load = async () => {
      const storedCompanyId =
        typeof window !== "undefined"
          ? String(window.localStorage.getItem(ACTIVE_COMPANY_STORAGE_KEY) || "").trim()
          : "";
      const directCompanyId = String(user?.companyId || "").trim();
        const fallbackMembership = !directCompanyId && user?.uid ? await fetchPrimaryMembership(user.uid) : null;
        const companyId = storedCompanyId || directCompanyId || String(fallbackMembership?.companyId || "").trim();
        if (!companyId) {
          setStaffOptions([]);
          setDefaultGapAllowancesSettings(normalizeGapAllowancesSettings(null));
          return;
        }
      const [companyDocData, members] = await Promise.all([
        fetchCompanyDoc(companyId),
        canCreateForOthers ? fetchCompanyMembers(companyId) : Promise.resolve([]),
      ]);

      const statusRows = Array.isArray((companyDocData as Record<string, unknown> | null)?.projectStatuses)
        ? ((companyDocData as Record<string, unknown>).projectStatuses as Array<Record<string, unknown>>)
        : [];
      const firstStatusName =
        String((statusRows[0] as Record<string, unknown> | undefined)?.name || "").trim() || "New";
      setDefaultProjectStatus(firstStatusName);
      setDefaultProjectStatusColor(String((statusRows[0] as Record<string, unknown> | undefined)?.color || "").trim() || "#64748B");
      const firstSmallJobStatus = normalizeSmallJobStatuses((companyDocData as Record<string, unknown> | null)?.smallJobStatuses)[0];
      setDefaultSmallJobStatus(firstSmallJobStatus?.name || "Open");
      setDefaultSmallJobStatusColor(firstSmallJobStatus?.color || "#16A34A");
      const rawContactCategories = (companyDocData as Record<string, unknown> | null)?.contactCategories;
      setContactCategoryColors(
        Object.fromEntries(
          (Array.isArray(rawContactCategories) ? rawContactCategories : [])
            .filter((row): row is Record<string, unknown> => Boolean(row) && typeof row === "object")
            .map((row) => [String(row.name ?? "").trim(), String(row.color ?? "").trim() || "#7D99B3"])
            .filter(([name]) => name),
        ),
      );

      const tagUsage = (companyDocData as Record<string, unknown> | null)?.projectTagUsage;
      const rawTags =
        tagUsage && typeof tagUsage === "object" && Array.isArray((tagUsage as Record<string, unknown>).tags)
          ? ((tagUsage as Record<string, unknown>).tags as unknown[])
          : [];
      const parsedSuggestions = rawTags
        .map((item) => {
          if (!item || typeof item !== "object") return { value: "", count: 0 };
          const row = item as Record<string, unknown>;
          return {
            value: String(row.value ?? "").trim(),
            count: Number(row.count ?? 0),
          };
        })
        .filter((item) => item.value);
      parsedSuggestions.sort((a, b) => b.count - a.count || a.value.localeCompare(b.value));
      setCompanyTagSuggestions(parsedSuggestions.map((item) => item.value));

      const rawQuoteExtras = Array.isArray((companyDocData as Record<string, unknown> | null)?.quoteExtras)
        ? (((companyDocData as Record<string, unknown>).quoteExtras as unknown[]) ?? [])
        : [];
        const defaultExtras = rawQuoteExtras
          .map((item) => (item && typeof item === "object" ? (item as Record<string, unknown>) : null))
          .filter((item) => !!item)
          .filter((item) => Boolean(item?.defaultIncluded ?? item?.default))
          .map((item) => String(item?.id ?? item?.name ?? "").trim())
          .filter(Boolean);
        setDefaultQuoteExtras(Array.from(new Set(defaultExtras)));
        setDefaultGapAllowancesSettings(
          normalizeGapAllowancesSettings((companyDocData as Record<string, unknown> | null)?.gapAllowancesSettings),
        );

      if (canCreateForOthers) {
        const options = members.map((m) => {
          const memberLike = m as typeof m & { badgeColor?: string; userColor?: string };
          return {
            uid: String(m.uid || "").trim(),
            name: String(m.displayName || m.email || m.uid || "Unknown").trim(),
            email: String(m.email || "").trim(),
            color: String(memberLike.badgeColor || memberLike.userColor || "").trim(),
          };
        });
        setStaffOptions(options);
      } else {
        setStaffOptions([]);
      }
    };
    void load();
  }, [showNewProject, user?.companyId, user?.uid, canCreateForOthers]);

  useEffect(() => {
    if (typeof document === "undefined") return;
    if (showNewProject) {
      document.body.classList.add("new-project-open");
    } else {
      document.body.classList.remove("new-project-open");
    }
    return () => {
      document.body.classList.remove("new-project-open");
    };
  }, [showNewProject]);

  // New Project's floating menus (Assign to's, the contacts a client's details match) close as the pop-up scrolls or the
  // window's resized — they're placed at what opened them, so they'd be left behind. (Not for their own lists
  // scrolling, or a text box's.)
  useEffect(() => {
    if (!assigneeMenuOpen && !contactSuggestField) return;
    const close = (event: Event) => {
      const target = event.target as Node | null;
      if (event.type === "scroll" && target) {
        if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement) return;
        if (assigneeMenuRef.current?.contains(target) || contactSuggestRef.current?.contains(target)) return;
      }
      setAssigneeMenuOpen(false);
      setContactSuggestField("");
    };
    window.addEventListener("resize", close);
    window.addEventListener("scroll", close, true);
    return () => {
      window.removeEventListener("resize", close);
      window.removeEventListener("scroll", close, true);
    };
  }, [assigneeMenuOpen, contactSuggestField]);

  // A press anywhere outside the "Assign Project To" field (its button + list) closes the list — and
  // only closes it, without also acting on whatever the press landed on.
  useEffect(() => {
    if (!assigneeMenuOpen) return;
    const onPointerDown = (event: PointerEvent) => {
      if (assigneeFieldRef.current?.contains(event.target as Node) || assigneeMenuRef.current?.contains(event.target as Node)) return;
      setAssigneeMenuOpen(false);
      swallowNextClick();
    };
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, [assigneeMenuOpen]);

  useEffect(() => {
    setMobileNavOpen(false);
  }, [pathname]);

  // Top tab bar entries are project-only. Project routes self-register their
  // live tab data directly via useAppTabs() (see app/(app)/projects/[projectId]/page.tsx)
  // since it depends on page-local state a shared layout can't see; every other
  // route never registers a tab, so this shell no longer touches the tab context.

  // iOS Safari treats a horizontal swipe that starts at the very left/right edge of the screen as
  // Back/Forward navigation and slides in its saved snapshot of that page — which, when you last left
  // that page by tapping a link in this drawer, is a picture of this same drawer. Swiping left to close
  // the drawer from near the right edge was therefore sliding in what looked like a second copy of the
  // nav. Cancelling the touchstart in those edge strips stops Safari claiming the gesture (it needs a
  // non-passive native listener — React's touch listeners are passive); the drawer's own swipe-to-close
  // still gets the touchmove/touchend that follow. Taps on real controls in the strip are left alone.
  useEffect(() => {
    const panel = mobileNavPanelRef.current;
    if (!panel) return;
    const EDGE_STRIP_PX = 20;
    const onTouchStart = (event: TouchEvent) => {
      const touch = event.touches[0];
      if (!touch || event.touches.length > 1) return;
      const nearEdge = touch.clientX <= EDGE_STRIP_PX || touch.clientX >= window.innerWidth - EDGE_STRIP_PX;
      if (!nearEdge) return;
      if ((event.target as HTMLElement | null)?.closest("a, button, input, textarea, select, [role='button']")) return;
      event.preventDefault();
    };
    panel.addEventListener("touchstart", onTouchStart, { passive: false });
    return () => panel.removeEventListener("touchstart", onTouchStart);
  }, [effectiveHideSidebar]);

  useEffect(() => {
    if (typeof document === "undefined") return;
    // Tied to shouldRenderMobileNav (not the raw mobileNavOpen) so the page behind doesn't
    // unlock and potentially jump while the drawer is still visibly sliding closed.
    if (shouldRenderMobileNav) {
      document.body.style.overflow = "hidden";
    } else {
      document.body.style.overflow = "";
    }
    return () => {
      document.body.style.overflow = "";
    };
  }, [shouldRenderMobileNav]);

  useLayoutEffect(() => {
    const measure = () => {
      const container = navListRef.current;
      const activeHref = visibleTopNav.find((item) => pathname?.startsWith(item.href))?.href;
      const el = activeHref ? navLinkRefs.current[activeHref] : null;
      if (!container || !el) {
        setNavHighlightRect(null);
        return;
      }
      const containerRect = container.getBoundingClientRect();
      const elRect = el.getBoundingClientRect();
      const next = {
        top: elRect.top - containerRect.top + container.scrollTop,
        height: elRect.height,
        folded: Boolean(el.closest("[data-nav-folded='true']")),
      };
      // Unchanged (nearly every window resize, and iOS toolbar show/hide) → keep the same object, so
      // the whole app shell doesn't re-render for nothing.
      setNavHighlightRect((prev) => (prev && prev.top === next.top && prev.height === next.height && prev.folded === next.folded ? prev : next));
    };
    measure();
    if (typeof window === "undefined") return;
    window.addEventListener("resize", measure);
    return () => window.removeEventListener("resize", measure);
    // (Again as the sidebar folds to icons or opens out: its sections' names swap for lines, moving the pages. And as
    // a section's folded or opened — straight away for whether its page is folded away, again once it's settled.)
  }, [pathname, visibleTopNav, isSidebarIconOnlyContent, foldedNavGroups, navLayoutTick]);

  useEffect(() => {
    if (typeof document === "undefined") return;
    if (!showUpdateNotice && !showNewProject) return;
    const prevHtmlOverflow = document.documentElement.style.overflow;
    const prevBodyOverflow = document.body.style.overflow;
    document.documentElement.style.overflow = "hidden";
    // clip, not hidden — a hidden <body> under a hidden <html> becomes a scroll container, and sticky bars
    // stick to it instead of the window (globals.css, html.cs-scroll-locked body).
    document.body.style.overflow = "clip";
    return () => {
      document.documentElement.style.overflow = prevHtmlOverflow;
      document.body.style.overflow = prevBodyOverflow;
    };
  }, [showNewProject, showUpdateNotice]);

  useEffect(() => {
    return () => {
      if (previewTimerRef.current) {
        window.clearTimeout(previewTimerRef.current);
      }
      if (previewCloseRafRef.current) {
        window.cancelAnimationFrame(previewCloseRafRef.current);
      }
    };
  }, []);

  useEffect(() => {
    if (previewCloseRafRef.current) {
      window.cancelAnimationFrame(previewCloseRafRef.current);
      previewCloseRafRef.current = null;
    }
    if (previewAnim?.phase === "open") {
      setPreviewClosePopped(false);
      previewCloseRafRef.current = window.requestAnimationFrame(() => {
        previewCloseRafRef.current = window.requestAnimationFrame(() => {
          setPreviewClosePopped(true);
          previewCloseRafRef.current = null;
        });
      });
      return;
    }
    setPreviewClosePopped(false);
  }, [previewAnim?.phase]);

  // A draft's preview (Dev users): opened from the button below or the Changelog page — re-reading the notes
  // first, so it always shows the latest (they're often being edited while it's previewed).
  useEffect(() => {
    const onOpenDraft = () => {
      void fetch("/release-notes.txt", { cache: "no-store" })
        .then((res) => (res.ok ? res.text() : ""))
        .then((raw) => {
          const parsed = parseUpdateNotesText(raw);
          const version = String(parsed.version || "").trim();
          if (!version) return;
          setDraftUpdate((prev) =>
            prev && prev.version.toLowerCase() === version.toLowerCase()
              ? { version, whatsNew: String(parsed.whatsNew || "").trim(), highlights: parsed.highlights }
              : prev,
          );
        })
        .catch(() => undefined)
        .finally(() => {
          setWhatsNewIsDraft(true);
          setShowUpdateNotice(true);
        });
    };
    window.addEventListener(OPEN_WHATS_NEW_DRAFT_EVENT, onOpenDraft);
    return () => window.removeEventListener(OPEN_WHATS_NEW_DRAFT_EVENT, onOpenDraft);
  }, []);
  useEffect(() => {
    if (!isDevUser) return;
    let cancelled = false;
    const load = () =>
      void fetchPublishStatus().then((status) => {
        if (!cancelled) setWaitingPublish(status?.waiting ?? null);
      });
    load();
    window.addEventListener(APP_VERSION_SCHEDULE_CHANGED_EVENT, load);
    window.addEventListener(APP_VERSION_PUBLISHED_EVENT, load);
    return () => {
      cancelled = true;
      window.removeEventListener(APP_VERSION_SCHEDULE_CHANGED_EVENT, load);
      window.removeEventListener(APP_VERSION_PUBLISHED_EVENT, load);
    };
  }, [isDevUser]);

  // A published version's What's New page on demand — its "New version" notification (the bell's, or a
  // push's ?whats-new=<version> link). That version, or the newest if it can't be found.
  useEffect(() => {
    const onOpen = (event: Event) => {
      const wanted = String((event as CustomEvent<{ version?: string }>).detail?.version || "").trim().toLowerCase();
      void fetchAppChangelogHistory().then((history) => {
        const entry = history.find((row) => row.version.trim().toLowerCase() === wanted) ?? history[0];
        if (!entry) return;
        setUpdateNoticeVersion(entry.version);
        setUpdateNoticeText(String(entry.whatsNew || "").trim());
        setUpdateNoticeHighlights(entry.highlights ?? []);
        setUpdateNoticeDateIso(entry.publishedAtIso || entry.capturedAtIso || "");
        setWhatsNewIsDraft(false);
        setShowUpdateNotice(true);
      });
    };
    window.addEventListener(OPEN_WHATS_NEW_EVENT, onOpen);
    return () => window.removeEventListener(OPEN_WHATS_NEW_EVENT, onOpen);
  }, []);
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const version = params.get(WHATS_NEW_URL_PARAM);
    if (version === null) return;
    // Taken back out of the address, so a reload doesn't open it again.
    params.delete(WHATS_NEW_URL_PARAM);
    const rest = params.toString();
    window.history.replaceState(window.history.state, "", `${window.location.pathname}${rest ? `?${rest}` : ""}${window.location.hash}`);
    window.dispatchEvent(new CustomEvent(OPEN_WHATS_NEW_EVENT, { detail: { version } }));
  }, [pathname]);

  const onDraftPublished = () => {
    draftPublishedRef.current = true;
    window.dispatchEvent(new Event(APP_VERSION_PUBLISHED_EVENT));
  };
  const closeDraftPreview = () => {
    setShowUpdateNotice(false);
    setWhatsNewIsDraft(false);
    if (!draftPublishedRef.current || !previewDraft) return;
    draftPublishedRef.current = false;
    const published = previewDraft;
    if (draftUpdate?.version === published.version) setDraftUpdate(null);
    if (waitingPublish?.version === published.version) setWaitingPublish(null);
    setUpdateNoticeVersion(published.version);
    setUpdateNoticeText(published.whatsNew);
    setUpdateNoticeHighlights(published.highlights);
    setUpdateNoticeDateIso(new Date().toISOString());
    const uid = String(user?.uid || "").trim();
    if (uid) {
      try {
        window.localStorage.setItem(`${UPDATE_NOTICE_SEEN_STORAGE_KEY_PREFIX}${uid}_${published.version}`, "1");
      } catch {
        // Saved on the account below anyway.
      }
      const companyId = String(window.localStorage.getItem(ACTIVE_COMPANY_STORAGE_KEY) || user?.companyId || "").trim();
      void markUserUpdateNoticeSeen(uid, companyId, published.version);
    }
  };

  const dismissUpdateNotice = () => {
    const version = String(updateNoticeVersion || "").trim();
    const uid = String(user?.uid || "").trim();
    if (typeof window !== "undefined") {
      if (version && uid) {
        window.localStorage.setItem(`${UPDATE_NOTICE_SEEN_STORAGE_KEY_PREFIX}${uid}_${version}`, "1");
      }
    }
    setShowUpdateNotice(false);
    if (version && uid) {
      void (async () => {
        const storedCompanyId =
          typeof window !== "undefined"
            ? String(window.localStorage.getItem(ACTIVE_COMPANY_STORAGE_KEY) || "").trim()
            : "";
        const directCompanyId = String(user?.companyId || "").trim();
        const fallbackMembership = !directCompanyId ? await fetchPrimaryMembership(uid) : null;
        const companyId = storedCompanyId || directCompanyId || String(fallbackMembership?.companyId || "").trim();
        await markUserUpdateNoticeSeen(uid, companyId, version);
      })();
    }
  };

  // Gates the New Project modal's click-off-to-close — once any field actually has something in
  // it, an accidental click on the backdrop shouldn't silently discard it.
  const hasNewProjectFormContent = () =>
    Boolean(
      projectName.trim() ||
        clientFirstName.trim() ||
        clientLastName.trim() ||
        clientPhone.trim() ||
        clientEmail.trim() ||
        projectAddress.trim() ||
        projectNotes.trim() ||
        tags.length > 0 ||
        photos.length > 0,
    );

  const resetProjectForm = () => {
    projectFormRunRef.current += 1;
    for (const photo of photos) {
      try {
        URL.revokeObjectURL(photo.previewUrl);
      } catch {
        // ignore
      }
      }
      setProjectName("");
      setClientFirstName("");
      setClientLastName("");
      setClientPhone("");
      setClientEmail("");
    setProjectAddress("");
    setProjectNotes("");
    setIsNewProjectNotesEditing(false);
    setTagInput("");
    setTags([]);
    setIsTagInputOpen(false);
    setShowTagSuggestions(false);
    setPhotos([]);
    setPrefilledProjectImages([]);
    setSourceLeadId("");
    setSourceLeadCompanyId("");
    setPrefilledLeadCustomFields([]);
    setPrefilledLeadNotes([]);
    setLeadNotesImported(false);
    setPreviewPhotoId("");
    setPreviewAnim(null);
    setPreviewBackdropOpacity(0);
    setPreviewClosePopped(false);
    setAssigneeSearch("");
    setAssigneeMenuOpen(false);
      setProjectFormError("");
      setNewProjectInvalidField("");
      setIsNewProjectPhotoDragOver(false);
      setNewProjectContacts(null);
      setNewProjectContact(null);
      setContactSuggestField("");
      setCompanyTagSuggestions([]);
      setDefaultProjectStatus("New");
      setDefaultQuoteExtras([]);
      setDefaultGapAllowancesSettings(normalizeGapAllowancesSettings(null));
    };

  const addTag = (raw: string) => {
    const next = normalizeTagValue(raw);
    if (!next) return false;
    let added = false;
    setTags((prev) => {
      const lower = new Set(prev.map((v) => v.toLowerCase()));
      if (lower.has(next.toLowerCase())) return prev;
      added = true;
      return [...prev, next].slice(0, 5);
    });
    setTagInput("");
    return added;
  };

  // Undone, it's back where it was (unless it's been typed in again since).
  const removeTag = (tag: string) => {
    const at = tags.indexOf(tag);
    setTags((prev) => prev.filter((t) => t !== tag));
    if (at < 0) return;
    const run = projectFormRunRef.current;
    offerUndo(`${tag} tag removed`, () => {
      if (projectFormRunRef.current !== run) return;
      setTags((prev) => (prev.some((t) => t.toLowerCase() === tag.toLowerCase()) ? prev : [...prev.slice(0, at), tag, ...prev.slice(at)].slice(0, 5)));
    });
  };

  const imageAspectRatioFromFile = async (file: File): Promise<number> => {
    try {
      const blobUrl = URL.createObjectURL(file);
      const ratio = await new Promise<number>((resolve) => {
        const img = new Image();
        img.onload = () => {
          const w = Number(img.naturalWidth || 0);
          const h = Number(img.naturalHeight || 0);
          URL.revokeObjectURL(blobUrl);
          if (w > 0 && h > 0) {
            resolve(w / h);
          } else {
            resolve(1);
          }
        };
        img.onerror = () => {
          URL.revokeObjectURL(blobUrl);
          resolve(1);
        };
        img.src = blobUrl;
      });
      return Number.isFinite(ratio) && ratio > 0 ? ratio : 1;
    } catch {
      return 1;
    }
  };

  const addPhotoFiles = async (fileList: FileList | null) => {
    if (!fileList) return;
    const incoming = Array.from(fileList).filter((f) => f.type.startsWith("image/"));
    if (!incoming.length) return;
    const base = Date.now();
    const prepared = await Promise.all(
      incoming.map(async (file, idx) => {
        const previewUrl = URL.createObjectURL(file);
        const aspectRatio = await imageAspectRatioFromFile(file);
        return {
          id: `${base}_${idx}_${Math.random().toString(36).slice(2, 8)}`,
          file,
          previewUrl,
          aspectRatio,
          name: "",
        } as LocalPhoto;
      }),
    );
    setPhotos((prev) => {
      const room = Math.max(0, 10 - prefilledProjectImages.length - prev.length);
      return [...prev, ...prepared.slice(0, room)];
    });
  };

  const removePrefilledProjectImage = (id: string) => {
    const at = prefilledProjectImages.findIndex((image) => image.id === id);
    const removed = prefilledProjectImages[at];
    setPrefilledProjectImages((prev) => prev.filter((image) => image.id !== id));
    if (!removed) return;
    const run = projectFormRunRef.current;
    offerUndo(`${removed.name || "Photo"} removed`, () => {
      if (projectFormRunRef.current !== run) return;
      setPrefilledProjectImages((prev) => (prev.some((image) => image.id === id) ? prev : [...prev.slice(0, at), removed, ...prev.slice(at)]));
    });
  };

  // Its preview's let go only once the Undo bar's gone without Undo (its commit) — until then, it's what Undo puts back.
  const removePhoto = (id: string) => {
    const at = photos.findIndex((p) => p.id === id);
    const found = photos[at];
    setPhotos((prev) => prev.filter((p) => p.id !== id));
    setPreviewPhotoId((prev) => (prev === id ? "" : prev));
    setPreviewAnim((prev) => (prev?.id === id ? null : prev));
    if (!found) return;
    const run = projectFormRunRef.current;
    const letGo = () => {
      try {
        URL.revokeObjectURL(found.previewUrl);
      } catch {
        // ignore
      }
    };
    offerUndo(
      `${found.name || "Photo"} removed`,
      () => {
        if (projectFormRunRef.current !== run) return letGo();
        setPhotos((prev) => (prev.some((p) => p.id === id) ? prev : [...prev.slice(0, at), found, ...prev.slice(at)]));
      },
      { commit: letGo },
    );
  };

  const beginEditProjectPhotoName = (key: string, currentName: string) => {
    setEditingProjectPhotoNameKey(key);
    setProjectPhotoNameDraft(String(currentName || "").trim());
  };

  const commitProjectPhotoNameEdit = () => {
    const editKey = String(editingProjectPhotoNameKey || "").trim();
    if (!editKey) return;
    const nextName = String(projectPhotoNameDraft || "").trim();
    if (editKey.startsWith("prefilled:")) {
      const targetId = editKey.slice("prefilled:".length);
      setPrefilledProjectImages((prev) =>
        prev.map((image) => (image.id === targetId ? { ...image, name: nextName } : image)),
      );
    } else if (editKey.startsWith("local:")) {
      const targetId = editKey.slice("local:".length);
      setPhotos((prev) => prev.map((photo) => (photo.id === targetId ? { ...photo, name: nextName } : photo)));
    }
    setEditingProjectPhotoNameKey("");
    setProjectPhotoNameDraft("");
  };

  const previewPhoto = useMemo(
    () => photos.find((p) => p.id === previewPhotoId) ?? null,
    [photos, previewPhotoId],
  );

  const computePreviewTargetRect = (photo: LocalPhoto): PreviewRect | null => {
    const panelRect = previewPanelRef.current?.getBoundingClientRect();
    if (!panelRect) return null;
    const pad = 24;
    const availableWidth = Math.max(1, panelRect.width - pad * 2);
    const availableHeight = Math.max(1, panelRect.height - pad * 2);
    const aspect = Math.max(0.01, Number(photo.aspectRatio || 1));
    let width = availableWidth;
    let height = width / aspect;
    if (height > availableHeight) {
      height = availableHeight;
      width = height * aspect;
    }
    return {
      left: panelRect.left + (panelRect.width - width) / 2,
      top: panelRect.top + (panelRect.height - height) / 2,
      width,
      height,
    };
  };

  const openPreviewAnimated = (photo: LocalPhoto) => {
    const thumb = photoThumbRefs.current[photo.id];
    const thumbRect = thumb?.getBoundingClientRect();
    const fallback: PreviewRect = {
      left: window.innerWidth / 2 - 80,
      top: window.innerHeight / 2 - 60,
      width: 160,
      height: 120,
    };
    const fromRect: PreviewRect = thumbRect
      ? {
          left: thumbRect.left,
          top: thumbRect.top,
          width: thumbRect.width,
          height: thumbRect.height,
        }
      : fallback;
    setPreviewPhotoId(photo.id);
    setPreviewClosePopped(false);
    setPreviewAnim({
      id: photo.id,
      phase: "opening",
      from: fromRect,
      to: fromRect,
    });
    setPreviewBackdropOpacity(0);

    window.requestAnimationFrame(() => {
      window.requestAnimationFrame(() => {
        setPreviewBackdropOpacity(1);
        const target = computePreviewTargetRect(photo);
        if (!target) return;
        setPreviewAnim((prev) => (prev && prev.id === photo.id ? { ...prev, to: target } : prev));
        if (previewTimerRef.current) window.clearTimeout(previewTimerRef.current);
        previewTimerRef.current = window.setTimeout(() => {
          setPreviewAnim((prev) =>
            prev && prev.id === photo.id && prev.phase === "opening"
              ? { ...prev, phase: "open" }
              : prev,
          );
          previewTimerRef.current = null;
        }, 280);
      });
    });
  };

  const closePreviewAnimated = () => {
    if (!previewPhotoId) return;
    const id = previewPhotoId;
    setPreviewBackdropOpacity(0);
    setPreviewClosePopped(false);
    const thumb = photoThumbRefs.current[id];
    const thumbRect = thumb?.getBoundingClientRect();
    if (!previewAnim || !thumbRect) {
      setPreviewAnim(null);
      setPreviewPhotoId("");
      setPreviewBackdropOpacity(0);
      return;
    }
    const closeTo: PreviewRect = {
      left: thumbRect.left,
      top: thumbRect.top,
      width: thumbRect.width,
      height: thumbRect.height,
    };
    setPreviewAnim((prev) => (prev && prev.id === id ? { ...prev, phase: "closing", to: closeTo } : prev));
    if (previewTimerRef.current) window.clearTimeout(previewTimerRef.current);
    previewTimerRef.current = window.setTimeout(() => {
      setPreviewAnim(null);
      setPreviewPhotoId("");
      setPreviewBackdropOpacity(0);
      previewTimerRef.current = null;
    }, 280);
  };


  // Both the rest content (User Settings button + avatar row) and the panel content
  // are always mounted (grid-stacked, crossfaded via opacity) so their natural
  // heights can be measured continuously via ResizeObserver, independent of which
  // one is currently visible. The wrapper's own height animates between these two
  // measured values, which is what makes the nav list above it get pushed up.
  //
  // Depends on isSidebarIconOnlyContent (the badge/panel branch's own condition below), not just
  // [] and not the immediate isSidebarIconOnly: these two refs' surrounding markup swaps identity
  // whenever that branch swaps, so a stale effect run (or one that fires before the swap actually
  // happens) finds both refs still null and bails out for good (empty deps never re-ran it),
  // permanently leaving restContentHeight/panelContentHeight at their initial null and — since
  // `?? undefined` then leaves the wrapper's own height unset entirely — the whole bottom section
  // invisible. Re-running exactly when the branch flips means it always gets a fresh attempt right
  // as the real elements mount.
  useLayoutEffect(() => {
    if (typeof ResizeObserver === "undefined") return;
    const restEl = bottomRestContentRef.current;
    const panelEl = bottomPanelContentRef.current;
    if (!restEl || !panelEl) return;
    const observer = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const height = Math.ceil(entry.borderBoxSize?.[0]?.blockSize ?? entry.contentRect.height);
        if (entry.target === restEl) setRestContentHeight(height);
        else if (entry.target === panelEl) setPanelContentHeight(height);
      }
    });
    observer.observe(restEl);
    observer.observe(panelEl);
    setRestContentHeight(restEl.getBoundingClientRect().height);
    setPanelContentHeight(panelEl.getBoundingClientRect().height);
    return () => observer.disconnect();
  }, [isSidebarIconOnlyContent]);

  const openUserSettingsPanel = () => {
    setIsUserSettingsPanelOpen(true);
  };

  const closeUserSettingsPanel = () => {
    setIsUserSettingsPanelOpen(false);
  };

  useEffect(() => {
    if (!isUserSettingsPanelOpen || typeof document === "undefined") return;
    const onPointerDown = (event: PointerEvent) => {
      const targetNode = event.target as Node;
      if (desktopAsideRef.current?.contains(targetNode)) return;
      // The mobile drawer's own sliding user-settings card is a second, separate instance of
      // this same "inside" check — without it, any click inside the mobile panel (an edit
      // button, a field, anything) reads as "outside" and immediately closes the panel it was
      // just clicked in.
      if (mobileNavPanelRef.current?.contains(targetNode)) return;
      const popoverEl = targetNode instanceof Element ? targetNode.closest('[data-sidebar-color-popover="true"]') : null;
      if (popoverEl) return;
      // A glass modal opened FROM the settings panel (e.g. the Log out confirm dialog, or New
      // Project) is portaled/rendered outside desktopAsideRef/mobileNavPanelRef entirely, so a
      // click on it — its backdrop, or Cancel/Confirm inside its panel — was reading as "clicked
      // away from the settings panel" and silently closing the panel behind it too, on top of
      // whatever the modal's own dismiss did. Any glass modal's own backdrop/panel already handles
      // its own open/close; it shouldn't also count as dismissing the settings panel underneath it.
      const modalEl = targetNode instanceof Element ? targetNode.closest(".glass-modal-backdrop, .glass-modal-panel") : null;
      if (modalEl) return;
      closeUserSettingsPanel();
      // That press only closes the panel — it doesn't also act on whatever it landed on.
      swallowNextClick();
    };
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, [isUserSettingsPanelOpen]);

  useEffect(() => {
    if (isUserSettingsPanelOpen) {
      setIsUserSettingsPanelOpen(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pathname]);

  const selectedAssignee = useMemo(() => {
    return staffOptions.find((s) => s.uid === assigneeUid) ?? null;
  }, [staffOptions, assigneeUid]);

  const filteredStaffOptions = useMemo(() => {
    const q = String(assigneeSearch || "").trim().toLowerCase();
    if (!q) return staffOptions;
    return staffOptions.filter((s) => `${s.name} ${s.email}`.toLowerCase().includes(q));
  }, [staffOptions, assigneeSearch]);

  const renderStaffOptionBadge = (staff: StaffOption, size = 22) => {
    const color = String(staff.color || "").trim() || companyThemeColor || "#7C8EA5";
    return (
      <span
        className="inline-flex shrink-0 items-center justify-center rounded-full text-white"
        style={{
          width: size,
          height: size,
          backgroundColor: color,
          fontSize: size <= 22 ? 10 : 11,
          fontWeight: 800,
          lineHeight: 1,
        }}
      >
        {initials(staff.name || staff.email || "U")}
      </span>
    );
  };

  const availableTagSuggestions = useMemo(
    () =>
      companyTagSuggestions.filter(
        (value) => !tags.some((tag) => tag.toLowerCase() === String(value || "").toLowerCase()),
      ),
    [companyTagSuggestions, tags],
  );

  const filteredTagSuggestions = useMemo(() => {
    const q = String(tagInput || "").trim().toLowerCase();
    if (!q) return availableTagSuggestions.slice(0, 25);
    const starts = availableTagSuggestions.filter((tag) => String(tag || "").toLowerCase().startsWith(q));
    const contains = availableTagSuggestions.filter(
      (tag) => !String(tag || "").toLowerCase().startsWith(q) && String(tag || "").toLowerCase().includes(q),
    );
    return [...starts, ...contains].slice(0, 25);
  }, [availableTagSuggestions, tagInput]);

  const onCreateProject = async () => {
    if (creatingProject) return;
    // An unverified account can browse the app but not create new records — see the same gate's
    // comment in app/(app)/projects/[projectId]/page.tsx.
    if (!user?.verified) {
      setProjectFormError("Verify your account (in User Settings) before creating a project.");
      return;
    }
    if (!canCreateProject) {
      setProjectFormError("Your role can't create projects.");
      return;
    }
    const name = String(projectName || "").trim();
    const firstName = String(clientFirstName || "").trim();
    const lastName = String(clientLastName || "").trim();
    const customer = [firstName, lastName].filter(Boolean).join(" ").trim();
    if (!name) {
      setProjectFormError(newProjectIsSmallJob ? "Job Name is required." : "Project Name is required.");
      setNewProjectInvalidField("name");
      newProjectNameInputRef.current?.focus();
      return;
    }
    if (!customer) {
      setProjectFormError("Client Name is required.");
      setNewProjectInvalidField("client");
      newProjectClientInputRef.current?.focus();
      return;
    }
    // The contact card picked (from those its client's details matched): the new project's linked to it, rather than
    // matched to one by its details.
    const linkedContactId = String(newProjectContact?.id || "").trim();
    setProjectFormError("");
    setNewProjectInvalidField("");
    // No tags on a small job (any typed in for a project are kept, should it be switched back to one).
    const projectTags = newProjectIsSmallJob ? [] : tags;

    if (!hasFirebaseConfig || !db) {
      setShowNewProject(false);
      router.push("/projects/prj_1001");
      return;
    }
    // Where it starts: the first project status — a small job's, the first small-job status.
    const startStatus = newProjectIsSmallJob ? defaultSmallJobStatus || "Open" : defaultProjectStatus || "New";

    const storedCompanyId =
      typeof window !== "undefined"
        ? String(window.localStorage.getItem(ACTIVE_COMPANY_STORAGE_KEY) || "").trim()
        : "";
    const directCompanyId = String(user?.companyId || "").trim();
    const fallbackMembership = !directCompanyId && user?.uid ? await fetchPrimaryMembership(user.uid) : null;
    const companyId = storedCompanyId || directCompanyId || String(fallbackMembership?.companyId || "").trim();
    if (!companyId) {
      setProjectFormError("No active company selected. Join or create a company first.");
      return;
    }
    if (typeof window !== "undefined" && !storedCompanyId) {
      window.localStorage.setItem(ACTIVE_COMPANY_STORAGE_KEY, companyId);
    }

    setCreatingProject(true);
    try {
      const projectId = createProjectId();
      const nowIso = new Date().toISOString();
      // Leave blank rather than defaulting to the creator — an unassigned project should stay
      // unassigned until someone deliberately assigns it, so every render site's "no assignee"
      // fallback (creator's name/email/phone) actually has a chance to kick in.
      const assignedName = canCreateForOthers ? selectedAssignee?.name || "" : "";
      const assignedUid = canCreateForOthers ? selectedAssignee?.uid || "" : "";
      let uploadedImageUrls: string[] = [];
      const storageClient = storage;
      if (photos.length && storageClient) {
        let uploadError: unknown = null;
        const uploaded = await Promise.all(
          photos.map(async (p, idx) => {
            try {
              const ext = p.file.name.includes(".") ? p.file.name.split(".").pop() : "jpg";
              const path = `companies/${companyId}/jobs/${projectId}/images/${idx + 1}_${Date.now()}.${ext}`;
              const ref = storageRef(storageClient, path);
              await uploadBytes(ref, p.file, { contentType: p.file.type || "image/jpeg" });
              return await getDownloadURL(ref);
            } catch (error) {
              if (!uploadError) uploadError = error;
              return "";
            }
          }),
        );
        if (uploadError) {
          throw uploadError;
        }
        uploadedImageUrls = uploaded.filter(Boolean);
      }
      const projectImageUrls = [
        ...prefilledProjectImages.map((image) => String(image.url || "").trim()).filter(Boolean),
        ...uploadedImageUrls,
      ].slice(0, 10);
      const projectImageItems: ProjectImageItem[] = [
        ...prefilledProjectImages.map((image) => ({
          url: String(image.url || "").trim(),
          name: String(image.name || "").trim(),
          annotations: Array.isArray(image.annotations)
            ? image.annotations.map((annotation) => ({
                id: String(annotation.id || "").trim(),
                x: Number(annotation.x ?? 0),
                y: Number(annotation.y ?? 0),
                xPx: Number.isFinite(Number(annotation.xPx)) ? Number(annotation.xPx) : undefined,
                yPx: Number.isFinite(Number(annotation.yPx)) ? Number(annotation.yPx) : undefined,
                note: String(annotation.note || "").trim(),
                createdByName: String(annotation.createdByName || "").trim(),
                createdByColor: String(annotation.createdByColor || "").trim(),
              }))
            : [],
        })),
        ...uploadedImageUrls.map((url, idx) => ({
          url,
          name: String(photos[idx]?.name || "").trim(),
          annotations: [],
        })),
      ]
        .filter((item) => item.url)
        .slice(0, 10);
        const projectSettings = {
          boardTypes: [],
          projectPermissions: {},
          gapAllowancesSettings: defaultGapAllowancesSettings,
        };
      const sales = {
        rooms: [],
        quoteExtrasIncluded: defaultQuoteExtras,
      };
        await setDoc(doc(db, "companies", companyId, "jobs", projectId), {
          id: projectId,
          companyId,
          name,
          customer,
          ...(linkedContactId ? { clientId: linkedContactId } : {}),
          clientFirstName: firstName,
          clientLastName: lastName,
          clientName: customer,
          client: customer,
        clientNumber: clientPhone.trim(),
        clientPhone: clientPhone.trim(),
        clientEmail: clientEmail.trim(),
        clientAddress: projectAddress.trim(),
        notes: projectNotes,
        createdByUid: user?.uid ?? "",
        createdByName: user?.displayName ?? "CutSmart User",
        assignedTo: assignedName,
        assignedToName: assignedName,
        assignedToUid: assignedUid,
        createdAtIso: nowIso,
        updatedAtIso: nowIso,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
        status: startStatus,
        // Its first status, as it went in (Reports' days in each stage — updateProjectStatus notes each after it).
        statusHistory: [{ status: startStatus, subStage: "", atIso: nowIso }],
        // A small job (Small Jobs — lib/small-jobs.ts).
        ...(newProjectIsSmallJob ? { isSmallJob: true } : {}),
        // Made from a lead (Leads › Create Project): which one — Reports' lead conversions.
        ...(sourceLeadId && sourceLeadCompanyId === companyId ? { sourceLeadId } : {}),
        tags: projectTags,
        isDeleted: false,
        projectImages: projectImageUrls,
        projectImageItems,
        cutlist: { rows: [] },
        cutlistJson: { rows: [] },
        projectSettings,
        sales,
        // "Notifications as Creator" (User Settings) — on unless the creator has switched it off: they're
        // subscribed to the project's notifications (lib/project-notify.ts's isProjectNotifySubscribed), the same
        // as tapping its bell. Nothing's written when it's off, so the project's stored overrides stay empty.
        ...(user?.notifyAsCreator !== false && user?.uid ? { notifySubscriptionOverrides: { [user.uid]: true } } : {}),
        // Lead custom fields not already captured by a fixed field above — see
        // lib/new-project-bridge.ts and buildLeadProjectPrefill in leads/page.tsx. Absent (not an
        // empty array) when this project wasn't created from a lead, or its lead had none.
        ...(prefilledLeadCustomFields.length > 0 ? { leadCustomFields: prefilledLeadCustomFields } : {}),
      });
        try {
          const clientCreateResult = await authorizedFetch("/api/clients", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              projectId,
              companyId,
              projectName: name,
              customer,
              clientId: linkedContactId || undefined,
              createdAtIso: nowIso,
              updatedAtIso: nowIso,
              createdByUid: user?.uid ?? "",
              createdByName: user?.displayName ?? "CutSmart User",
              assignedToUid: assignedUid,
              assignedToName: assignedName,
              assignedTo: assignedName,
              statusLabel: startStatus,
              tags: projectTags,
              notes: projectNotes,
              clientPhone: clientPhone.trim(),
              clientEmail: clientEmail.trim(),
              clientAddress: projectAddress.trim(),
              projectFiles: [],
              projectImages: projectImageUrls,
              projectImageItems,
              projectSettings,
            }),
          });
          const clientCreateJson = (await clientCreateResult.json().catch(() => null)) as { ok?: boolean; clientId?: string } | null;
          if (!clientCreateJson?.ok) {
            await upsertCompanyClientProfileOnProjectCreate({
              projectId,
              companyId,
              projectName: name,
              customer,
              clientId: linkedContactId || undefined,
              createdAtIso: nowIso,
              updatedAtIso: nowIso,
              createdByUid: user?.uid ?? "",
              createdByName: user?.displayName ?? "CutSmart User",
              assignedToUid: assignedUid,
              assignedToName: assignedName,
              assignedTo: assignedName,
              statusLabel: startStatus,
              tags: projectTags,
              notes: projectNotes,
              clientPhone: clientPhone.trim(),
              clientEmail: clientEmail.trim(),
              clientAddress: projectAddress.trim(),
              projectFiles: [],
              projectImages: projectImageUrls,
              projectImageItems,
              projectSettings,
            });
          }
        } catch {
          await upsertCompanyClientProfileOnProjectCreate({
            projectId,
            companyId,
            projectName: name,
            customer,
            clientId: linkedContactId || undefined,
            createdAtIso: nowIso,
            updatedAtIso: nowIso,
            createdByUid: user?.uid ?? "",
            createdByName: user?.displayName ?? "CutSmart User",
            assignedToUid: assignedUid,
            assignedToName: assignedName,
            assignedTo: assignedName,
            statusLabel: startStatus,
            tags: projectTags,
            notes: projectNotes,
            clientPhone: clientPhone.trim(),
            clientEmail: clientEmail.trim(),
            clientAddress: projectAddress.trim(),
            projectFiles: [],
            projectImages: projectImageUrls,
            projectImageItems,
            projectSettings,
          });
        }
      if (projectTags.length > 0) {
        await resyncCompanyProjectTagUsage(companyId);
      }
      // Onto the Dashboard, in its first column: that column's "enters" automations (lib/column-automations.ts).
      if (!newProjectIsSmallJob) {
        void notifyColumnAutomationMove({ companyId, board: "projects", item: { id: projectId, name }, from: null, to: { status: startStatus, subStage: "" } });
      }
      if (typeof window !== "undefined" && sourceLeadId && sourceLeadCompanyId) {
        window.dispatchEvent(
          new CustomEvent(LEAD_PROJECT_CREATED_EVENT, {
            detail: {
              leadId: sourceLeadId,
              companyId: sourceLeadCompanyId,
              projectId,
            },
          }),
        );
      }
      // If this project's client matched an existing contact card, the card kept its own details (see
      // /api/clients POST). Flag the new project so its page checks once for differences and asks whether
      // to update the card ("Update contact card for <name>?").
      if (customer || clientEmail.trim() || clientPhone.trim()) {
        try {
          window.sessionStorage.setItem(`cs_contact_card_check_${projectId}`, "1");
        } catch {
          // storage unavailable — the check is a convenience only
        }
      }
      setShowNewProject(false);
      resetProjectForm();
      router.push(`/projects/${projectId}`);
    } catch (error) {
      if (isFirebaseStorageQuotaExceeded(error)) {
        setProjectFormError(getFirebaseStorageQuotaExceededMessage("Project images"));
      } else {
        const message =
          error && typeof error === "object" && "code" in error
            ? String((error as { code?: unknown }).code || "create-failed")
            : String((error as { message?: unknown } | null)?.message || "Could not create project.");
        setProjectFormError(`Could not create project (${message}).`);
      }
    } finally {
      setCreatingProject(false);
    }
  };

  // New Project (below): a project's, or — Small Job switched on, top right — a small job's, in Small Jobs' orange. Its
  // cards (as the project page's), fields and labels; its photos' remove button, file picker and names; and closing it
  // (what's in it let go).
  const closeNewProject = () => {
    setShowNewProject(false);
    resetProjectForm();
  };
  const newProjectAccent = newProjectIsSmallJob ? SMALL_JOB_COLOR : "var(--brand)";
  // Its cards: the app's neutral glass (as the project page's and other pop-ups' containers). Not clipped: the menus
  // opened in them — Assign to, tag suggestions, the notes toolbar's — reach out past them.
  const newProjectCardClass = "glass-shine glass-shine-neutral rounded-[16px]";
  const newProjectCardHeaderClass = "flex min-h-[44px] items-center gap-2 border-b border-[var(--glass-border)] px-4 py-1.5";
  const newProjectCardTitleClass = "text-[12px] font-medium uppercase tracking-[0.9px] text-[var(--text-main)]";
  const newProjectLabelClass = "mb-1.5 block text-[12px] font-medium text-[var(--text-main)]";
  const newProjectFieldClass = (invalid = false) =>
    cn(
      "h-10 w-full rounded-[10px] border bg-[var(--panel-bg)] px-3 text-[13px] text-[var(--text-main)] outline-none transition placeholder:text-[var(--text-muted)]",
      invalid ? "border-[var(--danger)]" : "border-[var(--panel-border)] focus:border-[var(--brand)]",
    );
  const newProjectFieldIconClass = "pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[var(--text-muted)]";
  // Its menus' rows (Assign to's): the one picked in the brand blue (as the app's glass menus), a light blue under the
  // pointer.
  const newProjectMenuRowClass = (picked: boolean) =>
    cn(
      "flex w-full items-center gap-2 rounded-[8px] px-2 py-1.5 text-left text-[12px] transition-colors",
      !picked && "hover:bg-[var(--brand-soft)]",
    );
  const newProjectMenuRowStyle = (picked: boolean) => (picked ? { backgroundImage: "var(--brand-gradient)" } : undefined);
  const clearNewProjectInvalid = (field: "name" | "client") => {
    if (newProjectInvalidField !== field) return;
    setNewProjectInvalidField("");
    setProjectFormError("");
  };
  // Its client's contacts (as Contacts reads them — everyone's, or just theirs), read the first time a client field's gone
  // into. Not for someone who can't see Contacts.
  const ensureNewProjectContacts = () => {
    if (!canAccessClients || newProjectContacts !== null || newProjectContactsLoadingRef.current) return;
    const companyId =
      String(window.localStorage.getItem(ACTIVE_COMPANY_STORAGE_KEY) || "").trim() || String(user?.companyId || "").trim();
    const viewerUid = String(user?.uid || "").trim();
    if (!companyId) {
      setNewProjectContacts([]);
      return;
    }
    newProjectContactsLoadingRef.current = true;
    void (async () => {
      let rows: CompanyClientRow[] | null = null;
      try {
        const response = await authorizedFetch(
          `/api/clients?companyId=${encodeURIComponent(companyId)}&mode=summary&viewerUid=${encodeURIComponent(viewerUid)}&scope=${canViewAllClients ? "all" : "mine"}`,
          { method: "GET", cache: "no-store" },
        );
        const json = (await response.json().catch(() => null)) as { ok?: boolean; clients?: CompanyClientRow[] } | null;
        if (response.ok && json?.ok && Array.isArray(json.clients)) rows = json.clients;
      } catch {
        // read straight from the database below
      }
      if (!rows) rows = await fetchCompanyClients(companyId, { viewerUid, includeAll: canViewAllClients }).catch(() => []);
      newProjectContactsLoadingRef.current = false;
      setNewProjectContacts(rows.filter((row) => String(row.name || row.email || "").trim()));
    })();
  };
  // The contacts what's typed in the field being typed in matches: the name's words (each the start of one of theirs),
  // the email, or the phone's digits. None once one's picked.
  const newProjectContactSuggestions = (): CompanyClientRow[] => {
    if (!contactSuggestField || newProjectContact || !newProjectContacts?.length) return [];
    if (contactSuggestField === "name") {
      const words = `${clientFirstName} ${clientLastName}`.trim().toLowerCase().split(/\s+/).filter(Boolean);
      if (words.join("").length < 2) return [];
      return newProjectContacts
        .filter((row) => {
          const theirs = String(row.name || "").toLowerCase().split(/\s+/);
          return words.every((word) => theirs.some((their) => their.startsWith(word)));
        })
        .slice(0, 6);
    }
    if (contactSuggestField === "email") {
      const query = clientEmail.trim().toLowerCase();
      if (query.length < 3) return [];
      return newProjectContacts.filter((row) => String(row.email || "").toLowerCase().includes(query)).slice(0, 6);
    }
    const digits = clientPhone.replace(/\D/g, "");
    if (digits.length < 3) return [];
    return newProjectContacts.filter((row) => String(row.phone || "").replace(/\D/g, "").includes(digits)).slice(0, 6);
  };
  // Shown under the field being typed in (its whole row, for the name), the first ready for Enter.
  const suggestContactsFrom = (field: "name" | "phone" | "email", anchor: HTMLElement) => {
    if (!canAccessClients) return;
    ensureNewProjectContacts();
    setContactSuggestField(field);
    setContactSuggestPos(floatingMenuPosFor(anchor, 300, 300));
    setContactSuggestIndex(0);
  };
  // Gone once the field's left (a press on one of them doesn't leave it — see their onMouseDown).
  const closeContactSuggestionsSoon = () => window.setTimeout(() => setContactSuggestField(""), 120);
  // A client field's keys while they're showing: ↑/↓ through them, Enter picks one, Escape closes them.
  const onContactFieldKeyDown = (e: ReactKeyboardEvent<HTMLInputElement>) => {
    const suggestions = newProjectContactSuggestions();
    if (!suggestions.length || e.ctrlKey || e.metaKey) return;
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      setContactSuggestIndex((index) => (index + (e.key === "ArrowDown" ? 1 : suggestions.length - 1)) % suggestions.length);
    } else if (e.key === "Enter") {
      e.preventDefault();
      pickNewProjectContact(suggestions[Math.min(contactSuggestIndex, suggestions.length - 1)]);
    } else if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      setContactSuggestField("");
    }
  };
  // The name changed from the picked contact's: someone else, then — not linked to that contact any more.
  const unlinkContactIfRenamed = (first: string, last: string) => {
    if (!newProjectContact) return;
    const typed = `${first} ${last}`.trim().replace(/\s+/g, " ").toLowerCase();
    if (typed !== String(newProjectContact.name || "").trim().replace(/\s+/g, " ").toLowerCase()) setNewProjectContact(null);
  };
  // Assign to's list: opened at its field.
  const toggleAssigneeMenu = () => {
    if (assigneeMenuOpen) {
      setAssigneeMenuOpen(false);
      return;
    }
    if (assigneeFieldRef.current) setAssigneeMenuPos(floatingMenuPosFor(assigneeFieldRef.current, 290));
    setAssigneeMenuOpen(true);
  };
  // A contact picked: its name, phone and email for the client (the address too, unless one's already typed in).
  const pickNewProjectContact = (contact: CompanyClientRow) => {
    const [first = "", ...rest] = String(contact.name || "").trim().split(/\s+/);
    setClientFirstName(first);
    setClientLastName(rest.join(" "));
    setClientPhone(String(contact.phone || "").trim());
    setClientEmail(String(contact.email || "").trim());
    if (!projectAddress.trim() && String(contact.address || "").trim()) setProjectAddress(String(contact.address).trim());
    setNewProjectContact(contact);
    setContactSuggestField("");
    clearNewProjectInvalid("client");
  };
  const unpickNewProjectContact = () => {
    setClientFirstName("");
    setClientLastName("");
    setClientPhone("");
    setClientEmail("");
    if (newProjectContact && projectAddress.trim() === String(newProjectContact.address || "").trim()) setProjectAddress("");
    setNewProjectContact(null);
  };
  // A contact's badge: their initials, in their category's colour (as on Contacts).
  const renderNewProjectContactBadge = (contact: CompanyClientRow, size: number) => (
    <span
      className="inline-flex shrink-0 items-center justify-center rounded-full font-bold text-white"
      style={{
        width: size,
        height: size,
        fontSize: size >= 32 ? 13 : 11,
        backgroundColor: (contact.category ? contactCategoryColors[contact.category] : "") || "#7D99B3",
      }}
    >
      {initials(contact.name || contact.email || "?")}
    </span>
  );
  const newProjectPhotoCount = prefilledProjectImages.length + photos.length;
  const newProjectPhotoRemoveClass =
    "absolute right-1 top-1 inline-flex h-6 w-6 items-center justify-center rounded-full bg-[rgba(15,23,42,0.62)] text-white shadow-[0_1px_4px_rgba(0,0,0,0.25)] transition hover:bg-[var(--danger)]";
  const newProjectPhotoInput = (
    <input
      type="file"
      accept="image/*"
      multiple
      className="hidden"
      onChange={(e) => {
        void addPhotoFiles(e.target.files);
        e.currentTarget.value = "";
      }}
    />
  );
  // A photo's name, under it: tap to give it one (or change it).
  const newProjectPhotoCaption = (key: string, name: string) =>
    editingProjectPhotoNameKey === key ? (
      <input
        {...NEW_PROJECT_NO_AUTOFILL}
        autoFocus
        value={projectPhotoNameDraft}
        onChange={(e) => setProjectPhotoNameDraft(e.currentTarget.value)}
        onBlur={commitProjectPhotoNameEdit}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            commitProjectPhotoNameEdit();
          }
          if (e.key === "Escape") {
            e.preventDefault();
            setEditingProjectPhotoNameKey("");
            setProjectPhotoNameDraft("");
          }
        }}
        className="mt-1 h-5 w-full rounded-[6px] border border-[var(--brand)] bg-[var(--panel-bg)] px-1.5 text-center text-[11px] font-medium text-[var(--text-main)] outline-none"
      />
    ) : (
      <button
        type="button"
        onClick={() => beginEditProjectPhotoName(key, name)}
        title="Name this photo"
        className={cn(
          "mt-1 flex h-5 w-full items-center justify-center gap-1 rounded-[6px] px-1 text-[11px] transition hover:bg-[var(--panel-muted)]",
          name.trim() ? "font-medium text-[var(--text-main)]" : "text-[var(--text-muted)]",
        )}
      >
        {name.trim() ? (
          <span className="truncate">{name.trim()}</span>
        ) : (
          <>
            <Pencil size={10} className="shrink-0" />
            Name
          </>
        )}
      </button>
    );
  const isDarkMode = themeMode === "dark";
  const shellPalette = isDarkMode
    ? {
        appBg: "#0f0f0f",
        panelBg: "#212121",
        panelMuted: "#272727",
        border: "#3f3f46",
        text: "#f1f1f1",
        textMuted: "#aaaaaa",
        hoverBg: "#323232",
      }
    : {
        appBg: "var(--bg-app)",
        panelBg: "#ffffff",
        panelMuted: "#F8FAFC",
        border: "#D8DEE8",
        text: "#0F172A",
        textMuted: "#475467",
        hoverBg: "#F7F8FC",
      };
  // The phone's menu is see-through glass over the page, where the muted grey was hard to read: its pages and icons
  // are in the main text colour, its group names (and the line on from each, and the one over the user's bar) a darker
  // grey than the muted one.
  const mobileNavHeadingColor = `color-mix(in srgb, ${shellPalette.text} 65%, ${shellPalette.textMuted})`;

  // Fixed at the CLOSED (rest) height always, regardless of how tall the settings panel grows
  // when open — the nav list never gets pushed up or scrolls to make room for it; the white bar
  // just overlays on top of whichever tabs it grows tall enough to cover, the same way it already
  // visually stacks above the nav list via z-index.
  // (…and the Downloads button's row, just above it — which the settings panel covers too as it grows.)
  const navListMarginBottom = (restContentHeight ?? 0) + SIDEBAR_DOWNLOADS_ROW_HEIGHT;

  // The small (rest) row and the full panel are grid-stacked in the same box, so
  // exactly one of them is shown at a time via a simple opacity crossfade — the
  // small icon/name fade away on open, the panel (its own icon/name included)
  // fades in as part of the same reveal as the rest of its content.
  // In icon-only mode the "panel" side of this crossfade renders a small Settings/Log out
  // icon stack instead of the full-width-only SidebarUserSettingsPanel (see bottomPanelContentRef
  // below) — but it's still the exact same grid-stacked crossfade + height-transition reveal,
  // just with narrower content, so the open/close motion looks identical in both sidebar widths.
  const showBottomPanelContent = isUserSettingsPanelOpen;
  const showBottomRestContent = !isUserSettingsPanelOpen;

  return (
    <div
      // min-h-[100svh], not Tailwind's own min-h-screen (min-height: 100vh): this div is the
      // outermost wrapper around EVERY page in the app, and min-height is only ever a FLOOR — on
      // any page whose own content is shorter than a full screen, min-h-screen forces this div (a
      // child of body) to be AT LEAST 100vh tall regardless, which on iOS Safari is the viewport
      // height with the browser's own toolbar fully COLLAPSED (the tallest it ever gets) — taller
      // than what's actually visible whenever that toolbar is showing, its resting state. Since
      // this div is what actually ends up too tall (not body itself, whose own min-height a
      // shorter child growing past it simply overrides), body's own min-height fix elsewhere in
      // this file couldn't do anything about it — body just grows to contain this. That phantom
      // extra height is exactly what made the PAGE genuinely (if invisibly) scrollable, and
      // scrolling the real document is what makes Safari's own toolbar animate in response —
      // reading as a blank bar sliding up from the bottom on any short-content page, everywhere in
      // the app. 100svh can never exceed the visible area, so there's nothing left to grow into.
      className="min-h-[100svh]"
      data-theme-mode={themeMode}
      style={{ color: shellPalette.text }}
    >
      {/* The separate mobile-only header bar (hamburger + CutSmart/back button + New Project) that
          used to live here was removed — GlobalAppTabsBar's own top-12 bar is now the ONLY sticky
          header on mobile, with the hamburger button folded into its left edge (where the hidden-
          on-mobile Dashboard pill used to sit) so it can call setMobileNavOpen via the shared
          AppTabsProvider context instead. New Project and "back to projects" are still reachable
          from the drawer this hamburger opens (the sidebar's own New Project button) and from the
          project's tab close (X) respectively. */}

      {/* Kept mounted (just hidden off-screen) while closed rather than mounted on open, so the
          company logo and every button inside are already loaded, decoded and laid out the moment
          the drawer slides in — mounting on open is what made the logo pop in a beat late.
          visibility:hidden still loads/decodes images (display:none can defer them). The panel's
          and backdrop's starting transform/opacity are set here once (React never rewrites a
          constant style value) so the very first open slides in from closed instead of flashing
          open for a frame; useSwipeToClose's own inline writes take over from there. */}
      {!effectiveHideSidebar && (
        <div
          className="fixed inset-0 z-[120] lg:hidden"
          style={{ visibility: shouldRenderMobileNav ? "visible" : "hidden", pointerEvents: shouldRenderMobileNav ? undefined : "none" }}
          aria-hidden={!shouldRenderMobileNav}
          inert={!shouldRenderMobileNav}
        >
          {/* No dimming: the page shows through the menu's glass as it is, just blurred. */}
          <button
            type="button"
            data-swipe-backdrop="true"
            className="absolute inset-0 bg-transparent"
            style={{ opacity: 0 }}
            onClick={() => setMobileNavOpen(false)}
            aria-label="Close menu backdrop"
          />
          <aside
            ref={mobileNavPanelRef}
            {...mobileNavTouchHandlers}
            className="relative z-[121] flex h-full w-full flex-col overflow-hidden"
            style={{
              ...mobilePanelGlass,
              color: shellPalette.text,
              touchAction: "pan-y",
              transform: "translateX(-100%)",
            }}
          >
            {/* Alongside the swipe-to-close gesture — an explicit tap target in the top-right corner, its arrow
                pointing the way the drawer goes (left, since it slides back out to the left). */}
            <button
              type="button"
              onClick={() => setMobileNavOpen(false)}
              className="absolute right-3 top-3 z-10 inline-flex h-10 w-10 items-center justify-center rounded-full border"
              style={{ borderColor: shellPalette.border, backgroundColor: shellPalette.panelBg, color: shellPalette.text }}
              aria-label="Close menu"
            >
              <ChevronLeft size={20} />
            </button>
            {/* (No line under the logo — straight on to the menu.) */}
            <div className="flex items-center px-4 py-3">
              <div className="flex min-h-[44px] w-full items-center">
                {companyLogoPath ? (
                  <img
                    src={companyLogoPath}
                    alt={`${companyDisplayName} logo`}
                    className="block h-auto w-full object-contain"
                    style={{ maxHeight: 100 }}
                    onError={(e) => {
                      e.currentTarget.style.display = "none";
                    }}
                  />
                ) : companyDisplayName ? (
                  <p className="text-[13px] font-semibold text-[var(--text-main)]" style={{ color: shellPalette.text }}>{companyDisplayName}</p>
                ) : null}
              </div>
            </div>

            <div className="flex min-h-0 h-full flex-1 flex-col px-3 pb-3 pt-3">
              {canCreateProject && (
                <button
                  type="button"
                  onClick={(e) => {
                    newProjectModalOriginElRef.current = e.currentTarget;
                    setAssigneeUid("");
                    setNewProjectOrigin(captureGlassModalOrigin(e));
                    setShowNewProject(true);
                    setMobileNavOpen(false);
                  }}
                  // The glass shine (lib/glass-shine.ts), in the brand blue, round-ended.
                  className="glass-shine mb-3 flex h-14 w-full shrink-0 items-center justify-center gap-2 rounded-full text-[17px] font-semibold text-white transition hover:brightness-105"
                  style={glassShineStyle("var(--brand)")}
                >
                  <Plus size={24} strokeWidth={2.5} />
                  New Project
                </button>
              )}
              <div ref={mobileNavListRef} className="relative min-h-0 flex-1 space-y-1 overflow-y-auto pr-1">
                {visibleNavGroups.map((group, groupIdx) => {
                  const isFolded = Boolean(foldedNavGroups[group.name]);
                  return (
                    <Fragment key={group.name}>
                      {/* Its name, over its pages (as Company Settings' own side nav), a line on across the rest of the row
                          and the arrow that folds it away at the end (toggleNavGroup). */}
                      <button
                        type="button"
                        onClick={() => toggleNavGroup(group.name)}
                        aria-expanded={!isFolded}
                        className={cn(
                          "flex w-full items-center gap-2.5 px-4 pb-1 text-left text-[12px] font-bold uppercase tracking-[0.8px]",
                          groupIdx === 0 ? "pt-1" : "pt-4",
                        )}
                        style={{ color: mobileNavHeadingColor }}
                      >
                        <span className="shrink-0">{group.name}</span>
                        <span aria-hidden="true" className="h-px min-w-0 flex-1" style={{ backgroundColor: mobileNavHeadingColor }} />
                        <ChevronDown
                          size={16}
                          strokeWidth={2.5}
                          aria-hidden="true"
                          className="shrink-0 transition-transform duration-200"
                          style={{ transform: isFolded ? "none" : "rotate(180deg)" }}
                        />
                      </button>
                      <div
                        inert={isFolded}
                        data-mobile-nav-group={group.name}
                        className="grid"
                        style={{ gridTemplateRows: isFolded ? "0fr" : "1fr" }}
                      >
                        <div className="min-h-0 space-y-1 overflow-hidden">
                          {group.items.map((item) => {
                            const active = pathname?.startsWith(item.href);
                            const Icon = item.icon;
                            return (
                              <Link
                                key={item.href}
                                href={item.href}
                                className={cn(
                                  "flex items-center gap-3 rounded-[12px] px-4 py-3.5 text-[17px] font-medium transition",
                                  // Selected: see-through glass (globals.css .nav-active-glass), as the computer's sidebar.
                                  active ? "nav-active-glass" : "hover:bg-[var(--panel-muted)]",
                                )}
                                style={{
                                  color: active ? "var(--brand)" : shellPalette.text,
                                }}
                              >
                                <Icon size={22} />
                                {item.label}
                              </Link>
                            );
                          })}
                        </div>
                      </div>
                    </Fragment>
                  );
                })}
              </div>

              {/* Same rest-row/panel crossfade as the desktop sidebar's bottom section — tapping
                  the avatar row slides up SidebarUserSettingsPanel (which has its own cog button
                  to the full /user-settings page), instead of a separate bottomNav link straight
                  there. */}
              <div
                className="shrink-0 overflow-hidden border-t border-[var(--panel-border)]"
                style={{
                  borderColor: mobileNavHeadingColor,
                  height: (isUserSettingsPanelOpen ? mobilePanelContentHeight : mobileRestContentHeight) ?? undefined,
                  transition: "height 320ms cubic-bezier(0.22, 1, 0.36, 1)",
                }}
              >
                <div className="grid items-start">
                  <div
                    ref={mobileBottomRestRef}
                    className="pt-3"
                    style={{
                      gridArea: "1 / 1",
                      opacity: isUserSettingsPanelOpen ? 0 : 1,
                      pointerEvents: isUserSettingsPanelOpen ? "none" : "auto",
                      transition: "opacity 200ms ease",
                    }}
                  >
                    {/* The bar: tap it for the card above; the cog beside the name goes straight to User Settings. */}
                    <div className="flex items-center gap-1">
                      <button
                        type="button"
                        onClick={openUserSettingsPanel}
                        className="flex min-w-0 flex-1 items-center gap-3 rounded-[12px] px-3 py-3 text-left transition hover:bg-[var(--panel-muted)]"
                        aria-label="Open user settings"
                      >
                        <div
                          className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-[14px] font-extrabold text-white"
                          style={{ backgroundColor: userEmblemColor }}
                        >
                          {userInitials}
                        </div>
                        <div className="min-w-0 flex-1">
                          <p className="m-0 block truncate text-[16px] font-semibold" style={{ color: shellPalette.text }}>{user?.displayName || "CutSmart User"}</p>
                          {isDemoMode && (
                            <span className="block truncate text-[12px] font-semibold" style={{ color: "#B7791F" }}>{isPreviewMode() ? "CutSmart Preview" : "Demo data mode"}</span>
                          )}
                        </div>
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          setMobileNavOpen(false);
                          router.push("/user-settings");
                        }}
                        className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-[12px] transition hover:bg-[var(--panel-muted)]"
                        style={{ color: shellPalette.text }}
                        aria-label="User Settings"
                        title="User Settings"
                      >
                        <Settings size={20} />
                      </button>
                    </div>
                  </div>
                  <div
                    ref={mobileBottomPanelRef}
                    className="pt-3"
                    style={{
                      gridArea: "1 / 1",
                      opacity: isUserSettingsPanelOpen ? 1 : 0,
                      pointerEvents: isUserSettingsPanelOpen ? "auto" : "none",
                      transition: "opacity 220ms ease",
                    }}
                  >
                    <SidebarUserSettingsPanel
                      isOpen={isUserSettingsPanelOpen}
                      onRequestClose={closeUserSettingsPanel}
                      onRequestLogout={(e) => { logoutConfirmOriginElRef.current = e.currentTarget; setLogoutConfirmOrigin(captureGlassModalOrigin(e)); setShowLogoutConfirm(true); }}
                      // Its collapse (V), Settings and Log out as the user's bar's Settings (44px, 20px, the menu's text colour).
                      largeActions
                      actionColor={shellPalette.text}
                    />
                  </div>
                </div>
              </div>
            </div>
          </aside>
        </div>
      )}

      <aside
        ref={desktopAsideRef}
        className="z-[70] hidden flex-col overflow-hidden border-r lg:flex"
        style={{
          position: "fixed",
          left: 0,
          top: 0,
          height: "100vh",
          width: sidebarWidthPx,
          backgroundColor: "var(--glass-bg)",
          backdropFilter: "blur(24px) saturate(180%)",
          WebkitBackdropFilter: "blur(24px) saturate(180%)",
          borderColor: "var(--glass-border)",
          boxShadow: "var(--shadow-glass)",
          color: shellPalette.text,
          display: effectiveHideSidebar ? "none" : undefined,
          // Always transitions — there are only ever two valid widths (see snapSidebarWidth), so
          // every change, drag or click, is a jump between them that should visibly slide rather
          // than cut instantly.
          transition: "width 200ms ease",
        }}
      >
        {/* Portaled straight to <body> rather than rendered in place — this needs to reliably
            paint in front of literally everything else on the page (the main content's own rows,
            sticky headers, any of ITS OWN positioned/stacking-context elements), and a descendant
            of the fixed sidebar can only ever be as far forward as the sidebar's OWN place in the
            page's stacking order lets it, no matter how high its own z-index is set — a completely
            separate top-level sibling of everything else, via a portal, has no such ceiling. */}
        {!effectiveHideSidebar && typeof document !== "undefined" && createPortal(
          <div
            role="separator"
            aria-orientation="vertical"
            // Hidden while a pop-up is open (app/globals.css) — it's on the very top layer, so it would show over it.
            data-sidebar-resize-handle="true"
            aria-label={isSidebarResizeLocked ? "Sidebar resizing is locked" : isSidebarIconOnly ? "Expand sidebar" : "Collapse sidebar"}
            title={isSidebarResizeLocked ? "Sidebar resizing is locked — unlock it in User Settings" : isSidebarIconOnly ? "Expand sidebar" : "Collapse sidebar"}
            onPointerDown={(e) => {
              if (isSidebarResizeLocked) return;
              e.preventDefault();
              // preventDefault on pointerdown suppresses the compatibility mousedown event that
              // would otherwise follow — which is exactly what the "click outside closes the user
              // settings panel" listener (below, keyed off native mousedown) is listening for. Left
              // open, isUserSettingsPanelOpen silently stayed true across the whole resize, so once
              // the sidebar finished expanding and swapped back to the full-width branch, THAT
              // branch — reading the same still-true isUserSettingsPanelOpen — showed the full
              // SidebarUserSettingsPanel (with its own Settings-like fields and Log out button)
              // instead of the plain badge: exactly the "Settings/Log out flash at the end of the
              // slide" that was reported. Closing it explicitly here, before the drag can even
              // start, means a resize never inherits whatever the popover's state happened to be.
              closeUserSettingsPanel();
              sidebarResizeDragRef.current = { startX: e.clientX, startWidth: sidebarWidthPx, moved: false };
            }}
            className={cn(
              "group fixed top-0 hidden h-full w-[9px] -translate-x-1/2 items-center justify-center lg:flex",
              isSidebarResizeLocked ? "cursor-default" : "cursor-col-resize",
            )}
            style={{ left: sidebarWidthPx, zIndex: 2147483647, transition: "left 200ms ease" }}
          >
            {/* bg-transparent as a CLASS, not an inline style — an inline backgroundColor would
                permanently win over the group-hover:bg-[...] class below regardless of hover state
                (inline style always beats a class for the same CSS property), which is exactly why
                this line's color previously never actually changed on hover. Locked mode drops the
                group-hover classes entirely — no point inviting a drag/hover affordance that no
                longer does anything. */}
            <div
              className={cn(
                "h-full w-px bg-transparent transition-[background-color,width] duration-150",
                !isSidebarResizeLocked && "group-hover:w-[3px] group-hover:bg-[var(--brand)]",
              )}
            />
            {/* Dead center of the screen — top:50% against the divider's own fixed, always-100vh
                height, not the scrollable page, so it stays anchored to the middle of the viewport
                regardless of scroll position. This is both the drag handle (grab anywhere on it,
                or anywhere along the thin divider line above) and a click-to-toggle shortcut for
                the common "just collapse/expand it" case. Deliberately NOT pointer-events-none —
                it's visually wider (20px) than the divider's own 9px hit strip it sits inside, so
                without its own pointer events, hovering the parts of it that stick out either side
                hit nothing at all (no group-hover), making the line's own hover state (and this
                pill's own opacity) flicker off the moment the cursor was actually ON the button.
                Pointer events bubble up to the parent's own onPointerDown regardless, so drag/click
                still work identically from here as from the line itself. Not rendered at all while
                locked — there's nothing to grab. */}
            {!isSidebarResizeLocked && (
              <div
                className="absolute flex h-9 w-5 items-center justify-center rounded-full opacity-0 shadow-[var(--shadow-sm)] transition-opacity group-hover:opacity-100"
                style={{ top: "50%", left: "50%", transform: "translate(-50%, -50%)", backgroundImage: "var(--brand-gradient)" }}
              >
                <GripVertical size={12} color="#ffffff" />
              </div>
            )}
          </div>,
          document.body,
        )}
        {!isSidebarIconOnlyContent && (
          <div className="sidebar-label-fade-in border-b border-[var(--panel-border)]" style={{ borderColor: shellPalette.border }}>
            {companyLogoPath ? (
              <img
                src={companyLogoPath}
                alt={`${companyDisplayName} logo`}
                className="block h-auto w-full"
                onError={(e) => {
                  e.currentTarget.style.display = "none";
                }}
              />
            ) : companyDisplayName ? (
              <p className="truncate px-4 py-3 text-[13px] font-semibold text-[var(--text-main)]" style={{ color: shellPalette.text }}>{companyDisplayName}</p>
            ) : null}
          </div>
        )}

        <div className="relative flex min-h-0 h-full flex-1 flex-col px-3 pb-3 pt-3">
          {canCreateProject && (
            <button
              type="button"
              onClick={(e) => { newProjectModalOriginElRef.current = e.currentTarget; setAssigneeUid(""); setNewProjectOrigin(captureGlassModalOrigin(e)); setShowNewProject(true); }}
              title={isSidebarIconOnlyContent ? "New Project" : undefined}
              // The glass shine (lib/glass-shine.ts), in the brand blue, round-ended.
              className="glass-shine mb-3 flex h-10 w-full shrink-0 items-center justify-center gap-2 rounded-full text-[13px] font-semibold text-white transition hover:brightness-105"
              style={glassShineStyle("var(--brand)")}
            >
              <Plus size={20} strokeWidth={2.5} className="shrink-0" />
              {!isSidebarIconOnlyContent && <span className="sidebar-label-fade-in min-w-0 truncate">New Project</span>}
            </button>
          )}
          {/* Its pages' list, when the window's too short for them all: the glass scrollbar (drawn over it), not the
              browser's own — that took 10px off the list's width (its rows, and the selected one's highlight, stopping
              short) and showed as a pale strip down the sidebar's edge. */}
          <GlassScrollbarThumb scrollRef={navListRef} />
          <div
            ref={navListRef}
            className="hide-native-scrollbar relative min-h-0 flex-1 space-y-0.5 overflow-y-auto pr-1"
            style={{
              marginBottom: navListMarginBottom || undefined,
              transition: "margin-bottom 320ms cubic-bezier(0.22, 1, 0.36, 1)",
            }}
          >
            {navHighlightRect && (
              <div
                ref={navHighlightRef}
                aria-hidden="true"
                // See-through glass (globals.css .nav-active-glass), as the phone menu's selected row.
                className="nav-active-glass absolute left-0 right-1 rounded-[10px]"
                style={{
                  top: navHighlightRect.top,
                  height: navHighlightRect.height,
                  transition: NAV_HIGHLIGHT_TRANSITION,
                  // Gone while its page's section is folded away.
                  opacity: navHighlightRect.folded ? 0 : 1,
                  zIndex: 0,
                }}
              />
            )}
            {visibleNavGroups.map((group, groupIdx) => {
              // Folded away (its heading's arrow — toggleNavGroup) — but not while the sidebar's only icons, with no
              // heading to open it again from.
              const isFolded = !isSidebarIconOnlyContent && Boolean(foldedNavGroups[group.name]);
              return (
                <Fragment key={group.name}>
                  {/* Its name, over its pages (as Company Settings' own side nav), a line on across the rest of the row
                      and the arrow that folds it away at the end — just the line between sections when the sidebar's
                      only icons. */}
                  {isSidebarIconOnlyContent ? (
                    groupIdx > 0 ? <div className="mx-2 my-2 h-px" style={{ backgroundColor: shellPalette.border }} /> : null
                  ) : (
                    <button
                      type="button"
                      onClick={() => toggleNavGroup(group.name)}
                      aria-expanded={!isFolded}
                      title={isFolded ? `Show ${group.name}` : `Hide ${group.name}`}
                      className={cn(
                        "sidebar-label-fade-in flex w-full items-center gap-2 px-3 pb-1 text-left text-[10.5px] font-bold uppercase tracking-[0.8px] transition-opacity hover:opacity-75",
                        groupIdx === 0 ? "pt-1" : "pt-3",
                      )}
                      style={{ color: shellPalette.textMuted }}
                    >
                      <span className="min-w-0 truncate">{group.name}</span>
                      <span aria-hidden="true" className="h-px min-w-3 flex-1" style={{ backgroundColor: shellPalette.border }} />
                      <ChevronDown
                        size={13}
                        strokeWidth={2.5}
                        aria-hidden="true"
                        className="shrink-0 transition-transform duration-200"
                        style={{ transform: isFolded ? "none" : "rotate(180deg)" }}
                      />
                    </button>
                  )}
                  <div
                    data-nav-folded={isFolded ? "true" : undefined}
                    inert={isFolded}
                    className="grid"
                    style={{
                      gridTemplateRows: isFolded ? "0fr" : "1fr",
                      transition: animatedNavGroup === group.name ? NAV_GROUP_FOLD_TRANSITION : undefined,
                    }}
                  >
                    <div className="min-h-0 space-y-0.5 overflow-hidden">
                      {group.items.map((item) => {
                        const active = pathname?.startsWith(item.href);
                        const Icon = item.icon;
                        return (
                          <Link
                            key={item.href}
                            href={item.href}
                            ref={(el) => {
                              navLinkRefs.current[item.href] = el;
                            }}
                            title={isSidebarIconOnlyContent ? item.label : undefined}
                            className={cn(
                              "relative z-[1] flex items-center gap-2.5 rounded-[10px] py-2.5 text-[13px] font-medium transition-colors",
                              isSidebarIconOnlyContent ? "justify-center px-0" : "px-3",
                              !active && "hover:bg-[var(--panel-muted)]",
                            )}
                            style={{
                              color: active ? "var(--brand)" : shellPalette.textMuted,
                            }}
                          >
                            <Icon size={17} className="shrink-0" />
                            {!isSidebarIconOnlyContent && <span className="sidebar-label-fade-in min-w-0 truncate">{item.label}</span>}
                          </Link>
                        );
                      })}
                    </div>
                  </div>
                </Fragment>
              );
            })}
          </div>

          {/* Downloads: just above the account row, under it (z-1 vs its z-5) — so the settings panel covers it as it
              slides up. */}
          <div className="absolute inset-x-3 z-[1]" style={{ bottom: (restContentHeight ?? 0) + 4 }}>
            <button
              type="button"
              onClick={(e) => {
                downloadsOriginElRef.current = e.currentTarget;
                setDownloadsOrigin(captureGlassModalOrigin(e));
                setDownloadsCompanyId(
                  String(window.localStorage.getItem(ACTIVE_COMPANY_STORAGE_KEY) || "").trim() || String(user?.companyId || "").trim(),
                );
                setShowDownloads(true);
              }}
              title={isSidebarIconOnlyContent ? "Downloads" : undefined}
              className={cn(
                "flex w-full items-center gap-2.5 rounded-[10px] py-2.5 text-[13px] font-medium transition-colors hover:bg-[var(--panel-muted)]",
                isSidebarIconOnlyContent ? "justify-center px-0" : "px-3",
              )}
              style={{ color: shellPalette.textMuted }}
            >
              <Download size={17} className="shrink-0" />
              {!isSidebarIconOnlyContent && <span className="sidebar-label-fade-in min-w-0 truncate">Downloads</span>}
            </button>
          </div>

          {/* Bottom section: bottom-anchored overlay whose height animates between the measured
              content heights below. The nav list above always reserves restContentHeight of
              space (its own marginBottom) so it never compresses or scrolls differently — this
              section just slides its top edge (the divider) further up, over the nav list, to
              reveal more.
              Full-width mode: the badge row and SidebarUserSettingsPanel are grid-stacked in the
              same cell and crossfade via opacity — the panel REPLACES the badge row, so the open
              height is just panelContentHeight.
              Icon-only mode: the badge must stay put (not fade away or get covered) and the
              Settings/Log out icons reveal ABOVE it — so instead of stacking in one grid cell,
              they're two normal-flow children (icons first, badge last) inside an inner wrapper
              that's itself pinned to THIS bar's own bottom edge, independent of the bar's own
              animating height. The badge's position within that inner wrapper never moves;
              growing/shrinking the outer overflow-hidden bar just reveals or clips more of the
              icon stack sitting above it. Open height is restContentHeight + panelContentHeight
              (badge height plus icon-stack height) instead of panelContentHeight alone. */}
          <div
            className="absolute inset-x-0 bottom-0 z-[5] overflow-hidden"
            style={{
              height:
                (isSidebarIconOnlyContent
                  ? isUserSettingsPanelOpen
                    ? (restContentHeight ?? 0) + (panelContentHeight ?? 0)
                    : restContentHeight
                  : isUserSettingsPanelOpen
                    ? panelContentHeight
                    : restContentHeight) ?? undefined,
              backgroundColor: "var(--glass-bg-strong)",
              backdropFilter: "blur(24px) saturate(180%)",
              WebkitBackdropFilter: "blur(24px) saturate(180%)",
              transition: "height 320ms cubic-bezier(0.22, 1, 0.36, 1)",
            }}
          >
            {/* key="icon-only"/"full-width" on these two branches — without an explicit key,
                React sees the same host tag ("div") at the same tree position on either side of
                this ternary and reconciles them as ONE element it patches in place, rather than
                unmounting one and mounting the other. Their CHILDREN are two more same-tag divs
                whose ORDER IS REVERSED between branches (icon-only: Settings/Log out icons first,
                badge second — full-width: badge first, SidebarUserSettingsPanel second), so that
                same keyless patching then paired position 1 with position 1 and position 2 with
                position 2 ACROSS branches — briefly carrying the icon-only Settings/Log out
                buttons' DOM into what should already be the full-width badge's slot, which is
                exactly what showed up as a flash of "Settings"/"Log out" at the top of the bar
                right as the sidebar finished expanding. A key forces a clean unmount + fresh mount
                on every branch swap instead. */}
            {isSidebarIconOnlyContent ? (
              <div key="icon-only" className="absolute inset-x-0 bottom-0">
                <div
                  ref={bottomPanelContentRef}
                  className="flex flex-col items-center gap-5 pb-2 pt-3"
                  style={{
                    opacity: showBottomPanelContent ? 1 : 0,
                    pointerEvents: showBottomPanelContent ? "auto" : "none",
                    transition: "opacity 200ms ease",
                  }}
                >
                  <button
                    type="button"
                    onClick={() => {
                      closeUserSettingsPanel();
                      router.push("/user-settings");
                    }}
                    className="inline-flex h-7 w-7 items-center justify-center rounded-[8px] transition hover:bg-[var(--panel-muted)]"
                    style={{ color: shellPalette.textMuted }}
                    aria-label="Settings"
                    title="Settings"
                  >
                    <Settings size={17} />
                  </button>
                  <button
                    type="button"
                    onClick={(e) => {
                      closeUserSettingsPanel();
                      setLogoutConfirmOrigin(captureGlassModalOrigin(e));
                      setShowLogoutConfirm(true);
                    }}
                    className="inline-flex h-7 w-7 items-center justify-center rounded-[8px] transition hover:bg-[var(--panel-muted)]"
                    style={{ color: shellPalette.textMuted }}
                    aria-label="Log out"
                    title="Log out"
                  >
                    <LogOut size={17} />
                  </button>
                </div>
                <div ref={bottomRestContentRef} className="border-t pb-3 pt-3" style={{ borderColor: shellPalette.border }}>
                  <button
                    type="button"
                    onClick={openUserSettingsPanel}
                    className="flex w-full items-center justify-center gap-2 rounded-[10px] px-0 py-2 text-left transition hover:bg-[var(--panel-muted)]"
                    aria-label="Open user settings"
                  >
                    <div
                      className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-[11px] font-extrabold text-white"
                      style={{ backgroundColor: userEmblemColor }}
                    >
                      {userInitials}
                    </div>
                  </button>
                </div>
              </div>
            ) : (
              // grid-template-columns: minmax(0, 1fr), not the implicit default — an unconstrained
              // auto column sizes itself to the MAX-CONTENT width of every item stacked into it,
              // including SidebarUserSettingsPanel below even while it's invisible (opacity:0, but
              // still mounted so its height stays measurable). minmax(0, 1fr) caps the track at
              // the container's own available space no matter what its content would prefer.
              <div key="full-width" className="grid items-start" style={{ gridTemplateColumns: "minmax(0, 1fr)" }}>
                <div
                  ref={bottomRestContentRef}
                  className="border-t pb-3 pt-3"
                  style={{
                    gridArea: "1 / 1",
                    borderColor: shellPalette.border,
                    opacity: showBottomRestContent ? 1 : 0,
                    pointerEvents: showBottomRestContent ? "auto" : "none",
                    transition: "opacity 200ms ease",
                  }}
                >
                  <button
                    type="button"
                    onClick={openUserSettingsPanel}
                    className="flex w-full items-center gap-2 rounded-[10px] px-2 py-2 text-left transition hover:bg-[var(--panel-muted)]"
                    aria-label="Open user settings"
                  >
                    <div
                      className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-[11px] font-extrabold text-white"
                      style={{ backgroundColor: userEmblemColor }}
                    >
                      {userInitials}
                    </div>
                    <div className="sidebar-label-fade-in min-w-0 flex-1">
                      <p className="m-0 block truncate text-[12px] font-semibold" style={{ color: shellPalette.text }}>{user?.displayName || "CutSmart User"}</p>
                      {isDemoMode && (
                        <span className="block truncate text-[10px] font-semibold" style={{ color: "#B7791F" }}>{isPreviewMode() ? "CutSmart Preview" : "Demo data mode"}</span>
                      )}
                    </div>
                  </button>
                </div>

                <div
                  ref={bottomPanelContentRef}
                  style={{
                    gridArea: "1 / 1",
                    opacity: showBottomPanelContent ? 1 : 0,
                    pointerEvents: showBottomPanelContent ? "auto" : "none",
                    transition: "opacity 220ms ease",
                  }}
                >
                  <SidebarUserSettingsPanel
                    isOpen={isUserSettingsPanelOpen}
                    onRequestClose={closeUserSettingsPanel}
                    onRequestLogout={(e) => { logoutConfirmOriginElRef.current = e.currentTarget; setLogoutConfirmOrigin(captureGlassModalOrigin(e)); setShowLogoutConfirm(true); }}
                  />
                </div>
              </div>
            )}
          </div>
        </div>

        <VerifyAccountModal
          open={isAutoVerifyModalOpen}
          onClose={() => setIsAutoVerifyModalOpen(false)}
        />
      </aside>

      {/* Rendered as a sibling of (not nested inside) the data-app-main-push div below — that div
          gets a live CSS `transform` written directly to its style during the sidebar/notif push
          gestures, which makes it a containing block for any `position: fixed` descendant (per
          spec) and traps this banner inside its own, much lower, local stacking context. Nested,
          the banner silently rendered BEHIND the global top tab bar (z-[95], a true sibling at the
          document root) no matter how high its own z-index was set. As a real top-level sibling
          here, it stacks normally against the tab bar. Shown on every mobile page regardless of
          chromeHidden (fullscreen views included) — only the "Mobile Top Nav Bar" preference turns
          the gesture off.
          Pinned at the true top (top-0), starting at the tab bar's own resting height
          (PULL_BANNER_MIN_HEIGHT_PX) and growing in lockstep with it as you keep pulling (see
          PULL_BANNER_MAX_HEIGHT_PX) — "it should be able to stretch higher, not stop at the tab
          bar's normal height." Sits above the tab bar (z-[150] against its z-[95]) in the exact
          same position/width, invisible (opacity 0, pointer-events none) at rest. Solid
          --panel-bg (the same base colour the tab bar's own translucent glass backdrop is built
          from, just fully opaque) rather than transparent — a genuinely see-through pulldown surface
          let whatever sits underneath it at a lower z-index (a chromeHidden view's own fixed title
          bar backdrop, or Quote/Specifications' own formatting toolbar, both z-[95]) show straight
          through despite being behind it, reading as "in front of" the pulldown rather than safely
          covered by it. This only ever holds the pulldown icons on top of that background, which
          fade IN as the tab bar's own CONTENT (not its background) fades OUT, over a short
          PULL_FADE_DISTANCE_PX so the switch reads as near-instant — the same opacity transition now
          carries this solid background in at the same rate, so the covered-up effect ramps in
          together with the icons rather than snapping in abruptly. */}
      {!isDesktopViewport && mobileTopBarEnabled && devModeOn && (
        // Dev mode: the pull-down menu, shown pulled down to look at (openPullPreview) — floating just
        // under the bar, or under the menu while it's open.
        <button
          type="button"
          onClick={() => (pullPreviewOpen ? closePullPreview() : openPullPreview())}
          className={`fixed left-1/2 z-[160] -translate-x-1/2 transition-[top] duration-200 ${devButtonClass(pullPreviewOpen)}`}
          style={{
            top: (pullPreviewOpen ? PULL_BANNER_MAX_HEIGHT_PX : PULL_BANNER_MIN_HEIGHT_PX) + 8,
            borderColor: "var(--glass-border)",
            backgroundColor: "var(--panel-bg)",
            color: "var(--text-muted)",
          }}
        >
          {pullPreviewOpen ? "close test navigation" : "test navigation"}
        </button>
      )}
      {!isDesktopViewport && mobileTopBarEnabled && (
        <div
          ref={pullBannerRef}
          aria-hidden="true"
          // Only the dev "test navigation" preview takes taps here (onPullPreviewTap) — the real pull
          // gesture is all touch handling on <main>.
          onClick={pullPreviewOpen ? (event) => onPullPreviewTap(event.clientX) : undefined}
          className="fixed left-0 right-0 top-0 z-[150] flex"
          style={{
            height: PULL_BANNER_MIN_HEIGHT_PX,
            opacity: 0,
            pointerEvents: "none",
            // The page's own colour — the same as the top tab bar's strip it grows out of, on every
            // page — with a faint line along its bottom edge so it still reads as pulled down over the
            // page.
            backgroundColor: isFlatPage(pathname) ? flatPageBg(themeMode === "dark") : "var(--bg-app)",
            boxShadow: "inset 0 -1px 0 var(--glass-border)",
          }}
        >
          {/* One shared circle (not one per zone) that lives under whichever zone is selected —
              see applyPullZoneStyles/triggerPullBubbleTravel, which slide it via a plain CSS
              transition. Sized/colored entirely via direct style writes, so its resting state here
              is just a zero-size placeholder that gets positioned before it's ever visible. */}
          <div
            ref={pullActivePillRef}
            aria-hidden="true"
            className="pointer-events-none absolute rounded-full"
            style={{ left: 0, top: 0, width: 0, height: 0, backgroundColor: "transparent" }}
          />
          <div ref={pullReloadZoneRef} className="relative flex flex-1 flex-col items-center justify-center gap-1">
            <div data-pull-icon="true" className="flex h-11 w-11 items-center justify-center" style={{ color: "var(--text-muted)" }}>
              <RefreshCw size={22} className="shrink-0" />
            </div>
            <span
              data-pull-label="true"
              className="text-[11px] font-bold transition-opacity"
              style={{ opacity: 0, color: "var(--text-muted)", transitionDuration: "150ms" }}
            >
              Reload
            </span>
          </div>
          <div ref={pullDashboardZoneRef} className="relative flex flex-1 flex-col items-center justify-center gap-1">
            <div data-pull-icon="true" className="flex h-11 w-11 items-center justify-center" style={{ color: "var(--brand-strong)" }}>
              <LayoutDashboard size={22} className="shrink-0" />
            </div>
            <span
              data-pull-label="true"
              className="text-[11px] font-bold transition-opacity"
              style={{ opacity: 1, color: "var(--text-muted)", transitionDuration: "150ms" }}
            >
              Dashboard
            </span>
          </div>
          <div ref={pullSaveBackZoneRef} className="relative flex flex-1 flex-col items-center justify-center gap-1">
            <div data-pull-icon="true" className="flex h-11 w-11 items-center justify-center" style={{ color: "var(--text-muted)" }}>
              <Save size={22} className="shrink-0" />
            </div>
            <span
              data-pull-label="true"
              className="text-[11px] font-bold transition-opacity"
              style={{ opacity: 0, color: "var(--text-muted)", transitionDuration: "150ms" }}
            >
              Save & Back
            </span>
          </div>
        </div>
      )}
      <div
        ref={mainPushRef}
        data-app-main-push="true"
        className={chromeHidden ? "min-w-0" : "min-w-0 pt-12"}
        style={{
          // The strip under the see-through top tab bar: the page's own colour, on every page — left
          // unpainted, the body's soft colour washes showed through there, a different shade from the
          // page under it.
          backgroundColor: isFlatPage(pathname) ? flatPageBg(themeMode === "dark") : "var(--bg-app)",
          width: "100%",
          paddingLeft: 0,
          overflowX: "visible",
          overflowY: "visible",
        }}
      >
        <main
          ref={mainScrollRef}
          // Some pages on a phone/tablet (startsUnderTopBar, lib/flat-page.ts), where <main> is the
          // page's scroller: it starts at the very top of the screen, under the see-through top tab
          // bar, instead of below it (globals.css) — otherwise it cut off anything reaching up past its
          // top edge (the Dashboard stat cards', the Settings card's shadows) in a hard line along the
          // bar. The page also scrolls under the bar's glass then, the same as on desktop.
          data-under-bar={startsUnderTopBar(pathname) && !isDesktopViewport && !chromeHidden && !ownsMobileScroll ? "true" : undefined}
          // A page without <main>'s own top padding (reduceMainTopPadding) keeps none under the bar too.
          data-reduce-top={!chromeHidden && reduceMainTopPadding ? "true" : undefined}
          className={
            chromeHidden
              ? "min-h-0 min-w-0 overscroll-y-contain hide-native-scrollbar"
              : "min-h-0 min-w-0 overscroll-y-contain hide-native-scrollbar px-3 py-3 md:px-4 md:py-4 lg:px-5 lg:py-4"
          }
          onTouchStart={onMainTouchStart}
          onTouchMove={onMainTouchMove}
          onTouchEnd={onMainTouchEnd}
          onTouchCancel={onMainTouchEnd}
          style={{
            // Mobile uses svh (not dvh) for its own height here — dvh recalculates live as
            // Safari's address bar shows/hides mid-scroll, and since THIS element is the one
            // actually scrolling on mobile (overflowY: auto below), that live resize happened
            // while the user's finger was still moving: the container's height changed out from
            // under an in-progress scroll, leaving a grey gap at the bottom (content hadn't
            // caught up to the new, larger height) and misaligning the sticky header above it.
            // svh is fixed at the smallest the viewport ever gets, so it never shifts mid-scroll.
            height: chromeHidden
              ? (isDesktopViewport ? "100dvh" : "100svh")
              : isDesktopViewport
                ? fillMainViewport
                  ? "calc(100dvh - 48px)" // matches this wrapper's own lg:pt-12
                  : "auto"
                : "calc(100svh - 48px)", // mobile now reserves only the one GlobalAppTabsBar (h-12)
            // Desktop pages grow with their content ("auto" above), so a short one (e.g. Archive) used to
            // stop this background part-way down the screen, with the body's own background showing
            // underneath — at least the full height below the top bar keeps it reaching the bottom.
            minHeight: !chromeHidden && isDesktopViewport && !fillMainViewport ? "calc(100dvh - 48px)" : undefined,
            overflowX: isDesktopViewport ? "visible" : "clip",
            // ownsMobileScroll: Quote/Specifications specifically — see this flag's own comment in
            // app-tabs-context.tsx. Their own data-app-scroll-root wrapper is sized to exactly
            // match <main>'s height and handles all scrolling itself; leaving <main> ALSO
            // independently scrollable at that point is a redundant, identically-sized nested
            // scroll container with nothing legitimate to ever scroll, which is what risked a
            // sub-pixel rounding mismatch turning into a real (if tiny) scroll range here.
            overflowY: isDesktopViewport ? "visible" : ownsMobileScroll ? "hidden" : "auto",
            paddingLeft: chromeHidden ? 0 : "max(12px, env(safe-area-inset-left))",
            paddingRight: chromeHidden ? 0 : "max(12px, env(safe-area-inset-right))",
            paddingBottom: chromeHidden || isDesktopViewport ? 0 : "max(12px, env(safe-area-inset-bottom))",
            // Lets a page (e.g. project details' sticky header) opt out of this
            // element's own top padding entirely, so its sticky bars can sit flush
            // at <main>'s top edge with zero gap on load — without needing a
            // negative margin on any ancestor of a position:sticky element, which
            // reproducibly froze the sticky element in place while everything else
            // in the flow visually shifted.
            paddingTop: !chromeHidden && reduceMainTopPadding ? 0 : undefined,
            marginLeft: "0",
            WebkitOverflowScrolling: "touch",
            // <main> itself was fully transparent, relying on body's own fixed gradient
            // background to show through everywhere, including its own reserved
            // safe-area-inset-bottom padding on mobile — on at least one real device this reads
            // as a flat grey band at the very bottom instead of the app's actual background,
            // rather than the intended gradient. Giving it its own explicit background closes
            // that gap regardless of the exact cause.
            backgroundColor: isFlatPage(pathname) ? flatPageBg(themeMode === "dark") : "var(--bg-app)",
          }}
        >
          {/* height:100% is a no-op unless <main> itself has a definite height
              (fillMainViewport, or mobile's own dvh calc above) — safe to apply
              unconditionally so a page can opt into filling <main> exactly by
              making its own root height:100% + a flex column, without needing
              any page-specific plumbing here beyond the fillMainViewport flag. */}
          <div className={effectiveHideSidebar ? "" : "app-content-sidebar-margin"} style={{ height: "100%" }}>{children}</div>
        </main>
        {/* Phones/tablets: <main> is the page's scroller (desktop scrolls the document — see
            <DocumentScrollbar /> in app/layout.tsx) — the same glass thumb, starting below the title
            bars. Fullscreen views (chromeHidden) and Quote/Specs (ownsMobileScroll) bring their own. */}
        {!isDesktopViewport && !chromeHidden && !ownsMobileScroll ? <GlassScrollbarThumb scrollRef={mainScrollRef} /> : null}
      </div>
      {/* What's New: the published version, once per person — or a Dev's preview of a draft, to publish it. */}
      {showUpdateNotice && whatsNewIsDraft && previewDraft ? (
        <WhatsNewSheet
          version={previewDraft.version}
          dateIso=""
          whatsNew={previewDraft.whatsNew}
          highlights={previewDraft.highlights}
          draft
          onClose={closeDraftPreview}
          onPublished={onDraftPublished}
        />
      ) : showUpdateNotice && !whatsNewIsDraft && updateNoticeVersion ? (
        <WhatsNewSheet
          version={updateNoticeVersion}
          dateIso={updateNoticeDateIso}
          whatsNew={updateNoticeText}
          highlights={updateNoticeHighlights}
          draft={false}
          onClose={dismissUpdateNotice}
        />
      ) : null}
      {/* Dev users: a deployed version that isn't published yet — preview it and publish it. */}
      {isDevUser && previewDraft && !showUpdateNotice ? (
        <button data-bottom-bar=""
          type="button"
          onClick={() => window.dispatchEvent(new Event(OPEN_WHATS_NEW_DRAFT_EVENT))}
          className="fixed left-4 z-[60] inline-flex h-9 items-center gap-1.5 rounded-full border px-3.5 text-[12px] font-semibold text-white shadow-[0_8px_22px_rgba(15,23,42,0.22)] transition hover:brightness-105"
          style={{ bottom: "calc(20px + env(safe-area-inset-bottom))", backgroundImage: "var(--brand-gradient)", borderColor: "var(--brand-strong)" }}
        >
          <Sparkles size={14} />
          {previewIsScheduled
            ? `Scheduled ${previewDraft.version} · ${releaseCountdown || "scheduled"}`
            : `Draft ${previewDraft.version} · Preview & publish`}
        </button>
      ) : null}

      {shouldRenderNewProjectModal && (
        <div
          className="glass-modal-backdrop fixed inset-0 z-[9000] flex items-center justify-center p-0 sm:px-4"
          onClick={(e) => {
            if (e.target !== e.currentTarget) return;
            if (hasNewProjectFormContent()) return;
            closeNewProject();
          }}
        >
          {/* New Project — or, with Small Job switched on (top right), a small job, into Small Jobs instead
              (lib/small-jobs.ts). Laid out as the page it opens into: what it is and who it's for down the left, its
              notes and photos down the right. Ctrl/⌘+Enter creates it. */}
          <div
            ref={newProjectPanelRef}
            role="dialog"
            aria-modal="true"
            aria-label={newProjectIsSmallJob ? "New Small Job" : "New Project"}
            // A phone: the whole screen, keyboard up or not (as Leads' lead pop-up — data-phone-fullscreen, app/globals.css).
            // Bigger: room for its cards side by side without scrolling (still within the screen's edges).
            data-phone-fullscreen="true"
            className="glass-modal-panel relative flex h-full w-full flex-col overflow-hidden max-sm:rounded-none! max-sm:border-0! sm:h-[min(880px,calc(100dvh_-_16px))] sm:w-[min(1160px,calc(100vw_-_16px))]"
            onKeyDown={(e) => {
              if (e.key !== "Enter" || !(e.ctrlKey || e.metaKey)) return;
              e.preventDefault();
              void onCreateProject();
            }}
          >
            {/* As every pop-up's header (GlassModalHeader — the Schedule pop-up's): 56px, its icon and title in 14px bold
                capitals; on a phone, under the notch. */}
            <div className="glass-modal-header flex h-[56px] shrink-0 items-center gap-3 px-5 max-sm:h-[calc(56px+env(safe-area-inset-top))] max-sm:pt-[env(safe-area-inset-top)]">
              <div className="flex min-w-0 flex-1 items-center gap-2 text-[var(--text-main)]">
                {newProjectIsSmallJob ? <Hammer size={16} className="shrink-0" /> : <FolderPlus size={16} className="shrink-0" />}
                <p className="min-w-0 truncate text-[14px] font-bold uppercase tracking-[1px]">{newProjectIsSmallJob ? "New Small Job" : "New Project"}</p>
              </div>
              {/* Small Job: this one into Small Jobs instead of onto the Dashboard. */}
              <button
                type="button"
                role="switch"
                aria-checked={newProjectIsSmallJob}
                onClick={() => setNewProjectIsSmallJob((on) => !on)}
                title={newProjectIsSmallJob ? "Make it a full project, on the Dashboard" : "Make it a small job, in Small Jobs"}
                className={cn(
                  "inline-flex h-9 shrink-0 items-center gap-2 rounded-full border pl-3 pr-1.5 text-[13px] font-medium transition",
                  newProjectIsSmallJob ? "glass-shine text-white hover:brightness-105" : "hover:bg-[var(--panel-muted)]",
                )}
                style={
                  newProjectIsSmallJob
                    ? glassShineStyle(SMALL_JOB_COLOR)
                    : { borderColor: "var(--panel-border)", backgroundColor: "var(--panel-bg)", color: "var(--text-main)" }
                }
              >
                <Hammer size={14} className="shrink-0" />
                <span>Small Job</span>
                <span
                  aria-hidden="true"
                  className="relative h-[18px] w-[30px] shrink-0 rounded-full transition-colors duration-200"
                  style={{
                    backgroundColor: newProjectIsSmallJob ? "rgba(255,255,255,0.35)" : "color-mix(in srgb, var(--text-muted) 35%, transparent)",
                  }}
                >
                  <span
                    className="absolute top-[3px] h-3 w-3 rounded-full bg-white shadow-[0_1px_2px_rgba(0,0,0,0.25)] transition-[left] duration-200"
                    style={{ left: newProjectIsSmallJob ? 15 : 3 }}
                  />
                </span>
              </button>
              <button type="button" onClick={closeNewProject} className={modalCloseButtonClass} aria-label="Close" title="Close">
                <X size={16} />
              </button>
            </div>
            {/* data-keyboard-scroll-pad: on a phone, room under its fields for the keyboard (the one being typed in scrolled up above it). */}
            <div ref={newProjectScrollRef} data-keyboard-scroll-pad="true" className="glass-scroll relative min-h-0 flex-1 overflow-y-auto px-4 py-4 sm:px-6 sm:py-5">
              {/* On a computer its two columns fill the pop-up's height — the Client card and Notes taking what's left. */}
              <div className="grid gap-4 lg:min-h-full lg:grid-cols-2">
                <div className="flex flex-col gap-4">
                  {/* What it is — and who's on it, and (a project's) its tags. */}
                  <section className={newProjectCardClass}>
                    <div className={newProjectCardHeaderClass}>
                      {newProjectIsSmallJob ? (
                        <Hammer size={14} className="shrink-0 text-[var(--text-muted)]" />
                      ) : (
                        <FolderPlus size={14} className="shrink-0 text-[var(--text-muted)]" />
                      )}
                      <span className={newProjectCardTitleClass}>{newProjectIsSmallJob ? "Job" : "Project"}</span>
                    </div>
                    <div className="space-y-3.5 p-4">
                      <div>
                        <label htmlFor="new-project-name" className={newProjectLabelClass}>
                          {newProjectIsSmallJob ? "Job name" : "Project name"} <span className="text-[var(--danger)]">*</span>
                        </label>
                        <input
                          {...NEW_PROJECT_NO_AUTOFILL}
                          id="new-project-name"
                          ref={newProjectNameInputRef}
                          autoFocus={isDesktopViewport}
                          value={projectName}
                          onChange={(e) => {
                            setProjectName(e.target.value);
                            clearNewProjectInvalid("name");
                          }}
                          aria-invalid={newProjectInvalidField === "name" || undefined}
                          className={cn(newProjectFieldClass(newProjectInvalidField === "name"), "h-11 text-[15px] font-medium")}
                          placeholder={newProjectIsSmallJob ? "e.g. Replace toekick" : "e.g. Smith kitchen renovation"}
                        />
                        {newProjectInvalidField === "name" ? (
                          <p className="mt-1 text-[11.5px] font-medium text-[var(--danger)]">Give it a name to find it by.</p>
                        ) : null}
                      </div>
                      {canCreateForOthers && (
                        <div>
                          <p className={newProjectLabelClass}>{newProjectIsSmallJob ? "Assign job to" : "Assign project to"}</p>
                          <div ref={assigneeFieldRef} className="relative">
                            <button
                              type="button"
                              onClick={toggleAssigneeMenu}
                              aria-haspopup="listbox"
                              aria-expanded={assigneeMenuOpen}
                              className={cn(newProjectFieldClass(), "flex items-center justify-between gap-2 text-left")}
                            >
                              <span className="flex min-w-0 items-center gap-2">
                                {selectedAssignee ? (
                                  renderStaffOptionBadge(selectedAssignee, 22)
                                ) : (
                                  <span className="inline-flex h-[22px] w-[22px] shrink-0 items-center justify-center rounded-full border border-dashed border-[var(--panel-border)] text-[var(--text-muted)]">
                                    <UserRound size={12} />
                                  </span>
                                )}
                                <span className={cn("truncate", !selectedAssignee && "text-[var(--text-muted)]")}>{selectedAssignee?.name || "Unassigned"}</span>
                              </span>
                              <ChevronDown
                                size={15}
                                className="shrink-0 text-[var(--text-muted)] transition-transform duration-200"
                                style={{ transform: assigneeMenuOpen ? "rotate(180deg)" : "none" }}
                              />
                            </button>
                            {assigneeMenuOpen && assigneeMenuPos
                              ? createPortal(
                                  <div
                                    ref={assigneeMenuRef}
                                    className="fixed flex flex-col overflow-hidden rounded-[12px] border shadow-[var(--shadow-md)]"
                                    style={{
                                      ...FLOATING_MENU_STYLE,
                                      left: assigneeMenuPos.left,
                                      width: assigneeMenuPos.width,
                                      top: assigneeMenuPos.top,
                                      bottom: assigneeMenuPos.bottom,
                                      maxHeight: assigneeMenuPos.maxHeight,
                                    }}
                                  >
                                    <div className="relative shrink-0 border-b border-[var(--glass-border)] p-2">
                                      <Search size={13} className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-[var(--text-muted)]" />
                                      <input
                                        {...NEW_PROJECT_NO_AUTOFILL}
                                        autoFocus={isDesktopViewport}
                                        value={assigneeSearch}
                                        onChange={(e) => setAssigneeSearch(e.target.value)}
                                        className="h-8 w-full rounded-[8px] border border-[var(--panel-border)] bg-[var(--panel-bg)] pl-7 pr-2 text-[12px] text-[var(--text-main)] outline-none transition focus:border-[var(--brand)]"
                                        placeholder="Search staff..."
                                      />
                                    </div>
                                    <div role="listbox" className="glass-scroll max-h-[220px] min-h-0 flex-1 overflow-y-auto p-1">
                                      {/* Left unassigned (as it starts) — until someone's picked for it. */}
                                      {!assigneeSearch.trim() ? (
                                        <button
                                          type="button"
                                          role="option"
                                          aria-selected={!assigneeUid}
                                          onClick={() => {
                                            setAssigneeUid("");
                                            setAssigneeMenuOpen(false);
                                          }}
                                          className={newProjectMenuRowClass(!assigneeUid)}
                                          style={newProjectMenuRowStyle(!assigneeUid)}
                                        >
                                          <span
                                            className={cn(
                                              "inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full border border-dashed",
                                              !assigneeUid ? "border-white/70 text-white" : "border-[var(--panel-border)] text-[var(--text-muted)]",
                                            )}
                                          >
                                            <UserRound size={12} />
                                          </span>
                                          <span className={cn("min-w-0 flex-1 font-medium", !assigneeUid ? "text-white" : "text-[var(--text-muted)]")}>Unassigned</span>
                                          {!assigneeUid ? <Check size={14} className="shrink-0 text-white" /> : null}
                                        </button>
                                      ) : null}
                                      {filteredStaffOptions.map((s) => {
                                        const isPicked = s.uid === assigneeUid;
                                        return (
                                          <button
                                            key={s.uid}
                                            type="button"
                                            role="option"
                                            aria-selected={isPicked}
                                            onClick={() => {
                                              setAssigneeUid(s.uid);
                                              setAssigneeMenuOpen(false);
                                            }}
                                            className={newProjectMenuRowClass(isPicked)}
                                            style={newProjectMenuRowStyle(isPicked)}
                                          >
                                            {renderStaffOptionBadge(s, 24)}
                                            <span className="min-w-0 flex-1">
                                              <span className={cn("block truncate font-medium", isPicked ? "text-white" : "text-[var(--text-main)]")}>{s.name}</span>
                                              <span className={cn("block truncate text-[11px]", isPicked ? "text-white/80" : "text-[var(--text-main)]")}>{s.email}</span>
                                            </span>
                                            {isPicked ? <Check size={14} className="shrink-0 text-white" /> : null}
                                          </button>
                                        );
                                      })}
                                      {!filteredStaffOptions.length && <p className="px-2 py-2 text-[12px] text-[var(--text-muted)]">No staff found.</p>}
                                    </div>
                                  </div>,
                                  document.body,
                                )
                              : null}
                          </div>
                        </div>
                      )}
                      {/* Not a small job's — kept quick. */}
                      {!newProjectIsSmallJob && (
                        <div>
                          <p className={cn(newProjectLabelClass, "flex items-center justify-between")}>
                            Tags
                            <span className="text-[11px] font-normal text-[var(--text-muted)]">{tags.length}/5</span>
                          </p>
                          <div className="flex flex-wrap items-center gap-1.5">
                            {tags.map((tag) => (
                              <button
                                key={tag}
                                type="button"
                                onClick={() => removeTag(tag)}
                                className="group inline-flex h-7 items-center gap-1 rounded-full border border-[var(--panel-border)] bg-[var(--panel-muted)] pl-2.5 pr-2 text-[12px] font-medium text-[var(--text-main)] transition hover:border-[var(--danger-border)] hover:bg-[var(--danger-soft)] hover:text-[var(--danger)]"
                                title="Remove tag"
                              >
                                <Tag size={11} className="text-[var(--text-muted)] group-hover:text-[var(--danger)]" />
                                {tag}
                                <X size={12} className="opacity-50 group-hover:opacity-100" />
                              </button>
                            ))}
                            {tags.length < 5 && isTagInputOpen && (
                              <input
                                {...NEW_PROJECT_NO_AUTOFILL}
                                ref={newProjectTagInputRef}
                                value={tagInput}
                                onFocus={() => setShowTagSuggestions(true)}
                                onBlur={() => window.setTimeout(() => setShowTagSuggestions(false), 120)}
                                onChange={(e) => {
                                  setTagInput(e.target.value);
                                  setShowTagSuggestions(true);
                                }}
                                onKeyDown={(e) => {
                                  if (e.key === "Enter" || e.key === ",") {
                                    e.preventDefault();
                                    const added = addTag(tagInput);
                                    if (added) {
                                      setShowTagSuggestions(true);
                                      window.setTimeout(() => newProjectTagInputRef.current?.focus(), 0);
                                    }
                                  }
                                  if (e.key === "Escape") {
                                    setTagInput("");
                                    setShowTagSuggestions(false);
                                    setIsTagInputOpen(false);
                                  }
                                }}
                                className="h-7 w-[130px] rounded-full border border-[var(--panel-border)] bg-[var(--panel-bg)] px-3 text-[12px] text-[var(--text-main)] outline-none transition focus:border-[var(--brand)]"
                                placeholder="Tag name"
                              />
                            )}
                            {tags.length < 5 && (
                              <button
                                type="button"
                                onClick={() => {
                                  if (!isTagInputOpen) {
                                    setIsTagInputOpen(true);
                                    setShowTagSuggestions(true);
                                    window.setTimeout(() => newProjectTagInputRef.current?.focus(), 0);
                                    return;
                                  }
                                  const added = addTag(tagInput);
                                  if (added) {
                                    setShowTagSuggestions(true);
                                    window.setTimeout(() => newProjectTagInputRef.current?.focus(), 0);
                                  }
                                }}
                                className="inline-flex h-7 items-center gap-1 rounded-full border border-dashed border-[var(--panel-border)] px-2.5 text-[12px] font-medium text-[var(--text-muted)] transition hover:border-[var(--brand)] hover:text-[var(--brand)]"
                                aria-label="Add tag"
                              >
                                <Plus size={13} />
                                {isTagInputOpen ? "Add" : "Add tag"}
                              </button>
                            )}
                          </div>
                          {/* The company's tags it could have (used before), as one's typed — tap one to add it. */}
                          {tags.length < 5 && isTagInputOpen && showTagSuggestions && filteredTagSuggestions.length > 0 ? (
                            <div className="mt-2 flex flex-wrap gap-1.5">
                              {filteredTagSuggestions.slice(0, 12).map((tag) => (
                                <button
                                  key={tag}
                                  type="button"
                                  onMouseDown={(e) => e.preventDefault()}
                                  onClick={() => {
                                    const added = addTag(tag);
                                    if (added) {
                                      setShowTagSuggestions(true);
                                      window.setTimeout(() => newProjectTagInputRef.current?.focus(), 0);
                                    }
                                  }}
                                  className="inline-flex h-6 items-center gap-1 rounded-full border border-dashed border-[var(--panel-border)] px-2 text-[11.5px] font-medium text-[var(--text-muted)] transition-colors hover:border-[var(--brand)] hover:bg-[var(--brand-soft)] hover:text-[var(--brand)]"
                                >
                                  <Plus size={11} />
                                  {tag}
                                </button>
                              ))}
                            </div>
                          ) : null}
                        </div>
                      )}
                    </div>
                  </section>
                  {/* Who it's for. As their name, phone or email's typed, the existing contacts it matches float under it — one
                      picked fills them in and links the new project to that contact (Existing contact, top right). */}
                  <section className={cn(newProjectCardClass, "lg:flex-1")}>
                    <div className={newProjectCardHeaderClass}>
                      <UserRound size={14} className="shrink-0 text-[var(--text-muted)]" />
                      <span className={newProjectCardTitleClass}>Client</span>
                      {newProjectContact ? (
                        <span
                          className="ml-auto inline-flex h-7 min-w-0 items-center gap-1.5 rounded-full pl-1 pr-1 text-[12px] font-medium text-white"
                          style={{ backgroundImage: "var(--brand-gradient)" }}
                          title={`Linked to ${newProjectContact.name || newProjectContact.email}'s contact`}
                        >
                          {renderNewProjectContactBadge(newProjectContact, 20)}
                          <span className="truncate">Existing contact</span>
                          <button
                            type="button"
                            onClick={unpickNewProjectContact}
                            className="inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full transition hover:bg-white/25"
                            aria-label="Not this contact"
                            title="Not this contact"
                          >
                            <X size={12} strokeWidth={2.5} />
                          </button>
                        </span>
                      ) : null}
                    </div>
                    <div className="space-y-3.5 p-4">
                      <div>
                        <label htmlFor="new-project-client-first" className={newProjectLabelClass}>
                          Name <span className="text-[var(--danger)]">*</span>
                        </label>
                        <div ref={newProjectClientNameRowRef} className="grid grid-cols-2 gap-2">
                          <span className="relative block">
                            <UserRound size={15} className={newProjectFieldIconClass} />
                            <input
                              {...NEW_PROJECT_NO_AUTOFILL}
                              id="new-project-client-first"
                              ref={newProjectClientInputRef}
                              value={clientFirstName}
                              aria-autocomplete="list"
                              onFocus={ensureNewProjectContacts}
                              onBlur={closeContactSuggestionsSoon}
                              onKeyDown={onContactFieldKeyDown}
                              onChange={(e) => {
                                setClientFirstName(e.target.value);
                                clearNewProjectInvalid("client");
                                unlinkContactIfRenamed(e.target.value, clientLastName);
                                suggestContactsFrom("name", newProjectClientNameRowRef.current ?? e.currentTarget);
                              }}
                              aria-invalid={newProjectInvalidField === "client" || undefined}
                              className={cn(newProjectFieldClass(newProjectInvalidField === "client"), "pl-9")}
                              placeholder="First"
                            />
                          </span>
                          <input
                            {...NEW_PROJECT_NO_AUTOFILL}
                            value={clientLastName}
                            aria-autocomplete="list"
                            onFocus={ensureNewProjectContacts}
                            onBlur={closeContactSuggestionsSoon}
                            onKeyDown={onContactFieldKeyDown}
                            onChange={(e) => {
                              setClientLastName(e.target.value);
                              clearNewProjectInvalid("client");
                              unlinkContactIfRenamed(clientFirstName, e.target.value);
                              suggestContactsFrom("name", newProjectClientNameRowRef.current ?? e.currentTarget);
                            }}
                            aria-label="Client last name"
                            aria-invalid={newProjectInvalidField === "client" || undefined}
                            className={newProjectFieldClass(newProjectInvalidField === "client")}
                            placeholder="Last"
                          />
                        </div>
                        {newProjectInvalidField === "client" ? (
                          <p className="mt-1 text-[11.5px] font-medium text-[var(--danger)]">Who&apos;s it for? Add the client&apos;s name.</p>
                        ) : null}
                      </div>
                      <div className="grid gap-3.5 sm:grid-cols-2">
                        <div>
                          <label htmlFor="new-project-client-phone" className={newProjectLabelClass}>
                            Phone
                          </label>
                          <span className="relative block">
                            <Phone size={15} className={newProjectFieldIconClass} />
                            <input
                              {...NEW_PROJECT_NO_AUTOFILL}
                              id="new-project-client-phone"
                              inputMode="tel"
                              aria-autocomplete="list"
                              value={clientPhone}
                              onFocus={ensureNewProjectContacts}
                              onBlur={closeContactSuggestionsSoon}
                              onKeyDown={onContactFieldKeyDown}
                              onChange={(e) => {
                                setClientPhone(formatMobileLikeDesktop(e.target.value));
                                suggestContactsFrom("phone", e.currentTarget);
                              }}
                              className={cn(newProjectFieldClass(), "pl-9")}
                              placeholder="021 234 5678"
                            />
                          </span>
                        </div>
                        <div>
                          <label htmlFor="new-project-client-email" className={newProjectLabelClass}>
                            Email
                          </label>
                          <span className="relative block">
                            <Mail size={15} className={newProjectFieldIconClass} />
                            <input
                              {...NEW_PROJECT_NO_AUTOFILL}
                              id="new-project-client-email"
                              type="email"
                              inputMode="email"
                              aria-autocomplete="list"
                              value={clientEmail}
                              onFocus={ensureNewProjectContacts}
                              onBlur={closeContactSuggestionsSoon}
                              onKeyDown={onContactFieldKeyDown}
                              onChange={(e) => {
                                setClientEmail(e.target.value);
                                suggestContactsFrom("email", e.currentTarget);
                              }}
                              className={cn(newProjectFieldClass(), "pl-9")}
                              placeholder="client@email.com"
                            />
                          </span>
                        </div>
                      </div>
                      <div>
                        <label htmlFor="new-project-address" className={newProjectLabelClass}>
                          Address
                        </label>
                        <span className="relative block">
                          <MapPin size={15} className={newProjectFieldIconClass} />
                          <input
                            {...NEW_PROJECT_NO_AUTOFILL}
                            id="new-project-address"
                            value={projectAddress}
                            onChange={(e) => setProjectAddress(e.target.value)}
                            className={cn(newProjectFieldClass(), "pl-9")}
                            placeholder="Street, suburb, city"
                          />
                        </span>
                        {projectAddress.trim().length > 5 && (
                          <div className="mt-2 overflow-hidden rounded-[12px] border border-[var(--panel-border)]">
                            <iframe
                              title="Address preview"
                              className="h-[150px] w-full border-0"
                              src={`https://maps.google.com/maps?q=${encodeURIComponent(projectAddress.trim())}&t=&z=13&ie=UTF8&iwloc=&output=embed`}
                            />
                          </div>
                        )}
                      </div>
                    </div>
                  </section>
                </div>
                <div className="flex flex-col gap-4">
                  {/* Its notes — the editor's toolbar in its header while they're written. */}
                  <section className={cn(newProjectCardClass, "flex min-h-[220px] flex-col lg:flex-1")}>
                    <div className={newProjectCardHeaderClass}>
                      <FileText size={14} className="shrink-0 text-[var(--text-muted)]" />
                      <span className={newProjectCardTitleClass}>Notes</span>
                      {/* Made from a lead: its notes added to these, a bullet each — greyed out when it has none (not while
                          they're being written — the editor's toolbar has the header then). */}
                      {sourceLeadId && !isNewProjectNotesEditing ? (
                        <button
                          type="button"
                          disabled={leadNotesImported || creatingProject || prefilledLeadNotes.length === 0}
                          onClick={() => {
                            const list = `<ul>${prefilledLeadNotes
                              .map((text) => `<li>${escapeHtml(text).replace(/\n/g, "<br />")}</li>`)
                              .join("")}</ul>`;
                            setProjectNotes((prev) => (notesHtmlIsEmpty(prev) ? list : `${notesToDisplayHtml(prev)}${list}`));
                            setLeadNotesImported(true);
                          }}
                          // The brand blue's glass shine (lib/glass-shine.ts).
                          className="glass-shine ml-auto inline-flex h-7 shrink-0 items-center gap-1 rounded-full px-2.5 text-[11.5px] font-medium text-white transition hover:brightness-105 disabled:cursor-default disabled:opacity-60 disabled:hover:brightness-100"
                          style={glassShineStyle("var(--brand)")}
                          title={
                            leadNotesImported
                              ? "The lead's notes are in"
                              : prefilledLeadNotes.length
                                ? `Add the lead's ${prefilledLeadNotes.length} ${prefilledLeadNotes.length === 1 ? "note" : "notes"}, a bullet each`
                                : "The lead has no notes"
                          }
                        >
                          {leadNotesImported ? <Check size={12} strokeWidth={2.5} /> : <Download size={12} strokeWidth={2.5} />}
                          {leadNotesImported ? "Imported" : prefilledLeadNotes.length ? "Import from Notes" : "No notes to import"}
                        </button>
                      ) : null}
                      <div
                        className={cn(
                          "new-project-notes-toolbar flex min-h-[30px] min-w-0 items-center justify-end",
                          sourceLeadId && !isNewProjectNotesEditing ? "" : "ml-auto",
                        )}
                        ref={setNewProjectNotesToolbarHost}
                        onMouseDownCapture={(e) => e.preventDefault()}
                      />
                    </div>
                    <div className="flex flex-1 flex-col px-3 py-2.5">
                      {isNewProjectNotesEditing ? (
                        <QuoteDocumentEditor
                          key="new-project-notes-editor"
                          mode="embedded"
                          toolbarPlacement="inline"
                          toolbarHost={newProjectNotesToolbarHost}
                          embeddedChrome="flat"
                          embeddedMinHeight={150}
                          embeddedEditableMinHeight={140}
                          value={projectNotes}
                          readOnly={creatingProject}
                          autoFocus
                          onFocus={() => setIsNewProjectNotesEditing(true)}
                          onBlur={() => setIsNewProjectNotesEditing(false)}
                          onChange={(nextValue) => setProjectNotes(nextValue)}
                        />
                      ) : (
                        <button
                          type="button"
                          onClick={() => setIsNewProjectNotesEditing(true)}
                          className="flex min-h-[150px] w-full flex-1 flex-col items-stretch justify-start bg-transparent px-1 text-left text-[13px] text-[var(--text-main)] outline-none"
                        >
                          {notesHtmlIsEmpty(projectNotes) ? (
                            <span className="text-[var(--text-muted)]">
                              {newProjectIsSmallJob
                                ? "What needs doing — the fix, sizes, access..."
                                : "Anything the team should know — measurements, access, what they're after..."}
                            </span>
                          ) : (
                            <div className="notes-rich" dangerouslySetInnerHTML={{ __html: notesToDisplayHtml(projectNotes) }} />
                          )}
                        </button>
                      )}
                    </div>
                  </section>
                  {/* Its photos: dropped onto it, or browsed for — up to 10 (a lead's own first). */}
                  <section
                    className={newProjectCardClass}
                    style={
                      isNewProjectPhotoDragOver
                        ? { borderColor: "var(--brand)", boxShadow: "0 0 0 3px color-mix(in srgb, var(--brand) 18%, transparent)" }
                        : undefined
                    }
                    onDragOver={(e) => {
                      if (!Array.from(e.dataTransfer.types).includes("Files")) return;
                      e.preventDefault();
                      e.dataTransfer.dropEffect = newProjectPhotoCount < 10 ? "copy" : "none";
                      if (!isNewProjectPhotoDragOver) setIsNewProjectPhotoDragOver(true);
                    }}
                    onDragLeave={(e) => {
                      if (e.currentTarget.contains(e.relatedTarget as Node | null)) return;
                      setIsNewProjectPhotoDragOver(false);
                    }}
                    onDrop={(e) => {
                      if (!Array.from(e.dataTransfer.types).includes("Files")) return;
                      e.preventDefault();
                      setIsNewProjectPhotoDragOver(false);
                      void addPhotoFiles(e.dataTransfer.files);
                    }}
                  >
                    <div className={newProjectCardHeaderClass}>
                      <Images size={14} className="shrink-0 text-[var(--text-muted)]" />
                      <span className={newProjectCardTitleClass}>Photos</span>
                      <span className="ml-auto text-[11px] text-[var(--text-muted)]">{newProjectPhotoCount}/10</span>
                    </div>
                    <div className="p-3">
                      {newProjectPhotoCount === 0 ? (
                        <label className="flex h-[132px] cursor-pointer flex-col items-center justify-center gap-1.5 rounded-[12px] border border-dashed border-[var(--panel-border)] text-center transition hover:border-[var(--brand)] hover:bg-[var(--panel-muted)]">
                          <span
                            className="inline-flex h-9 w-9 items-center justify-center rounded-full"
                            style={{ backgroundColor: "color-mix(in srgb, var(--brand) 12%, transparent)", color: "var(--brand)" }}
                          >
                            <ImagePlus size={17} />
                          </span>
                          <span className="text-[13px] font-medium text-[var(--text-main)]">Drop photos here</span>
                          <span className="text-[12px] text-[var(--text-muted)]">
                            or <span className="font-medium text-[var(--brand)]">browse</span> — up to 10
                          </span>
                          {newProjectPhotoInput}
                        </label>
                      ) : (
                        <div className="grid grid-cols-3 gap-2 sm:grid-cols-4">
                          {prefilledProjectImages.map((image, idx) => (
                            <div key={image.id} className="min-w-0">
                              <div className="relative aspect-square overflow-hidden rounded-[10px] border border-[var(--panel-border)]">
                                <button
                                  type="button"
                                  onClick={() => window.open(image.url, "_blank", "noopener,noreferrer")}
                                  className="block h-full w-full cursor-zoom-in"
                                  title="Open the photo"
                                >
                                  <img src={image.url} alt={`Lead photo ${idx + 1}`} className="block h-full w-full object-cover" />
                                </button>
                                <button
                                  type="button"
                                  onClick={() => removePrefilledProjectImage(image.id)}
                                  className={newProjectPhotoRemoveClass}
                                  aria-label="Remove photo"
                                  title="Remove photo"
                                >
                                  <X size={13} strokeWidth={2.5} />
                                </button>
                              </div>
                              {newProjectPhotoCaption(`prefilled:${image.id}`, String(image.name || ""))}
                            </div>
                          ))}
                          {photos.map((photo, idx) => (
                            <div key={photo.id} className="min-w-0">
                              <div className="relative aspect-square overflow-hidden rounded-[10px] border border-[var(--panel-border)]">
                                <button
                                  type="button"
                                  ref={(el) => {
                                    photoThumbRefs.current[photo.id] = el;
                                  }}
                                  onClick={() => openPreviewAnimated(photo)}
                                  className="block h-full w-full cursor-zoom-in"
                                  title="Click to enlarge"
                                >
                                  <img src={photo.previewUrl} alt={`Photo ${idx + 1}`} className="block h-full w-full object-cover" />
                                </button>
                                <button
                                  type="button"
                                  onClick={() => removePhoto(photo.id)}
                                  onMouseDown={(e) => e.stopPropagation()}
                                  className={newProjectPhotoRemoveClass}
                                  aria-label="Remove photo"
                                  title="Remove photo"
                                >
                                  <X size={13} strokeWidth={2.5} />
                                </button>
                              </div>
                              {newProjectPhotoCaption(`local:${photo.id}`, String(photo.name || ""))}
                            </div>
                          ))}
                          {newProjectPhotoCount < 10 ? (
                            <label
                              className="flex aspect-square cursor-pointer flex-col items-center justify-center gap-1 rounded-[10px] border border-dashed border-[var(--panel-border)] text-[11px] font-medium text-[var(--text-muted)] transition hover:border-[var(--brand)] hover:text-[var(--brand)]"
                              title="Add photos"
                            >
                              <ImagePlus size={18} />
                              Add
                              {newProjectPhotoInput}
                            </label>
                          ) : null}
                        </div>
                      )}
                    </div>
                  </section>
                </div>
              </div>
            </div>
            {previewPhoto && (
              <div
                className="absolute inset-0 z-30 flex items-center justify-center p-4"
                onClick={closePreviewAnimated}
                style={{
                  backgroundColor: "color-mix(in srgb, var(--panel-bg) 88%, transparent)",
                  opacity: previewBackdropOpacity,
                  transition: "opacity 260ms ease",
                }}
              >
                <div
                  className="relative overflow-hidden rounded-[12px] bg-[rgba(10,14,24,0.78)]"
                  ref={previewPanelRef}
                  style={{
                    width: "calc(100% - 32px)",
                    height: "calc(100% - 102px)",
                  }}
                />
              </div>
            )}
            {previewPhoto && previewAnim && (
              <div
                className="fixed inset-0"
                style={{ zIndex: 2147483646 }}
                onClick={closePreviewAnimated}
              >
                <img
                  src={previewPhoto.previewUrl}
                  alt="Animated preview"
                  onClick={(e) => e.stopPropagation()}
                  style={{
                    position: "fixed",
                    left: previewAnim.to.left,
                    top: previewAnim.to.top,
                    width: previewAnim.to.width,
                    height: previewAnim.to.height,
                    objectFit: "contain",
                    transition: "left 260ms ease, top 260ms ease, width 260ms ease, height 260ms ease",
                    opacity: 1,
                    filter: "none",
                    willChange: "left, top, width, height",
                    pointerEvents: "auto",
                    borderRadius: 12,
                  }}
                />
              </div>
            )}
            {previewPhoto && previewAnim?.phase === "open" && (
              <button
                type="button"
                onClick={closePreviewAnimated}
                style={{
                  position: "fixed",
                  left: previewAnim.to.left + previewAnim.to.width / 2 - 22,
                  top: previewAnim.to.top + previewAnim.to.height + 10,
                  width: 44,
                  height: 44,
                  zIndex: 2147483647,
                  display: "inline-flex",
                  alignItems: "center",
                  justifyContent: "center",
                  borderRadius: 9999,
                  border: "2px solid #FCA5A5",
                  background: "#DC2626",
                  boxShadow: "0 1px 4px rgba(0,0,0,0.22)",
                  cursor: "pointer",
                  opacity: previewClosePopped ? 1 : 0,
                  transform: previewClosePopped ? "translateY(0) scale(1)" : "translateY(-14px) scale(0.88)",
                  transition: "opacity 180ms ease, transform 220ms cubic-bezier(0.2, 0.7, 0.2, 1)",
                  pointerEvents: previewClosePopped ? "auto" : "none",
                }}
                aria-label="Close image preview"
              >
                <img
                  src="/cross-small.png"
                  alt="Close"
                  style={{ width: 22, height: 22, objectFit: "contain", filter: "brightness(0) invert(1)" }}
                />
              </button>
            )}
            {contactSuggestPos && newProjectContactSuggestions().length
              ? createPortal(
                  <div
                    ref={contactSuggestRef}
                    role="listbox"
                    aria-label="Existing contacts"
                    className="glass-scroll fixed overflow-y-auto rounded-[12px] border p-1 shadow-[var(--shadow-md)]"
                    style={{
                      ...FLOATING_MENU_STYLE,
                      left: contactSuggestPos.left,
                      width: contactSuggestPos.width,
                      top: contactSuggestPos.top,
                      bottom: contactSuggestPos.bottom,
                      maxHeight: contactSuggestPos.maxHeight,
                    }}
                  >
                    <p className="px-2 pb-1 pt-1.5 text-[10.5px] font-bold uppercase tracking-[0.8px] text-[var(--text-muted)]">Existing contacts</p>
                    {newProjectContactSuggestions().map((contact, idx) => {
                      const isReady = idx === contactSuggestIndex;
                      return (
                        <button
                          key={contact.id}
                          type="button"
                          role="option"
                          aria-selected={isReady}
                          onMouseDown={(e) => e.preventDefault()}
                          onMouseEnter={() => setContactSuggestIndex(idx)}
                          onClick={() => pickNewProjectContact(contact)}
                          className="flex w-full items-center gap-2.5 rounded-[8px] px-2 py-1.5 text-left transition-colors"
                          style={isReady ? { backgroundColor: "var(--brand-soft)" } : undefined}
                        >
                          {renderNewProjectContactBadge(contact, 28)}
                          <span className="min-w-0 flex-1">
                            <span className={cn("block truncate text-[13px] font-medium", isReady ? "text-[var(--brand)]" : "text-[var(--text-main)]")}>
                              {contact.name || contact.email}
                            </span>
                            <span className="block truncate text-[11.5px] text-[var(--text-main)]">
                              {[contact.phone, contact.email].filter(Boolean).join(" · ") || "No phone or email"}
                            </span>
                          </span>
                          {contact.projectCount > 0 ? (
                            <span className="shrink-0 text-[11px] text-[var(--text-muted)]">
                              {contact.projectCount} {contact.projectCount === 1 ? "project" : "projects"}
                            </span>
                          ) : null}
                        </button>
                      );
                    })}
                  </div>,
                  document.body,
                )
              : null}
            <div className="flex items-center gap-2 border-t border-[var(--glass-border)] px-4 py-3 max-sm:pb-[calc(12px+env(safe-area-inset-bottom))] sm:px-6 sm:py-4">
              {/* Where it'll start (its first status, and where) — or what's stopped it being created. */}
              <div className="min-w-0 flex-1">
                {projectFormError && !newProjectInvalidField ? (
                  <p className="text-[12px] font-medium text-[var(--danger)]">{projectFormError}</p>
                ) : (
                  <p className="flex min-w-0 items-center gap-1.5 text-[12px] text-[var(--text-muted)] max-sm:hidden">
                    <span className="shrink-0">Starts in</span>
                    <span className="inline-flex min-w-0 items-center gap-1.5 rounded-full border border-[var(--panel-border)] bg-[var(--panel-bg)] px-2 py-0.5 font-medium text-[var(--text-main)]">
                      <span
                        className="h-2 w-2 shrink-0 rounded-full"
                        style={{ backgroundColor: newProjectIsSmallJob ? defaultSmallJobStatusColor : defaultProjectStatusColor }}
                      />
                      <span className="truncate">{newProjectIsSmallJob ? defaultSmallJobStatus : defaultProjectStatus}</span>
                    </span>
                    <span className="truncate">{newProjectIsSmallJob ? "in Small Jobs" : "on the Dashboard"}</span>
                  </p>
                )}
              </div>
              <button
                type="button"
                onClick={closeNewProject}
                className="inline-flex h-10 shrink-0 items-center rounded-full border border-[var(--panel-border)] bg-[var(--panel-bg)] px-4 text-[13px] font-medium text-[var(--text-main)] transition hover:bg-[var(--panel-muted)]"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={creatingProject}
                onClick={() => void onCreateProject()}
                title="Create it (Ctrl/⌘ + Enter)"
                className="glass-shine inline-flex h-10 shrink-0 items-center gap-1.5 rounded-full px-5 text-[13px] font-medium text-white transition hover:brightness-105 disabled:opacity-60"
                style={glassShineStyle(newProjectAccent)}
              >
                {creatingProject ? <RefreshCw size={14} className="animate-spin" /> : <Plus size={15} strokeWidth={2.5} />}
                {creatingProject ? "Creating..." : newProjectIsSmallJob ? "Create Small Job" : "Create Project"}
              </button>
            </div>
          </div>
        </div>
      )}
      <DownloadsModal
        open={showDownloads}
        origin={downloadsOrigin}
        originElRef={downloadsOriginElRef}
        companyId={downloadsCompanyId}
        onClose={() => setShowDownloads(false)}
      />
      {/* Search across everything this person can see — Ctrl/⌘+K, or the top bar's search button (components/global-search.tsx). */}
      <GlobalSearch pages={visibleTopNav} canOpenSettings={canAccessCompanySettings} />
      {/* An owner or admin viewing the app as a role: its banner, with Exit. */}
      <ViewAsRoleBanner />
      {shouldRenderLogoutConfirmModal && createPortal(
        <div className="fixed inset-0 z-[9100] flex items-center justify-center px-4">
          <button
            type="button"
            aria-label="Close dialog backdrop"
            onClick={() => setShowLogoutConfirm(false)}
            className="glass-modal-backdrop absolute inset-0"
          />
          <div ref={logoutConfirmPanelRef} className="glass-modal-panel relative w-full max-w-[380px] overflow-hidden">
            <GlassModalHeader title="Log out?" onClose={() => setShowLogoutConfirm(false)} />
            <div className="px-5 py-4">
              <p className="text-[13px]" style={{ color: "var(--text-main)" }}>
                You&apos;ll need to sign back in to access your account.
              </p>
              <div className="mt-4 flex flex-wrap justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setShowLogoutConfirm(false)}
                  className="inline-flex h-10 items-center justify-center rounded-[10px] border px-4 text-[12px] font-bold hover:brightness-95"
                  style={{ borderColor: "var(--glass-border)", backgroundColor: "var(--panel-muted)", color: "var(--text-main)" }}
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setShowLogoutConfirm(false);
                    void logout();
                  }}
                  className="inline-flex h-10 items-center justify-center rounded-[10px] border px-4 text-[12px] font-bold text-white hover:brightness-95"
                  style={{ backgroundImage: "var(--danger-gradient)", borderColor: "var(--danger-strong)" }}
                >
                  Log Out
                </button>
              </div>
            </div>
          </div>
        </div>
      , document.body)}
    </div>
  );
}
