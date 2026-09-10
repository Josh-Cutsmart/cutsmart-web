"use client";

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { doc, serverTimestamp, setDoc } from "firebase/firestore";
import { getDownloadURL, ref as storageRef, uploadBytes } from "firebase/storage";
import {
  Building2,
  CalendarDays,
  ImagePlus,
  Inbox,
  LayoutDashboard,
  LogOut,
  Menu,
  Plus,
  PlusCircle,
  Search,
  Settings,
  Tag,
  Trash2,
  Users,
  UserCog,
  X,
} from "lucide-react";
import { useAuth } from "@/lib/auth-context";
import { useAppTabs } from "@/lib/app-tabs-context";
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
  { href: "/company-settings", label: "Company Settings", icon: Settings },
];

const bottomNav = [{ href: "/user-settings", label: "User Settings", icon: UserCog }];

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
  const { user, logout, isDemoMode } = useAuth();
  const { chromeHidden, fillMainViewport } = useAppTabs();
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
    if (!user?.verified && autoVerifyPromptedUidRef.current !== uid) {
      autoVerifyPromptedUidRef.current = uid;
      setIsAutoVerifyModalOpen(true);
    }
  }, [user?.uid, user?.verified]);
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
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const [navHighlightRect, setNavHighlightRect] = useState<{ top: number; height: number } | null>(null);
  const navListRef = useRef<HTMLDivElement | null>(null);
  const navLinkRefs = useRef<Record<string, HTMLAnchorElement | null>>({});
  const [isUserSettingsPanelOpen, setIsUserSettingsPanelOpen] = useState(false);
  const desktopAsideRef = useRef<HTMLElement | null>(null);
  const bottomRestContentRef = useRef<HTMLDivElement | null>(null);
  const bottomPanelContentRef = useRef<HTMLDivElement | null>(null);
  const [restContentHeight, setRestContentHeight] = useState<number | null>(null);
  const [panelContentHeight, setPanelContentHeight] = useState<number | null>(null);
  const [showUpdateNotice, setShowUpdateNotice] = useState(false);
  const [updateNoticeVersion, setUpdateNoticeVersion] = useState("");
  const [updateNoticeText, setUpdateNoticeText] = useState("");
  const [companyThemeColor, setCompanyThemeColor] = useState("#2F6BFF");
  const [companyLogoPath, setCompanyLogoPath] = useState("");
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
  const isProjectDetailsRoute = useMemo(() => /^\/projects\/[^/]+/.test(String(pathname || "")), [pathname]);
  const [isDesktopViewport, setIsDesktopViewport] = useState(false);
  useEffect(() => {
    if (typeof window === "undefined") return;
    const query = window.matchMedia("(min-width: 1024px)");
    setIsDesktopViewport(query.matches);
    const onChange = (event: MediaQueryListEvent) => setIsDesktopViewport(event.matches);
    query.addEventListener("change", onChange);
    return () => query.removeEventListener("change", onChange);
  }, []);
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
      if (!assigneeUid && user?.uid) setAssigneeUid(user.uid);
    };
    void load();
  }, [showNewProject, user?.companyId, user?.uid, assigneeUid, canCreateForOthers]);

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
    if (mobileNavOpen) {
      document.body.style.overflow = "hidden";
    } else {
      document.body.style.overflow = "";
    }
    return () => {
      document.body.style.overflow = "";
    };
  }, [mobileNavOpen]);

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
      const assignedName = canCreateForOthers
        ? selectedAssignee?.name || user?.displayName || "Unassigned"
        : user?.displayName || "Unassigned";
      const assignedUid = canCreateForOthers
        ? selectedAssignee?.uid || user?.uid || ""
        : user?.uid || "";
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
      {!chromeHidden && (
      <header
        className="fixed inset-x-0 top-12 z-[80] flex h-14 items-center justify-between border-b border-[var(--panel-border)] bg-white px-3 lg:hidden"
        style={{ backgroundColor: shellPalette.panelBg, borderColor: shellPalette.border, color: shellPalette.text }}
      >
        <div className="flex items-center gap-2">
          {!effectiveHideSidebar && (
            <button
              type="button"
              onClick={() => setMobileNavOpen(true)}
              className="inline-flex h-9 w-9 items-center justify-center rounded-[8px] border text-[#334155]"
              style={{ borderColor: shellPalette.border, backgroundColor: shellPalette.panelBg, color: shellPalette.text }}
              aria-label="Open menu"
            >
              <Menu size={18} />
            </button>
          )}
        </div>
        {isProjectDetailsRoute ? (
          <>
            <div className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2">
              {canCreateProject && (
                <button
                  type="button"
                  onClick={(e) => { setNewProjectOrigin(captureGlassModalOrigin(e)); setShowNewProject(true); }}
                  className="inline-flex h-9 w-9 items-center justify-center rounded-[10px] bg-[image:var(--brand-gradient)] text-white shadow-[var(--shadow-sm)] transition hover:brightness-105"
                  aria-label="New project"
                >
                  <Plus size={20} strokeWidth={2.8} />
                </button>
              )}
            </div>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => router.push("/dashboard")}
                className="inline-flex h-9 w-9 items-center justify-center rounded-[8px] border bg-white text-[#334155]"
                style={{ borderColor: shellPalette.border, backgroundColor: shellPalette.panelBg, color: shellPalette.text }}
                aria-label="Back to projects"
                title="Back to projects"
              >
                <img
                  src="/angle-left.png"
                  alt="Back"
                  className="h-4 w-4 object-contain"
                  onError={(e) => {
                    e.currentTarget.style.display = "none";
                  }}
                />
              </button>
            </div>
          </>
        ) : (
          <>
            <div className="flex items-center gap-2">
              <div className="rounded-[8px] border border-[var(--panel-border)] bg-[var(--brand)] p-1.5 text-white">
                <Building2 size={14} />
              </div>
              <p className="text-[12px] font-bold text-[var(--text-main)]" style={{ color: shellPalette.text }}>CutSmart</p>
            </div>
            {canCreateProject && (
              <button
                type="button"
                onClick={(e) => { setNewProjectOrigin(captureGlassModalOrigin(e)); setShowNewProject(true); }}
                className="inline-flex h-9 w-9 items-center justify-center rounded-[10px] bg-[image:var(--brand-gradient)] text-white shadow-[var(--shadow-sm)] transition hover:brightness-105"
                aria-label="New project"
              >
                <Plus size={20} strokeWidth={2.8} />
              </button>
            )}
          </>
        )}
      </header>
      )}

      {!effectiveHideSidebar && mobileNavOpen && (
        <div className="fixed inset-0 z-[120] lg:hidden">
          <button
            type="button"
            className="absolute inset-0 bg-[rgba(15,23,42,0.45)]"
            onClick={() => setMobileNavOpen(false)}
            aria-label="Close menu backdrop"
          />
          <aside
            className="relative z-[121] flex h-full w-[260px] flex-col overflow-hidden border-r"
            style={{
              backgroundColor: "var(--glass-bg-strong)",
              backdropFilter: "blur(24px) saturate(180%)",
              WebkitBackdropFilter: "blur(24px) saturate(180%)",
              borderColor: "var(--glass-border)",
              boxShadow: "var(--shadow-glass)",
              color: shellPalette.text,
            }}
          >
            <div className="flex items-center justify-between border-b border-[var(--panel-border)] px-4 py-3" style={{ borderColor: shellPalette.border }}>
              <div className="flex min-h-[44px] items-center">
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
              <button
                type="button"
                onClick={() => setMobileNavOpen(false)}
                className="inline-flex h-8 w-8 items-center justify-center rounded-[8px] border text-[#475467]"
                style={{ borderColor: shellPalette.border, backgroundColor: shellPalette.panelBg, color: shellPalette.textMuted }}
                aria-label="Close menu"
              >
                <X size={15} />
              </button>
            </div>

            <div className="flex min-h-0 h-full flex-1 flex-col px-3 pb-3 pt-3">
              {canCreateProject && (
                <button
                  type="button"
                  onClick={(e) => {
                    setNewProjectOrigin(captureGlassModalOrigin(e));
                    setShowNewProject(true);
                    setMobileNavOpen(false);
                  }}
                  className="mb-3 flex h-10 w-full shrink-0 items-center justify-center gap-2 rounded-[10px] bg-[image:var(--brand-gradient)] text-[13px] font-semibold text-white shadow-[var(--shadow-sm)] transition hover:brightness-105"
                >
                  <PlusCircle size={16} />
                  New Project
                </button>
              )}
              <div className="min-h-0 flex-1 space-y-0.5 overflow-y-auto pr-1">
                {visibleTopNav.map((item) => {
                  const active = pathname?.startsWith(item.href);
                  const Icon = item.icon;
                  return (
                    <Link
                      key={item.href}
                      href={item.href}
                      className={cn(
                        "flex items-center gap-2.5 rounded-[10px] px-3 py-2.5 text-[13px] font-semibold transition",
                        active ? "bg-[var(--brand-soft)]" : "hover:bg-[var(--panel-muted)]",
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

              <div className="shrink-0 space-y-0.5 border-t border-[var(--panel-border)] pt-3" style={{ borderColor: shellPalette.border }}>
                {bottomNav.map((item) => {
                  const active = pathname?.startsWith(item.href);
                  const Icon = item.icon;
                  return (
                    <Link
                      key={item.href}
                      href={item.href}
                      className={cn(
                        "flex items-center gap-2.5 rounded-[10px] px-3 py-2.5 text-[13px] font-semibold transition",
                        active ? "bg-[var(--brand-soft)]" : "hover:bg-[var(--panel-muted)]",
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
                <div className="mt-1 flex items-center gap-2 rounded-[10px] px-2 py-2 transition hover:bg-[var(--panel-muted)]">
                  <div
                    className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-[11px] font-extrabold text-white"
                    style={{ backgroundColor: userEmblemColor }}
                  >
                    {userInitials}
                  </div>
                  <div className="min-w-0 flex-1">
                    <span className="block truncate text-[12px] font-semibold" style={{ color: shellPalette.text }}>{user?.displayName || "CutSmart User"}</span>
                    {isDemoMode && (
                      <span className="block truncate text-[10px] font-semibold" style={{ color: "#B7791F" }}>Demo data mode</span>
                    )}
                  </div>
                  <button
                    type="button"
                    onClick={(e) => { setLogoutConfirmOrigin(captureGlassModalOrigin(e)); setShowLogoutConfirm(true); }}
                    className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-[8px] transition hover:bg-[var(--panel-border)]"
                    style={{ color: shellPalette.textMuted }}
                    aria-label="Log out"
                    title="Log out"
                  >
                    <LogOut size={14} />
                  </button>
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
              onClick={(e) => { setNewProjectOrigin(captureGlassModalOrigin(e)); setShowNewProject(true); }}
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
            className="absolute inset-x-0 bottom-0 overflow-hidden"
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
                <div className="flex items-center gap-2 rounded-[10px] px-2 py-2 transition hover:bg-[var(--panel-muted)]">
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
                  <button
                    type="button"
                    onClick={openUserSettingsPanel}
                    className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-[8px] transition hover:bg-[var(--panel-border)]"
                    style={{ color: shellPalette.textMuted }}
                    aria-label="User Settings"
                    title="User Settings"
                  >
                    <Settings size={16} />
                  </button>
                  <button
                    type="button"
                    onClick={(e) => { setLogoutConfirmOrigin(captureGlassModalOrigin(e)); setShowLogoutConfirm(true); }}
                    className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-[8px] transition hover:bg-[var(--panel-border)]"
                    style={{ color: shellPalette.textMuted }}
                    aria-label="Log out"
                    title="Log out"
                  >
                    <LogOut size={14} />
                  </button>
                </div>
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
                <SidebarUserSettingsPanel isOpen={isUserSettingsPanelOpen} onRequestClose={closeUserSettingsPanel} />
              </div>
            </div>
          </div>
        </div>

        <VerifyAccountModal
          open={isAutoVerifyModalOpen}
          onClose={() => setIsAutoVerifyModalOpen(false)}
        />
      </aside>

      <div
        className={chromeHidden ? "min-w-0" : "min-w-0 pt-[104px] lg:pt-12"}
        style={{
          width: "100%",
          paddingLeft: 0,
          overflowX: "visible",
          overflowY: "visible",
        }}
      >
        <main
          className={
            chromeHidden
              ? "min-h-0 min-w-0 overscroll-y-contain"
              : "min-h-0 min-w-0 overscroll-y-contain px-3 py-3 md:px-4 md:py-4 lg:px-5 lg:py-4"
          }
          style={{
            height: chromeHidden
              ? "100dvh"
              : isDesktopViewport
                ? fillMainViewport
                  ? "calc(100dvh - 48px)" // matches this wrapper's own lg:pt-12
                  : "auto"
                : "calc(100dvh - 104px)",
            overflowX: isDesktopViewport ? "visible" : "clip",
            overflowY: isDesktopViewport ? "visible" : "auto",
            paddingLeft: chromeHidden ? 0 : "max(12px, env(safe-area-inset-left))",
            paddingRight: chromeHidden ? 0 : "max(12px, env(safe-area-inset-right))",
            paddingBottom: chromeHidden || isDesktopViewport ? 0 : "max(12px, env(safe-area-inset-bottom))",
            marginLeft: "0",
            WebkitOverflowScrolling: "touch",
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
          className="fixed inset-0 z-[8900] flex items-center justify-center px-4"
          style={{
            backgroundColor: "rgba(8,12,20,0.52)",
            backdropFilter: "blur(6px)",
            WebkitBackdropFilter: "blur(6px)",
          }}
        >
          <div
            className="relative flex w-[min(860px,calc(100vw-20px))] max-h-[min(80vh,720px)] flex-col overflow-hidden rounded-[16px] border text-[var(--text-main)]"
            style={{
              backgroundColor: "var(--glass-bg-strong)",
              backdropFilter: "blur(28px) saturate(180%)",
              WebkitBackdropFilter: "blur(28px) saturate(180%)",
              borderColor: "var(--glass-border)",
              boxShadow: "var(--shadow-modal)",
            }}
          >
            <div className="flex h-[56px] shrink-0 items-center justify-between border-b border-[var(--panel-border)] bg-[var(--panel-muted)] px-4">
              <p className="text-[17px] font-semibold text-[var(--text-main)]">
                Updated to {updateNoticeVersion || "Unknown Version"}
              </p>
              <button
                type="button"
                onClick={dismissUpdateNotice}
                className="h-8 rounded-[9px] bg-[image:var(--brand-gradient)] px-3 text-[12px] font-semibold text-white transition hover:brightness-105"
              >
                OK
              </button>
            </div>
            <div className="min-h-0 flex-1 overflow-auto px-4 py-4">
              <div
                className="text-[15px] leading-7 text-[var(--text-main)]"
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
