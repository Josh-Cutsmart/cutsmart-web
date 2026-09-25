"use client";

import { useEffect, useLayoutEffect, useMemo, useRef, useState, type TouchEvent as ReactTouchEvent } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { doc, serverTimestamp, setDoc } from "firebase/firestore";
import { getDownloadURL, ref as storageRef, uploadBytes } from "firebase/storage";
import {
  CalendarDays,
  ChevronRight,
  ImagePlus,
  Inbox,
  LayoutDashboard,
  PartyPopper,
  Plus,
  PlusCircle,
  RefreshCw,
  Save,
  Search,
  Settings,
  Tag,
  Trash2,
  Users,
  X,
} from "lucide-react";
import { useAuth } from "@/lib/auth-context";
import { useAppTabs } from "@/lib/app-tabs-context";
import { MOBILE_TOP_BAR_UPDATED_EVENT, readMobileTopBarEnabled } from "@/lib/ui-preferences";
// Side-effect only — registers the `beforeinstallprompt` listener as early as possible (this
// component mounts on every staff page), since the browser only ever delivers that event once and
// User Settings' own "Download App" button needs it captured long before someone visits that page.
import "@/lib/pwa-install";
import {
  addUserNotification,
  cleanupCompletedReportsForNewVersion,
  fetchAppChangelogHistory,
  fetchCompanyDoc,
  fetchCompanyMembers,
  fetchUserUpdateNoticeSeenVersions,
  markUserUpdateNoticeSeen,
  resyncCompanyProjectTagUsage,
    syncCompanyClientProfileFromProject,
    syncAppChangelogHistory,
    upsertCompanyClientProfileOnProjectCreate,
  } from "@/lib/firestore-data";
import { db, hasFirebaseConfig, storage } from "@/lib/firebase";
import { cn } from "@/lib/utils";
import { QuoteDocumentEditor } from "@/components/quote-document-editor";
import { fetchCompanyAccess, fetchPrimaryMembership } from "@/lib/membership";
import { getFirebaseStorageQuotaExceededMessage, isFirebaseStorageQuotaExceeded } from "@/lib/firebase-storage-errors";
import { applyThemeMode, readThemeMode, THEME_MODE_UPDATED_EVENT, type ThemeMode } from "@/lib/theme-mode";
import type { ProjectImageItem } from "@/lib/types";
import { normalizeChangelogHistory, parseUpdateNotesText, updateNotesToDisplayHtml } from "@/lib/update-notes-utils";
import {
  LEAD_PROJECT_CREATED_EVENT,
  OPEN_NEW_PROJECT_EVENT,
  type NewProjectPrefillPayload,
} from "@/lib/new-project-bridge";
import { captureGlassModalOrigin, useGlassModalPopOrigin, type GlassModalOrigin } from "@/lib/use-glass-modal-pop-origin";
import { useSwipeToClose } from "@/lib/use-swipe-to-close";
import { USER_COLOR_UPDATED_EVENT, type UserColorUpdatedDetail } from "@/lib/user-color-sync";
import { SidebarUserSettingsPanel } from "@/components/sidebar-user-settings-panel";
import { VerifyAccountModal } from "@/components/verify-account-modal";
const ACTIVE_COMPANY_STORAGE_KEY = "cutsmart_active_company_id";
const COMPANY_BRANDING_CACHE_KEY_PREFIX = "cutsmart_company_branding_";
const COMPANY_ACCESS_CACHE_KEY_PREFIX = "cutsmart_company_access_";
const UPDATE_NOTICE_SEEN_STORAGE_KEY_PREFIX = "cutsmart_update_notice_seen_";
const ZAPIER_LEADS_VISIBILITY_UPDATED_EVENT = "cutsmart:zapier-leads-visibility-updated";
const COMPANY_ACCESS_CACHE_TTL_MS = 5 * 60 * 1000;

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

const topNav = [
  { href: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
  { href: "/clients", label: "Clients", icon: Users },
  { href: "/leads", label: "Leads", icon: Inbox },
  { href: "/calendar", label: "Calendar", icon: CalendarDays },
  { href: "/recently-deleted", label: "Recently Deleted", icon: Trash2 },
  { href: "/changelog", label: "Changelog", icon: Search },
  { href: "/wrapped", label: "Company Wrapped", icon: PartyPopper },
  { href: "/company-settings", label: "Company Settings", icon: Settings },
];

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
  const { chromeHidden, fillMainViewport, reduceMainTopPadding, mobileNavOpen, setMobileNavOpen, notifOpen, setNotifOpen, saveAndBackHandler } = useAppTabs();
  const effectiveHideSidebar = hideSidebar || chromeHidden;
  const [showNewProject, setShowNewProject] = useState(false);
  const [newProjectOrigin, setNewProjectOrigin] = useState<GlassModalOrigin>(null);
  const newProjectPanelRef = useRef<HTMLDivElement | null>(null);
  const shouldRenderNewProjectModal = useGlassModalPopOrigin(showNewProject, newProjectOrigin, newProjectPanelRef);
  const [showLogoutConfirm, setShowLogoutConfirm] = useState(false);
  const [logoutConfirmOrigin, setLogoutConfirmOrigin] = useState<GlassModalOrigin>(null);
  const logoutConfirmPanelRef = useRef<HTMLDivElement | null>(null);
  const shouldRenderLogoutConfirmModal = useGlassModalPopOrigin(showLogoutConfirm, logoutConfirmOrigin, logoutConfirmPanelRef);
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
  const [editingProjectPhotoNameKey, setEditingProjectPhotoNameKey] = useState("");
  const [projectPhotoNameDraft, setProjectPhotoNameDraft] = useState("");
  const [sourceLeadId, setSourceLeadId] = useState("");
  const [sourceLeadCompanyId, setSourceLeadCompanyId] = useState("");
  const [hoveredPhotoId, setHoveredPhotoId] = useState("");
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
  const [navHighlightRect, setNavHighlightRect] = useState<{ top: number; height: number } | null>(null);
  const navListRef = useRef<HTMLDivElement | null>(null);
  const navLinkRefs = useRef<Record<string, HTMLAnchorElement | null>>({});
  const mobileNavPanelRef = useRef<HTMLDivElement | null>(null);
  // The page's own content wrapper (everything below the fixed global top bar) — pushed
  // sideways in sync with the drawer's own slide so opening it reads as shoving the page over
  // rather than just laying an overlay on top of static content underneath.
  const mainPushRef = useRef<HTMLDivElement | null>(null);
  const { shouldRender: shouldRenderMobileNav, touchHandlers: mobileNavTouchHandlers } = useSwipeToClose(
    mobileNavOpen,
    () => setMobileNavOpen(false),
    mobileNavPanelRef,
    { edge: "left", pushRef: mainPushRef },
  );
  const [isUserSettingsPanelOpen, setIsUserSettingsPanelOpen] = useState(false);
  const desktopAsideRef = useRef<HTMLElement | null>(null);
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
  const [companyTagSuggestions, setCompanyTagSuggestions] = useState<string[]>([]);
  const [defaultProjectStatus, setDefaultProjectStatus] = useState("New");
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
  const mainSwipeStartRef = useRef<{ x: number; y: number; axis: "" | "horizontal" | "vertical"; horizontalExempt: boolean } | null>(null);
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
    const push = mainPushRef.current;
    const width = panel.getBoundingClientRect().width || window.innerWidth;
    if (kind === "nav") {
      // edge "left": closed = translateX(-100%), fully open = translateX(0).
      const clampedDx = Math.max(0, Math.min(width, dx));
      panel.style.transition = "none";
      panel.style.transform = `translateX(calc(-100% + ${clampedDx}px))`;
      if (push) {
        // Pixels, not a percentage of push's OWN width — translateX(N%) is relative to the
        // element it's applied to, so a percentage here moved the (often wider/narrower) page at
        // a different rate than the panel's own pixel-based transform above, reading as the two
        // sliding at different speeds. clampedDx IS the panel's own current pixel offset from
        // closed, so mirroring it directly keeps them moving 1:1.
        push.style.transition = "none";
        push.style.transform = clampedDx === 0 ? "" : `translateX(${clampedDx}px)`;
      }
    } else {
      // edge "right": closed = translateX(100%), fully open = translateX(0).
      const clampedDx = Math.max(-width, Math.min(0, dx));
      panel.style.transition = "none";
      panel.style.transform = `translateX(calc(100% + ${clampedDx}px))`;
      if (push) {
        push.style.transition = "none";
        push.style.transform = clampedDx === 0 ? "" : `translateX(${clampedDx}px)`;
      }
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
      topBarEl.style.height = "";
    }
    const topBarContentEl = pullTopBarContentElRef.current;
    if (topBarContentEl) {
      topBarContentEl.style.transition = animate ? `opacity ${PULL_BANNER_RESET_DURATION_MS}ms ease` : "none";
      topBarContentEl.style.opacity = "1";
      topBarContentEl.style.pointerEvents = "";
    }
    applyPullZoneStyles("dashboard", false);
  };
  const onMainTouchStart = (event: ReactTouchEvent<HTMLElement>) => {
    // data-app-gesture-exempt is a page surface that owns BOTH axes of its own touch handling
    // entirely (e.g. Nesting/CNC's mobile Visibility slide-up panel, or the sheet preview's
    // pinch-zoom) — without it, tapping into that panel's search box, or pinching the preview,
    // could get swept into this page-level pull-to-reveal/nav-swipe system.
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
    if (isDesktopViewport || mobileNavOpen || notifOpen || startedOnGestureExempt) {
      mainSwipeStartRef.current = null;
      pullDashboardRef.current = null;
      return;
    }
    const startedOnHorizontalScroller = Boolean(
      (event.target as HTMLElement | null)?.closest('[data-horizontal-swipe-scroll="true"]'),
    );
    const touch = event.touches[0];
    if (!touch) return;
    mainSwipeStartRef.current = { x: touch.clientX, y: touch.clientY, axis: "", horizontalExempt: startedOnHorizontalScroller };
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
    const alreadyAtTop = (mainScrollRef.current?.scrollTop ?? 0) <= 0 && !hasScrolledAncestor;
    if (alreadyAtTop && mobileTopBarEnabled) {
      pullDashboardRef.current = { startY: touch.clientY, active: false, armed: false, selected: "dashboard" };
      pullTopBarElRef.current =
        typeof document !== "undefined" ? document.querySelector<HTMLElement>('[data-app-top-bar="true"]') : null;
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
    const touch = event.touches[0];
    if (!touch) return;
    if (!start.axis) {
      const dx = touch.clientX - start.x;
      const dy = touch.clientY - start.y;
      if (Math.abs(dx) < 6 && Math.abs(dy) < 6) return;
      start.axis = Math.abs(dx) > Math.abs(dy) ? "horizontal" : "vertical";
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
      if (!mainOpenDragRef.current.kind) {
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
      const push = mainPushRef.current;
      if (push) {
        // Pixels (matching `width`, the panel's own measured width — same value used just above
        // for `progress`), not a percentage of push's own width — this settle-to-open step was
        // still using the old percentage-based transform even after the live-drag path above was
        // fixed to track in pixels, so releasing past the open threshold could snap to a slightly
        // different final offset than the drag had been tracking toward, reading as the page
        // drifting away from the panel over the course of the gesture.
        push.style.transition = transition;
        push.style.transform = kind === "nav" ? `translateX(${width}px)` : `translateX(${-width}px)`;
      }
    }
  };
  const normalizedEffectivePermissions = useMemo(
    () => effectiveCompanyPermissions.map((item) => String(item || "").trim().toLowerCase()),
    [effectiveCompanyPermissions],
  );

  const roleForUi = String(effectiveCompanyRole || user?.role || "").trim().toLowerCase();

  const canCreateForOthers = useMemo(() => {
    const role = roleForUi;
    if (role === "owner" || role === "admin") return true;
    return hasPermissionKey(normalizedEffectivePermissions, "projects.create.others");
  }, [normalizedEffectivePermissions, roleForUi]);

  const canCreateProject = useMemo(() => {
    if (user) return true;
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

  const visibleTopNav = useMemo(
    () =>
      topNav.filter((item) => {
        if (item.href === "/dashboard") return canAccessDashboard;
        if (item.href === "/clients") return canAccessClients;
        if (item.href === "/leads") return canAccessLeads;
        if (item.href === "/company-settings") return canAccessCompanySettings;
        return true;
      }),
    [canAccessClients, canAccessCompanySettings, canAccessDashboard, canAccessLeads],
  );
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
      const detail = (event as CustomEvent<NewProjectPrefillPayload | undefined>).detail ?? {};
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
      setSourceLeadCompanyId(String(detail.sourceLeadCompanyId || "").trim());
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
      setTags([]);
      setIsTagInputOpen(false);
      setShowTagSuggestions(false);
      setPhotos([]);
      setEditingProjectPhotoNameKey("");
      setProjectPhotoNameDraft("");
      setHoveredPhotoId("");
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
  }, []);

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
        const res = await fetch("/update-notes.txt", { cache: "no-store" });
        if (!res.ok) throw new Error(`Failed to load update notes (${res.status})`);
        const raw = await res.text();
        if (cancelled) return;
        const parsed = parseUpdateNotesText(raw);
        const version = String(parsed.version || "").trim();
        const whatsNew = String(parsed.whatsNew || "").trim();
        setUpdateNoticeVersion(version);
        const storedCompanyId =
          typeof window !== "undefined"
            ? String(window.localStorage.getItem(ACTIVE_COMPANY_STORAGE_KEY) || "").trim()
            : "";
        const directCompanyId = String(user?.companyId || "").trim();
        const fallbackMembership = !directCompanyId && uid ? await fetchPrimaryMembership(uid) : null;
        const companyId = storedCompanyId || directCompanyId || String(fallbackMembership?.companyId || "").trim();
        if (version) {
          const existing = await fetchAppChangelogHistory();
          const matched = existing.find(
            (row) => String(row.version || "").trim().toLowerCase() === version.toLowerCase(),
          );
          const canonicalWhatsNew = String(matched?.whatsNew || whatsNew || "").trim();
          setUpdateNoticeText(canonicalWhatsNew);
          await syncAppChangelogHistory([
            {
              version,
              whatsNew: canonicalWhatsNew,
              capturedAtIso: matched?.capturedAtIso || new Date().toISOString(),
            },
          ]);
          // First-ever sighting of this version anywhere (no prior changelog entry) — fan out a
          // notification to the current user's own company roster. This is a per-company
          // approximation of a global broadcast (there's no backend job in this app to do a true
          // single cross-company broadcast): whichever user in a company loads the update first
          // triggers it for their teammates. A rare race between simultaneous first-loaders (same
          // or different companies) can produce an occasional duplicate notification — acceptable
          // over the alternative of nobody being notified.
          if (!matched && companyId) {
            try {
              const members = await fetchCompanyMembers(companyId);
              await Promise.all(
                members
                  .map((member) => String(member.uid || "").trim())
                  .filter(Boolean)
                  .map((memberUid) =>
                    addUserNotification(memberUid, {
                      title: `New version ${version}`,
                      message: canonicalWhatsNew || "CutSmart has been updated.",
                      type: "app_version",
                      companyId,
                    }),
                  ),
              );
            } catch {
              // best-effort — never block the update-notice flow itself
            }
          }
        } else {
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
        }
        setShowUpdateNotice(!seen);
      } catch {
        if (cancelled) return;
        setUpdateNoticeVersion("");
        setUpdateNoticeText("");
        setShowUpdateNotice(false);
      }
    };
    void loadUpdateNotes();
    return () => {
      cancelled = true;
    };
  }, [user?.uid, user?.companyId]);

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
        isZapierLeadsEnabled,
      });
    };
    void loadCompanyAccess();
    return () => {
      cancelled = true;
    };
  }, [isZapierLeadsEnabled, user?.companyId, user?.permissions, user?.role, user?.uid]);

  useEffect(() => {
    const openNewProject = (e: Event) => {
      if (!canCreateProject) {
        return;
      }
      const origin = (e as CustomEvent<{ origin?: GlassModalOrigin }>).detail?.origin ?? null;
      setAssigneeUid("");
      setNewProjectOrigin(origin);
      setShowNewProject(true);
    };
    window.addEventListener("cutsmart:new-project", openNewProject as EventListener);
    return () => {
      window.removeEventListener("cutsmart:new-project", openNewProject as EventListener);
    };
  }, [canCreateProject]);

  useEffect(() => {
      if (!showNewProject) {
        setAssigneeMenuOpen(false);
        setAssigneeSearch("");
        setCompanyTagSuggestions([]);
        setDefaultProjectStatus("New");
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

  useEffect(() => {
    if (!assigneeMenuOpen || typeof window === "undefined") return;
    const scrollHost = newProjectScrollRef.current;
    const field = assigneeFieldRef.current;
    if (!scrollHost || !field) return;
    const raf = window.requestAnimationFrame(() => {
      const hostRect = scrollHost.getBoundingClientRect();
      const fieldRect = field.getBoundingClientRect();
      const overflowBottom = fieldRect.bottom - hostRect.bottom + 220;
      if (overflowBottom > 0) {
        scrollHost.scrollTo({
          top: scrollHost.scrollTop + overflowBottom + 12,
          behavior: "smooth",
        });
        return;
      }
      if (fieldRect.top < hostRect.top) {
        scrollHost.scrollTo({
          top: Math.max(0, scrollHost.scrollTop - (hostRect.top - fieldRect.top) - 12),
          behavior: "smooth",
        });
      }
    });
    return () => window.cancelAnimationFrame(raf);
  }, [assigneeMenuOpen]);

  useEffect(() => {
    setMobileNavOpen(false);
  }, [pathname]);

  // Top tab bar entries are project-only. Project routes self-register their
  // live tab data directly via useAppTabs() (see app/(app)/projects/[projectId]/page.tsx)
  // since it depends on page-local state a shared layout can't see; every other
  // route never registers a tab, so this shell no longer touches the tab context.

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
      setNavHighlightRect({ top: elRect.top - containerRect.top + container.scrollTop, height: elRect.height });
    };
    measure();
    if (typeof window === "undefined") return;
    window.addEventListener("resize", measure);
    return () => window.removeEventListener("resize", measure);
  }, [pathname, visibleTopNav]);

  useEffect(() => {
    if (typeof document === "undefined") return;
    if (!showUpdateNotice && !showNewProject) return;
    const prevHtmlOverflow = document.documentElement.style.overflow;
    const prevBodyOverflow = document.body.style.overflow;
    document.documentElement.style.overflow = "hidden";
    document.body.style.overflow = "hidden";
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
    setPreviewPhotoId("");
    setPreviewAnim(null);
    setPreviewBackdropOpacity(0);
    setPreviewClosePopped(false);
    setAssigneeSearch("");
    setAssigneeMenuOpen(false);
      setProjectFormError("");
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

  const removeTag = (tag: string) => {
    setTags((prev) => prev.filter((t) => t !== tag));
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
    setPrefilledProjectImages((prev) => prev.filter((image) => image.id !== id));
  };

  const removePhoto = (id: string) => {
    setPhotos((prev) => {
      const found = prev.find((p) => p.id === id);
      if (found) {
        try {
          URL.revokeObjectURL(found.previewUrl);
        } catch {
          // ignore
        }
      }
      return prev.filter((p) => p.id !== id);
    });
    setPreviewPhotoId((prev) => (prev === id ? "" : prev));
    setPreviewAnim((prev) => (prev?.id === id ? null : prev));
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

  // Cache the nav list's own resting box height only while the bottom section is
  // actually at rest (closed), as the baseline for the slack-vs-push calculation
  // below — its live height changes once the bottom section starts pushing it.
  const navBoxRestHeightRef = useRef<number | null>(null);
  useLayoutEffect(() => {
    if (isUserSettingsPanelOpen) return;
    if (navListRef.current) navBoxRestHeightRef.current = navListRef.current.clientHeight;
  }, [isUserSettingsPanelOpen]);

  // Natural (unconstrained) height of the nav links themselves, independent of
  // how tall the scrollable box around them currently is.
  const [navContentHeight, setNavContentHeight] = useState<number | null>(null);
  useLayoutEffect(() => {
    if (navListRef.current) setNavContentHeight(navListRef.current.scrollHeight);
  }, [visibleTopNav]);

  // Both the rest content (User Settings button + avatar row) and the panel content
  // are always mounted (grid-stacked, crossfaded via opacity) so their natural
  // heights can be measured continuously via ResizeObserver, independent of which
  // one is currently visible. The wrapper's own height animates between these two
  // measured values, which is what makes the nav list above it get pushed up.
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
  }, []);

  const openUserSettingsPanel = () => {
    setIsUserSettingsPanelOpen(true);
  };

  const closeUserSettingsPanel = () => {
    setIsUserSettingsPanelOpen(false);
  };

  useEffect(() => {
    if (!isUserSettingsPanelOpen || typeof document === "undefined") return;
    const onPointerDown = (event: MouseEvent) => {
      const targetNode = event.target as Node;
      if (desktopAsideRef.current?.contains(targetNode)) return;
      // The mobile drawer's own sliding user-settings card is a second, separate instance of
      // this same "inside" check — without it, any click inside the mobile panel (an edit
      // button, a field, anything) reads as "outside" and immediately closes the panel it was
      // just clicked in.
      if (mobileNavPanelRef.current?.contains(targetNode)) return;
      const popoverEl = targetNode instanceof Element ? targetNode.closest('[data-sidebar-color-popover="true"]') : null;
      if (popoverEl) return;
      closeUserSettingsPanel();
    };
    document.addEventListener("mousedown", onPointerDown);
    return () => document.removeEventListener("mousedown", onPointerDown);
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
    const name = String(projectName || "").trim();
    const firstName = String(clientFirstName || "").trim();
    const lastName = String(clientLastName || "").trim();
    const customer = [firstName, lastName].filter(Boolean).join(" ").trim();
    if (!name) {
      setProjectFormError("Project Name is required.");
      return;
    }
    if (!customer) {
      setProjectFormError("Client Name is required.");
      return;
    }
    setProjectFormError("");

    if (!hasFirebaseConfig || !db) {
      setShowNewProject(false);
      router.push("/projects/prj_1001");
      return;
    }

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
        status: defaultProjectStatus || "New",
        tags,
        isDeleted: false,
        projectImages: projectImageUrls,
        projectImageItems,
        cutlist: { rows: [] },
        cutlistJson: { rows: [] },
        projectSettings,
        projectSettingsJson: JSON.stringify(projectSettings),
        sales,
        salesJson: JSON.stringify(sales),
        // "Notifications as Creator" (User Settings) — off by default (see
        // lib/project-notify.ts's isProjectNotifySubscribed), only written here at all when the
        // creator has opted in, so a project's stored overrides stay empty/absent for everyone
        // who hasn't touched this setting.
        ...(user?.notifyAsCreator && user?.uid ? { notifySubscriptionOverrides: { [user.uid]: true } } : {}),
      });
        try {
          const clientCreateResult = await fetch("/api/clients", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              projectId,
              companyId,
              projectName: name,
              customer,
              createdAtIso: nowIso,
              updatedAtIso: nowIso,
              createdByUid: user?.uid ?? "",
              createdByName: user?.displayName ?? "CutSmart User",
              assignedToUid: assignedUid,
              assignedToName: assignedName,
              assignedTo: assignedName,
              statusLabel: defaultProjectStatus || "New",
              tags,
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
              createdAtIso: nowIso,
              updatedAtIso: nowIso,
              createdByUid: user?.uid ?? "",
              createdByName: user?.displayName ?? "CutSmart User",
              assignedToUid: assignedUid,
              assignedToName: assignedName,
              assignedTo: assignedName,
              statusLabel: defaultProjectStatus || "New",
              tags,
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
            createdAtIso: nowIso,
            updatedAtIso: nowIso,
            createdByUid: user?.uid ?? "",
            createdByName: user?.displayName ?? "CutSmart User",
            assignedToUid: assignedUid,
            assignedToName: assignedName,
            assignedTo: assignedName,
            statusLabel: defaultProjectStatus || "New",
            tags,
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
      if (tags.length > 0) {
        await resyncCompanyProjectTagUsage(companyId);
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

  const modalRowClass = "flex flex-col gap-1.5";
  const modalLabelClass = "text-[12px] font-semibold text-[var(--text-muted)]";
  const modalSectionLabelClass =
    "mt-1 border-t border-[var(--panel-border)] pt-4 text-[11px] font-bold uppercase tracking-wide text-[var(--text-muted)]";
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

  // While opening, the settings section first grows into whatever blank slack
  // exists below the last nav tab (tabs stay put, it just covers empty space).
  // Only once it would grow far enough to actually cover a tab does the nav list
  // get pushed up for real — and even then, a clearance gap is kept so the tabs
  // never sit flush against the settings section.
  const USER_SETTINGS_CLEARANCE_PX = 20;
  const bottomSectionTargetHeight = (isUserSettingsPanelOpen ? panelContentHeight : restContentHeight) ?? restContentHeight ?? 0;
  const bottomSectionRestHeight = restContentHeight ?? 0;
  const bottomSectionExcess = Math.max(0, bottomSectionTargetHeight - bottomSectionRestHeight);
  const navSlack =
    navBoxRestHeightRef.current != null && navContentHeight != null
      ? Math.max(0, navBoxRestHeightRef.current - navContentHeight)
      : 0;
  const navSlackBeforeClearance = Math.max(0, navSlack - USER_SETTINGS_CLEARANCE_PX);
  const navListMarginBottom = bottomSectionRestHeight + Math.max(0, bottomSectionExcess - navSlackBeforeClearance);

  // The small (rest) row and the full panel are grid-stacked in the same box, so
  // exactly one of them is shown at a time via a simple opacity crossfade — the
  // small icon/name fade away on open, the panel (its own icon/name included)
  // fades in as part of the same reveal as the rest of its content.
  const showBottomPanelContent = isUserSettingsPanelOpen;
  const showBottomRestContent = !isUserSettingsPanelOpen;

  return (
    <div
      className="min-h-screen"
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

      {!effectiveHideSidebar && shouldRenderMobileNav && (
        <div className="fixed inset-0 z-[120] lg:hidden">
          <button
            type="button"
            data-swipe-backdrop="true"
            className="absolute inset-0 bg-[rgba(15,23,42,0.45)]"
            onClick={() => setMobileNavOpen(false)}
            aria-label="Close menu backdrop"
          />
          <aside
            ref={mobileNavPanelRef}
            {...mobileNavTouchHandlers}
            className="relative z-[121] flex h-full w-full flex-col overflow-hidden"
            style={{
              backgroundColor: "var(--panel-bg)",
              color: shellPalette.text,
              touchAction: "pan-y",
            }}
          >
            {/* Alongside the swipe-to-close gesture — an explicit tap target in the corner the
                drawer will retreat toward (right, since it slides back out to the left). */}
            <button
              type="button"
              onClick={() => setMobileNavOpen(false)}
              className="absolute right-3 top-3 z-10 inline-flex h-9 w-9 items-center justify-center rounded-[8px] border"
              style={{ borderColor: shellPalette.border, backgroundColor: shellPalette.panelBg, color: shellPalette.textMuted }}
              aria-label="Close menu"
            >
              <ChevronRight size={18} />
            </button>
            <div className="flex items-center border-b border-[var(--panel-border)] px-4 py-3" style={{ borderColor: shellPalette.border }}>
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
                    setAssigneeUid("");
                    setNewProjectOrigin(captureGlassModalOrigin(e));
                    setShowNewProject(true);
                    setMobileNavOpen(false);
                  }}
                  className="mb-3 flex h-14 w-full shrink-0 items-center justify-center gap-2 rounded-[12px] bg-[image:var(--brand-gradient)] text-[17px] font-semibold text-white shadow-[var(--shadow-sm)] transition hover:brightness-105"
                >
                  <PlusCircle size={20} />
                  New Project
                </button>
              )}
              <div className="min-h-0 flex-1 space-y-1 overflow-y-auto pr-1">
                {visibleTopNav.map((item) => {
                  const active = pathname?.startsWith(item.href);
                  const Icon = item.icon;
                  return (
                    <Link
                      key={item.href}
                      href={item.href}
                      className={cn(
                        "flex items-center gap-3 rounded-[12px] px-4 py-3.5 text-[17px] font-semibold transition",
                        active ? "bg-[var(--brand-soft)]" : "hover:bg-[var(--panel-muted)]",
                      )}
                      style={{
                        color: active ? "var(--brand)" : shellPalette.textMuted,
                      }}
                    >
                      <Icon size={22} />
                      {item.label}
                    </Link>
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
                  borderColor: shellPalette.border,
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
                    <button
                      type="button"
                      onClick={openUserSettingsPanel}
                      className="flex w-full items-center gap-3 rounded-[12px] px-3 py-3 text-left transition hover:bg-[var(--panel-muted)]"
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
                          <span className="block truncate text-[12px] font-semibold" style={{ color: "#B7791F" }}>Demo data mode</span>
                        )}
                      </div>
                    </button>
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
                      onRequestLogout={(e) => { setLogoutConfirmOrigin(captureGlassModalOrigin(e)); setShowLogoutConfirm(true); }}
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
        className="z-[70] hidden w-[240px] flex-col overflow-hidden border-r lg:flex"
        style={{
          position: "fixed",
          left: 0,
          top: 0,
          height: "100vh",
          backgroundColor: "var(--glass-bg)",
          backdropFilter: "blur(24px) saturate(180%)",
          WebkitBackdropFilter: "blur(24px) saturate(180%)",
          borderColor: "var(--glass-border)",
          boxShadow: "var(--shadow-glass)",
          color: shellPalette.text,
          display: effectiveHideSidebar ? "none" : undefined,
        }}
      >
        <div className="border-b border-[var(--panel-border)]" style={{ borderColor: shellPalette.border }}>
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

        <div className="relative flex min-h-0 h-full flex-1 flex-col px-3 pb-3 pt-3">
          {canCreateProject && (
            <button
              type="button"
              onClick={(e) => { setAssigneeUid(""); setNewProjectOrigin(captureGlassModalOrigin(e)); setShowNewProject(true); }}
              className="mb-3 flex h-10 w-full shrink-0 items-center justify-center gap-2 rounded-[10px] bg-[image:var(--brand-gradient)] text-[13px] font-semibold text-white shadow-[var(--shadow-sm)] transition hover:brightness-105"
            >
              <PlusCircle size={16} />
              New Project
            </button>
          )}
          <div
            ref={navListRef}
            className="relative min-h-0 flex-1 space-y-0.5 overflow-y-auto pr-1"
            style={{
              marginBottom: navListMarginBottom || undefined,
              transition: "margin-bottom 320ms cubic-bezier(0.22, 1, 0.36, 1)",
            }}
          >
            {navHighlightRect && (
              <div
                aria-hidden="true"
                className="absolute left-0 right-1 rounded-[10px]"
                style={{
                  top: navHighlightRect.top,
                  height: navHighlightRect.height,
                  backgroundColor: "var(--brand-soft)",
                  transition: "top 260ms cubic-bezier(0.22, 1, 0.36, 1), height 260ms cubic-bezier(0.22, 1, 0.36, 1)",
                  zIndex: 0,
                }}
              />
            )}
            {visibleTopNav.map((item) => {
              const active = pathname?.startsWith(item.href);
              const Icon = item.icon;
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  ref={(el) => {
                    navLinkRefs.current[item.href] = el;
                  }}
                  className={cn(
                    "relative z-[1] flex items-center gap-2.5 rounded-[10px] px-3 py-2.5 text-[13px] font-semibold transition-colors",
                    !active && "hover:bg-[var(--panel-muted)]",
                  )}
                  style={{
                    color: active ? "var(--brand)" : shellPalette.textMuted,
                  }}
                >
                  <Icon size={17} />
                  {item.label}
                </Link>
              );
            })}
          </div>

          {/* Bottom section: bottom-anchored overlay whose height animates between
              the two measured content heights below. The nav list above always
              reserves restContentHeight of space (its own marginBottom) so it never
              compresses or scrolls differently — this section just slides its top
              edge (the divider) further up, over the nav list, to reveal more. */}
          <div
            className="absolute inset-x-0 bottom-0 z-[5] overflow-hidden"
            style={{
              height: (isUserSettingsPanelOpen ? panelContentHeight : restContentHeight) ?? undefined,
              backgroundColor: "var(--glass-bg-strong)",
              backdropFilter: "blur(24px) saturate(180%)",
              WebkitBackdropFilter: "blur(24px) saturate(180%)",
              transition: "height 320ms cubic-bezier(0.22, 1, 0.36, 1)",
            }}
          >
            <div className="grid items-start">
              <div
                ref={bottomRestContentRef}
                className="space-y-0.5 border-t pb-3 pt-3"
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
                  <div className="min-w-0 flex-1">
                    <p className="m-0 block truncate text-[12px] font-semibold" style={{ color: shellPalette.text }}>{user?.displayName || "CutSmart User"}</p>
                    {isDemoMode && (
                      <span className="block truncate text-[10px] font-semibold" style={{ color: "#B7791F" }}>Demo data mode</span>
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
                  onRequestLogout={(e) => { setLogoutConfirmOrigin(captureGlassModalOrigin(e)); setShowLogoutConfirm(true); }}
                />
              </div>
            </div>
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
          same position/width, invisible (opacity 0, pointer-events none) at rest. Has NO background
          of its own — the tab bar's own outer div is the one persistent bar surface (see
          resetPullBanner's own comment); this only ever holds the pulldown icons, which fade IN as
          the tab bar's own CONTENT (not its background) fades OUT, over a short PULL_FADE_DISTANCE_PX
          so the switch reads as near-instant. */}
      {!isDesktopViewport && mobileTopBarEnabled && (
        <div
          ref={pullBannerRef}
          aria-hidden="true"
          className="fixed left-0 right-0 top-0 z-[150] flex"
          style={{
            height: PULL_BANNER_MIN_HEIGHT_PX,
            opacity: 0,
            pointerEvents: "none",
            backgroundColor: "transparent",
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
          width: "100%",
          paddingLeft: 0,
          overflowX: "visible",
          overflowY: "visible",
        }}
      >
        <main
          ref={mainScrollRef}
          className={
            chromeHidden
              ? "min-h-0 min-w-0 overscroll-y-contain"
              : "min-h-0 min-w-0 overscroll-y-contain px-3 py-3 md:px-4 md:py-4 lg:px-5 lg:py-4"
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
            overflowX: isDesktopViewport ? "visible" : "clip",
            overflowY: isDesktopViewport ? "visible" : "auto",
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
            backgroundColor: "var(--bg-app)",
          }}
        >
          {/* height:100% is a no-op unless <main> itself has a definite height
              (fillMainViewport, or mobile's own dvh calc above) — safe to apply
              unconditionally so a page can opt into filling <main> exactly by
              making its own root height:100% + a flex column, without needing
              any page-specific plumbing here beyond the fillMainViewport flag. */}
          <div className={effectiveHideSidebar ? "" : "lg:ml-[240px]"} style={{ height: "100%" }}>{children}</div>
        </main>
      </div>
      {showUpdateNotice && (
        <div
          className="glass-modal-backdrop fixed inset-0 z-[8900] flex items-center justify-center px-4"
          onClick={dismissUpdateNotice}
        >
          <div
            className="glass-modal-panel relative flex w-[min(860px,calc(100vw-20px))] max-h-[min(80vh,720px)] flex-col overflow-hidden text-[var(--text-main)]"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="glass-modal-header relative flex h-[56px] shrink-0 items-center justify-between px-4">
              <p className="text-[17px] font-medium text-[var(--text-main)]">
                Updated to {updateNoticeVersion || "Unknown Version"}
              </p>
              <button
                type="button"
                onClick={dismissUpdateNotice}
                className="inline-flex h-8 w-8 items-center justify-center rounded-[8px] border hover:brightness-95"
                style={{
                  borderColor: "var(--danger-glass-border)",
                  backgroundColor: "var(--danger-glass-bg)",
                  backdropFilter: "blur(10px) saturate(180%)",
                  WebkitBackdropFilter: "blur(10px) saturate(180%)",
                  color: "#FFFFFF",
                }}
                title="Close"
              >
                <X size={16} strokeWidth={2.4} />
              </button>
            </div>
            <div className="min-h-0 flex-1 overflow-auto px-4 py-4">
              <div
                className="notes-rich text-[15px] leading-7 text-[var(--text-main)]"
                dangerouslySetInnerHTML={{
                  __html: updateNotesToDisplayHtml(updateNoticeText || "- No update notes provided."),
                }}
              />
            </div>
          </div>
        </div>
      )}

      {shouldRenderNewProjectModal && (
        <div
          className="glass-modal-backdrop fixed inset-0 z-[9000] flex items-center justify-center px-4"
          onClick={(e) => {
            if (e.target !== e.currentTarget) return;
            if (hasNewProjectFormContent()) return;
            setShowNewProject(false);
            resetProjectForm();
          }}
        >
          <div
            ref={newProjectPanelRef}
            className="glass-modal-panel relative flex flex-col overflow-hidden"
            style={{
              width: "min(920px, calc(100vw - 16px))",
              height: "min(660px, calc(100vh - 16px))",
            }}
          >
            <div className="glass-modal-header px-5 py-4 sm:px-6">
              <p className="text-[19px] font-semibold text-[var(--text-main)]">New Project</p>
            </div>
            <div ref={newProjectScrollRef} className="glass-scroll relative flex-1 space-y-4 overflow-y-auto px-5 py-4 sm:px-6">
              <div className={cn(modalRowClass, "max-w-[480px]")}>
                <p className={modalLabelClass}>Project Name</p>
                <input
                  value={projectName}
                  onChange={(e) => setProjectName(e.target.value)}
                  className="h-10 w-full rounded-[10px] border border-[var(--panel-border)] bg-[var(--panel-bg)] px-3 text-[13px] text-[var(--text-main)] outline-none transition focus:border-[var(--brand)]"
                  placeholder="Project name"
                />
              </div>
              <div className={cn(modalRowClass, "max-w-[480px]")}>
                <p className={modalLabelClass}>Client Name</p>
                <div className="grid grid-cols-2 gap-2">
                  <input
                    value={clientFirstName}
                    onChange={(e) => setClientFirstName(e.target.value)}
                    className="h-10 w-full rounded-[10px] border border-[var(--panel-border)] bg-[var(--panel-bg)] px-3 text-[13px] text-[var(--text-main)] outline-none transition focus:border-[var(--brand)]"
                    placeholder="First"
                  />
                  <input
                    value={clientLastName}
                    onChange={(e) => setClientLastName(e.target.value)}
                    className="h-10 w-full rounded-[10px] border border-[var(--panel-border)] bg-[var(--panel-bg)] px-3 text-[13px] text-[var(--text-main)] outline-none transition focus:border-[var(--brand)]"
                    placeholder="Last"
                  />
                </div>
              </div>
              <div className="grid max-w-[480px] grid-cols-1 gap-3 sm:grid-cols-2">
                <div className={modalRowClass}>
                  <p className={modalLabelClass}>Client Phone</p>
                  <input
                    value={clientPhone}
                    onChange={(e) => setClientPhone(formatMobileLikeDesktop(e.target.value))}
                    className="h-10 w-full rounded-[10px] border border-[var(--panel-border)] bg-[var(--panel-bg)] px-3 text-[13px] text-[var(--text-main)] outline-none transition focus:border-[var(--brand)]"
                    placeholder="021 234 5678"
                  />
                </div>
                <div className={modalRowClass}>
                  <p className={modalLabelClass}>Client Email</p>
                  <input
                    value={clientEmail}
                    onChange={(e) => setClientEmail(e.target.value)}
                    className="h-10 w-full rounded-[10px] border border-[var(--panel-border)] bg-[var(--panel-bg)] px-3 text-[13px] text-[var(--text-main)] outline-none transition focus:border-[var(--brand)]"
                    placeholder="client@email.com"
                  />
                </div>
              </div>
              <div className={cn(modalRowClass, "max-w-[480px]")}>
                <p className={modalLabelClass}>Project Address</p>
                <input
                  value={projectAddress}
                  onChange={(e) => setProjectAddress(e.target.value)}
                  className="h-10 w-full rounded-[10px] border border-[var(--panel-border)] bg-[var(--panel-bg)] px-3 text-[13px] text-[var(--text-main)] outline-none transition focus:border-[var(--brand)]"
                  placeholder="Street, suburb, city"
                />
              </div>
              {projectAddress.trim().length > 5 && (
                <div className={cn(modalRowClass, "max-w-[480px]")}>
                  <div className="overflow-hidden rounded-[10px] border border-[var(--panel-border)]">
                    <iframe
                      title="Address preview"
                      className="h-[170px] w-full border-0"
                      src={`https://maps.google.com/maps?q=${encodeURIComponent(projectAddress.trim())}&t=&z=13&ie=UTF8&iwloc=&output=embed`}
                    />
                  </div>
                </div>
              )}
              <div className={modalRowClass}>
                <p className={modalSectionLabelClass}>Tags</p>
                <div>
                  <div className="flex flex-wrap items-center gap-2">
                    {tags.map((tag) => (
                      <button
                        key={tag}
                        type="button"
                        onClick={() => removeTag(tag)}
                        className="inline-flex items-center gap-1 rounded-[8px] border border-[var(--panel-border)] bg-[var(--panel-muted)] px-2 py-[2px] text-[12px] font-semibold text-[var(--text-muted)] transition hover:border-[var(--danger-border)] hover:bg-[var(--danger-soft)] hover:text-[var(--danger)]"
                        title="Delete tag"
                      >
                        <Tag size={11} />
                        {tag}
                      </button>
                    ))}
                    {tags.length < 5 && isTagInputOpen && (
                      <div className="relative">
                        <input
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
                          className="h-7 w-[120px] rounded-[8px] border border-[var(--panel-border)] bg-[var(--panel-bg)] px-2 text-[12px] text-[var(--text-main)] outline-none transition focus:border-[var(--brand)]"
                          placeholder="Tag"
                        />
                        {showTagSuggestions && filteredTagSuggestions.length > 0 && (
                          <div className="absolute left-0 top-[calc(100%+2px)] z-30 max-h-[220px] w-[220px] overflow-auto rounded-[10px] border border-[var(--panel-border)] bg-[var(--panel-bg)] p-1 shadow-[var(--shadow-md)]">
                            {filteredTagSuggestions.map((tag) => (
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
                                className="block w-full rounded-[6px] px-2 py-1 text-left text-[12px] font-semibold text-[var(--text-main)] hover:bg-[var(--panel-muted)]"
                              >
                                {tag}
                              </button>
                            ))}
                          </div>
                        )}
                      </div>
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
                        className="inline-flex h-[22px] w-[22px] items-center justify-center rounded-[8px] border border-[var(--panel-border)] bg-[var(--panel-muted)] text-[var(--text-muted)] transition hover:border-[var(--brand)] hover:text-[var(--brand)]"
                        aria-label="Add tag"
                      >
                        <Plus size={14} />
                      </button>
                    )}
                  </div>
                </div>
              </div>
              <div className={modalRowClass}>
                <div className="flex min-w-0 flex-col gap-2">
                  <p className={modalSectionLabelClass}>Notes</p>
                  <div
                    className="flex min-h-[30px] items-center justify-start"
                    ref={setNewProjectNotesToolbarHost}
                    onMouseDownCapture={(e) => e.preventDefault()}
                  />
                </div>
                <div className="w-full">
                  <div className="overflow-hidden rounded-[10px] border border-[var(--panel-border)] bg-[var(--panel-bg)] px-2 py-2">
                    <div className="min-h-[88px]">
                      {isNewProjectNotesEditing ? (
                        <QuoteDocumentEditor
                          key="new-project-notes-editor"
                          mode="embedded"
                          toolbarPlacement="inline"
                          toolbarHost={newProjectNotesToolbarHost}
                          embeddedChrome="flat"
                          embeddedMinHeight={88}
                          embeddedEditableMinHeight={80}
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
                          className="block min-h-[88px] w-full bg-transparent text-left text-[12px] text-[var(--text-main)] outline-none"
                        >
                          {notesHtmlIsEmpty(projectNotes) ? (
                            <span className="text-[var(--text-muted)]">Project notes...</span>
                          ) : (
                            <div className="notes-rich" dangerouslySetInnerHTML={{ __html: notesToDisplayHtml(projectNotes) }} />
                          )}
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              </div>
              <div className={modalRowClass}>
                <p className={modalSectionLabelClass}>Photos (max 10)</p>
                <div
                  className="grid w-full grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-5"
                >
                  {Array.from({
                    length: Math.min(prefilledProjectImages.length + photos.length + 1, 10),
                  }).map((_, idx) => {
                    const prefilledImage = prefilledProjectImages[idx] ?? null;
                    const photo =
                      idx >= prefilledProjectImages.length
                        ? (photos[idx - prefilledProjectImages.length] ?? null)
                        : null;
                    return (
                      <div
                        key={`photo_slot_${idx}`}
                        className="relative flex items-start justify-center"
                        style={{ minHeight: 110 }}
                        onMouseLeave={() => setHoveredPhotoId("")}
                      >
                        {prefilledImage ? (
                          <div className="flex h-full w-full flex-col gap-1">
                            <div className="relative flex h-[88px] w-full items-center justify-center overflow-hidden rounded-[8px] border border-[var(--panel-border)] bg-transparent">
                              <button
                                type="button"
                                onClick={() => {
                                  if (typeof window !== "undefined") {
                                    window.open(prefilledImage.url, "_blank", "noopener,noreferrer");
                                  }
                                }}
                                className="flex h-full w-full cursor-zoom-in items-center justify-center leading-none"
                                title="Click to enlarge"
                              >
                                <img
                                  src={prefilledImage.url}
                                  alt={`Lead photo ${idx + 1}`}
                                  className="block h-full w-full object-cover"
                                  style={{ objectFit: "cover", objectPosition: "center" }}
                                />
                              </button>
                              <button
                                type="button"
                                onClick={() => removePrefilledProjectImage(prefilledImage.id)}
                                className="absolute left-1/2 inline-flex -translate-x-1/2 items-center justify-center rounded-full text-white transition-opacity duration-150"
                                style={{
                                  bottom: 6,
                                  width: 24,
                                  height: 24,
                                  border: "1px solid #7F1D1D",
                                  background: "#EF4444",
                                  boxShadow: "0 2px 6px rgba(0,0,0,0.28)",
                                  opacity: 1,
                                }}
                                aria-label="Remove photo"
                              >
                                <img
                                  src="/trash.png"
                                  alt="Delete"
                                  className="object-contain"
                                  style={{ width: 12, height: 12, filter: "brightness(0) invert(1)" }}
                                  onError={(e) => {
                                    e.currentTarget.style.display = "none";
                                  }}
                                />
                              </button>
                            </div>
                            <div className="flex h-5 items-center justify-center overflow-hidden rounded-[6px] border border-[var(--panel-border)] bg-[var(--panel-bg)] px-2">
                              {editingProjectPhotoNameKey === `prefilled:${prefilledImage.id}` ? (
                                <input
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
                                  className="h-full w-full bg-transparent text-center text-[11px] font-medium text-[var(--text-main)] outline-none"
                                />
                              ) : String(prefilledImage.name || "").trim() ? (
                                <span className="truncate text-center text-[11px] font-medium text-[var(--text-main)]">
                                  {String(prefilledImage.name || "").trim()}
                                </span>
                              ) : (
                                <button
                                  type="button"
                                  onClick={() => beginEditProjectPhotoName(`prefilled:${prefilledImage.id}`, String(prefilledImage.name || ""))}
                                  className="inline-flex h-full w-full items-center justify-center"
                                  title="Name image"
                                >
                                  <img
                                    src="/edit.png"
                                    alt="Name image"
                                    className="object-contain"
                                    style={{ width: 12, height: 12, opacity: 0.8 }}
                                    onError={(e) => {
                                      e.currentTarget.style.display = "none";
                                    }}
                                  />
                                </button>
                              )}
                            </div>
                          </div>
                        ) : photo ? (
                          <div className="flex h-full w-full flex-col gap-1">
                            <div
                              className="relative flex h-[88px] items-center justify-center overflow-hidden rounded-[8px] border border-[var(--panel-border)] bg-transparent"
                              onMouseEnter={() => setHoveredPhotoId(photo.id)}
                              style={{
                                width:
                                  photo.aspectRatio < 1
                                    ? Math.max(42, Math.round(88 * photo.aspectRatio))
                                    : "100%",
                                minWidth: photo.aspectRatio < 1 ? 42 : undefined,
                              }}
                            >
                              <button
                                type="button"
                                onClick={() => openPreviewAnimated(photo)}
                                ref={(el) => {
                                  photoThumbRefs.current[photo.id] = el;
                                }}
                                className="flex h-full w-full cursor-zoom-in items-center justify-center leading-none"
                                title="Click to enlarge"
                              >
                                <img
                                  src={photo.previewUrl}
                                  alt={`Photo ${idx + 1}`}
                                  className="block h-full w-full object-cover"
                                  style={{ objectFit: "cover", objectPosition: "center" }}
                                />
                              </button>
                              <button
                                type="button"
                                onClick={() => removePhoto(photo.id)}
                                onMouseDown={(e) => e.stopPropagation()}
                                className="absolute left-1/2 inline-flex -translate-x-1/2 items-center justify-center rounded-full text-white transition-opacity duration-150"
                                style={{
                                  bottom: 6,
                                  width: 24,
                                  height: 24,
                                  border: "1px solid #7F1D1D",
                                  background: "#EF4444",
                                  boxShadow: "0 2px 6px rgba(0,0,0,0.28)",
                                  opacity: hoveredPhotoId === photo.id ? 1 : 0,
                                  pointerEvents: hoveredPhotoId === photo.id ? "auto" : "none",
                                }}
                                aria-label="Remove photo"
                              >
                                <img
                                  src="/trash.png"
                                  alt="Delete"
                                  className="object-contain"
                                  style={{ width: 12, height: 12, filter: "brightness(0) invert(1)" }}
                                  onError={(e) => {
                                    e.currentTarget.style.display = "none";
                                  }}
                                />
                              </button>
                            </div>
                            <div className="flex h-5 items-center justify-center overflow-hidden rounded-[6px] border border-[var(--panel-border)] bg-[var(--panel-bg)] px-2">
                              {editingProjectPhotoNameKey === `local:${photo.id}` ? (
                                <input
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
                                  className="h-full w-full bg-transparent text-center text-[11px] font-medium text-[var(--text-main)] outline-none"
                                />
                              ) : String(photo.name || "").trim() ? (
                                <span className="truncate text-center text-[11px] font-medium text-[var(--text-main)]">
                                  {String(photo.name || "").trim()}
                                </span>
                              ) : (
                                <button
                                  type="button"
                                  onClick={() => beginEditProjectPhotoName(`local:${photo.id}`, String(photo.name || ""))}
                                  className="inline-flex h-full w-full items-center justify-center"
                                  title="Name image"
                                >
                                  <img
                                    src="/edit.png"
                                    alt="Name image"
                                    className="object-contain"
                                    style={{ width: 12, height: 12, opacity: 0.8 }}
                                    onError={(e) => {
                                      e.currentTarget.style.display = "none";
                                    }}
                                  />
                                </button>
                              )}
                            </div>
                          </div>
                        ) : (
                          <label className="relative flex h-full w-full cursor-pointer items-center justify-center overflow-hidden rounded-[8px] border border-[var(--panel-border)] bg-[var(--panel-muted)] text-[11px] font-bold text-[var(--text-muted)]">
                            <span
                              aria-hidden="true"
                              className="pointer-events-none absolute"
                              style={{
                                width: 24,
                                height: 24,
                                backgroundColor: companyThemeColor || "#7C8EA5",
                                WebkitMaskImage: "url('/add-image.png')",
                                WebkitMaskRepeat: "no-repeat",
                                WebkitMaskPosition: "center",
                                WebkitMaskSize: "contain",
                                maskImage: "url('/add-image.png')",
                                maskRepeat: "no-repeat",
                                maskPosition: "center",
                                maskSize: "contain",
                              }}
                            />
                            <input
                              type="file"
                              accept="image/*"
                              multiple
                              style={{ display: "none" }}
                              onChange={(e) => {
                                void addPhotoFiles(e.target.files);
                                e.currentTarget.value = "";
                              }}
                            />
                          </label>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
              {canCreateForOthers && (
                <div className={modalRowClass}>
                  <p className={modalSectionLabelClass}>Assign Project To</p>
                  <div ref={assigneeFieldRef} className="relative">
                    <button
                      type="button"
                      onClick={() => setAssigneeMenuOpen((v) => !v)}
                      className="flex h-9 w-full items-center justify-between rounded-[10px] border border-[var(--panel-border)] bg-[var(--panel-bg)] px-2.5 text-left text-[12px] text-[var(--text-main)]"
                    >
                      <span className="flex min-w-0 items-center gap-2">
                        {selectedAssignee ? renderStaffOptionBadge(selectedAssignee, 20) : null}
                        <span className="truncate">{selectedAssignee?.name || "Select staff member"}</span>
                      </span>
                      <span className="text-[var(--text-muted)]">&#9662;</span>
                    </button>
                    {assigneeMenuOpen && (
                      <div className="absolute z-20 mt-1 w-full rounded-[10px] border border-[var(--panel-border)] bg-[var(--panel-bg)] shadow-[var(--shadow-md)]">
                        <div className="relative border-b border-[var(--panel-border)] px-2 py-2">
                          <Search size={13} className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-[var(--text-muted)]" />
                          <input
                            value={assigneeSearch}
                            onChange={(e) => setAssigneeSearch(e.target.value)}
                            className="h-8 w-full rounded-[8px] border border-[var(--panel-border)] bg-[var(--panel-bg)] pl-7 pr-2 text-[12px] text-[var(--text-main)] outline-none transition focus:border-[var(--brand)]"
                            placeholder="Search staff..."
                          />
                        </div>
                        <div className="max-h-[180px] overflow-y-auto py-1">
                          {filteredStaffOptions.map((s) => (
                            <button
                              key={s.uid}
                              type="button"
                              onClick={() => {
                                setAssigneeUid(s.uid);
                                setAssigneeMenuOpen(false);
                              }}
                              className="block w-full px-2 py-2 text-left text-[12px] hover:bg-[var(--panel-muted)]"
                            >
                              <div className="flex items-start gap-2">
                                {renderStaffOptionBadge(s, 20)}
                                <div className="min-w-0">
                                  <p className="truncate font-semibold text-[var(--text-main)]">{s.name}</p>
                                  <p className="truncate text-[11px] text-[var(--text-muted)]">{s.email}</p>
                                </div>
                              </div>
                            </button>
                          ))}
                          {!filteredStaffOptions.length && (
                            <div className="px-2 py-2 text-[12px] text-[var(--text-muted)]">No staff found.</div>
                          )}
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              )}
              {!!projectFormError && (
                <p className="text-[12px] font-semibold text-[var(--danger)]">{projectFormError}</p>
              )}
            </div>
            {previewPhoto && (
              <div
                className="absolute inset-0 z-30 flex items-center justify-center p-4"
                onClick={closePreviewAnimated}
                style={{
                  backgroundColor: "rgba(255,255,255,0.88)",
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
            <div className="flex flex-col-reverse items-stretch justify-end gap-2 border-t border-[var(--panel-border)] px-5 pb-5 pt-4 sm:flex-row sm:items-center sm:px-6 sm:pb-6">
              <button
                type="button"
                onClick={() => {
                  setShowNewProject(false);
                  resetProjectForm();
                }}
                className="h-10 rounded-[10px] border border-[var(--panel-border)] bg-[var(--panel-bg)] px-4 text-[13px] font-semibold text-[var(--text-main)] transition hover:bg-[var(--panel-muted)] sm:w-auto"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={creatingProject}
                onClick={() => void onCreateProject()}
                className="h-10 rounded-[10px] bg-[image:var(--brand-gradient)] px-5 text-[13px] font-semibold text-white shadow-[var(--shadow-sm)] transition hover:brightness-105 disabled:opacity-55 sm:w-auto"
              >
                {creatingProject ? "Creating..." : "Create Project"}
              </button>
            </div>
          </div>
        </div>
      )}
      {shouldRenderLogoutConfirmModal && (
        <div className="fixed inset-0 z-[9100] flex items-center justify-center px-4">
          <button
            type="button"
            aria-label="Close dialog backdrop"
            onClick={() => setShowLogoutConfirm(false)}
            className="glass-modal-backdrop absolute inset-0"
          />
          <div ref={logoutConfirmPanelRef} className="glass-modal-panel relative w-full max-w-[380px] overflow-hidden">
            <div className="glass-modal-header px-5 py-4">
              <h3 className="text-[15px] font-bold" style={{ color: "var(--text-main)" }}>Log out?</h3>
            </div>
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
      )}
    </div>
  );
}
