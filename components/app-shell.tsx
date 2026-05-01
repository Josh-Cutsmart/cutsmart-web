"use client";

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { doc, serverTimestamp, setDoc } from "firebase/firestore";
import { getDownloadURL, ref as storageRef, uploadBytes } from "firebase/storage";
import {
  Building2,
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
  UserCog,
  Waves,
  X,
} from "lucide-react";
import { useAuth } from "@/lib/auth-context";
import {
  cleanupCompletedReportsForNewVersion,
  fetchCompanyDoc,
  fetchCompanyMembers,
  fetchUserUpdateNoticeSeenVersions,
  markUserUpdateNoticeSeen,
  resyncCompanyProjectTagUsage,
  saveCompanyDocPatchDetailed,
} from "@/lib/firestore-data";
import { db, hasFirebaseConfig, storage } from "@/lib/firebase";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { QuoteDocumentEditor } from "@/components/quote-document-editor";
import { fetchCompanyAccess, fetchPrimaryMembership } from "@/lib/membership";
import { applyThemeMode, readThemeMode, THEME_MODE_UPDATED_EVENT, type ThemeMode } from "@/lib/theme-mode";
import { normalizeChangelogHistory, parseUpdateNotesText, updateNotesToDisplayHtml } from "@/lib/update-notes-utils";
const ACTIVE_COMPANY_STORAGE_KEY = "cutsmart_active_company_id";
const COMPANY_BRANDING_CACHE_KEY_PREFIX = "cutsmart_company_branding_";
const UPDATE_NOTICE_SEEN_STORAGE_KEY_PREFIX = "cutsmart_update_notice_seen_";

type CompanyBrandingCache = {
  themeColor: string;
  logoPath: string;
  name: string;
};

const brandingMemoryCacheByCompany: Record<string, CompanyBrandingCache> = {};

const topNav = [
  { href: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
  { href: "/leads", label: "Leads", icon: Inbox },
  { href: "/recently-deleted", label: "Recently Deleted", icon: Trash2 },
  { href: "/company-updates", label: "Company Updates", icon: Waves },
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
    return normalized === "company.*" || normalized === target;
  });
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

type LocalPhoto = { id: string; file: File; previewUrl: string; aspectRatio: number };
type StaffOption = { uid: string; name: string; email: string };
type PreviewRect = { left: number; top: number; width: number; height: number };
type PreviewAnimState = {
  id: string;
  phase: "opening" | "open" | "closing";
  from: PreviewRect;
  to: PreviewRect;
};

export function AppShell({ children, hideSidebar = false }: { children: React.ReactNode; hideSidebar?: boolean }) {
  const pathname = usePathname();
  const router = useRouter();
  const { user, logout, isDemoMode } = useAuth();
  const [showNewProject, setShowNewProject] = useState(false);
  const [projectName, setProjectName] = useState("");
  const [clientName, setClientName] = useState("");
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
  const [showUpdateNotice, setShowUpdateNotice] = useState(false);
  const [updateNoticeVersion, setUpdateNoticeVersion] = useState("");
  const [updateNoticeText, setUpdateNoticeText] = useState("");
  const [companyThemeColor, setCompanyThemeColor] = useState("#2F6BFF");
  const [companyLogoPath, setCompanyLogoPath] = useState("");
  const [companyDisplayName, setCompanyDisplayName] = useState("");
  const [companyTagSuggestions, setCompanyTagSuggestions] = useState<string[]>([]);
  const [defaultProjectStatus, setDefaultProjectStatus] = useState("New");
  const [defaultQuoteExtras, setDefaultQuoteExtras] = useState<string[]>([]);
  const [effectiveCompanyRole, setEffectiveCompanyRole] = useState("");
  const [effectiveCompanyPermissions, setEffectiveCompanyPermissions] = useState<string[]>([]);
  const [themeMode, setThemeMode] = useState<ThemeMode>("light");
  const photoThumbRefs = useRef<Record<string, HTMLButtonElement | null>>({});
  const previewPanelRef = useRef<HTMLDivElement | null>(null);
  const previewTimerRef = useRef<number | null>(null);
  const previewCloseRafRef = useRef<number | null>(null);
  const newProjectTagInputRef = useRef<HTMLInputElement | null>(null);

  const userInitials = useMemo(() => initials(user?.displayName || "User"), [user?.displayName]);
  const userEmblemColor = String(user?.userColor || "").trim() || companyThemeColor;
  const isProjectDetailsRoute = useMemo(() => /^\/projects\/[^/]+/.test(String(pathname || "")), [pathname]);
  const normalizedEffectivePermissions = useMemo(
    () => effectiveCompanyPermissions.map((item) => String(item || "").trim().toLowerCase()),
    [effectiveCompanyPermissions],
  );

  const roleForUi = String(effectiveCompanyRole || user?.role || "").trim().toLowerCase();

  const canCreateForOthers = useMemo(() => {
    const perms = normalizedEffectivePermissions;
    const role = roleForUi;
    if (role === "owner" || role === "admin") return true;
    return perms.includes("projects.create.others");
  }, [normalizedEffectivePermissions, roleForUi]);

  const canCreateProject = useMemo(() => {
    const perms = normalizedEffectivePermissions;
    const role = roleForUi;
    if (role === "owner" || role === "admin") return true;
    return perms.includes("projects.create") || perms.includes("projects.create.others");
  }, [normalizedEffectivePermissions, roleForUi]);

  const canAccessCompanySettings = useMemo(() => {
    const role = roleForUi;
    if (role === "owner" || role === "admin") return true;
    return normalizedEffectivePermissions.includes("company.settings");
  }, [normalizedEffectivePermissions, roleForUi]);

  const canAccessDashboard = useMemo(() => {
    const role = roleForUi;
    if (role === "owner" || role === "admin") return true;
    return normalizedEffectivePermissions.includes("company.dashboard.view");
  }, [normalizedEffectivePermissions, roleForUi]);

  const visibleTopNav = useMemo(
    () =>
      topNav.filter((item) => {
        if (item.href === "/dashboard") {
          return canAccessDashboard;
        }
        if (item.href === "/leads") {
          return canAccessDashboard;
        }
        if (item.href === "/company-settings") {
          return canAccessCompanySettings;
        }
        return true;
      }),
    [canAccessCompanySettings, canAccessDashboard],
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
        return;
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
        return;
      }
      const doc = await fetchCompanyDoc(companyId);
      const color = String((doc as Record<string, unknown> | null)?.themeColor ?? "").trim();
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
        if (version && companyId) {
          const companyDocData = await fetchCompanyDoc(companyId);
          const existing = normalizeChangelogHistory((companyDocData as Record<string, unknown> | null)?.changelogHistory);
          const matched = existing.find(
            (row) => String(row.version || "").trim().toLowerCase() === version.toLowerCase(),
          );
          const canonicalWhatsNew = String(matched?.whatsNew || whatsNew || "").trim();
          setUpdateNoticeText(canonicalWhatsNew);
          const alreadyExists = Boolean(matched);
          if (!alreadyExists) {
            const nextHistory = [
              ...existing,
              {
                version,
                whatsNew: canonicalWhatsNew,
                capturedAtIso: new Date().toISOString(),
              },
            ];
            await saveCompanyDocPatchDetailed(companyId, { changelogHistory: nextHistory });
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
      const fallbackMembership = !directCompanyId && user?.uid ? await fetchPrimaryMembership(user.uid) : null;
      const companyId = storedCompanyId || directCompanyId || String(fallbackMembership?.companyId || "").trim();
      if (!user?.uid || !companyId) {
        if (!cancelled) {
          setEffectiveCompanyRole(String(user?.role || "").trim().toLowerCase());
          setEffectiveCompanyPermissions(Array.isArray(user?.permissions) ? user.permissions : []);
        }
        return;
      }
      const companyAccess = await fetchCompanyAccess(companyId, user.uid);
      if (cancelled) return;
      setEffectiveCompanyRole(String(companyAccess?.role || user?.role || "").trim().toLowerCase());
      setEffectiveCompanyPermissions(companyAccess?.permissionKeys ?? (Array.isArray(user?.permissions) ? user.permissions : []));
    };
    void loadCompanyAccess();
    return () => {
      cancelled = true;
    };
  }, [user?.companyId, user?.permissions, user?.role, user?.uid]);

  useEffect(() => {
    const openNewProject = () => {
      if (!canCreateProject) {
        return;
      }
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

      if (canCreateForOthers) {
        const options = members.map((m) => ({
          uid: String(m.uid || "").trim(),
          name: String(m.displayName || m.email || m.uid || "Unknown").trim(),
          email: String(m.email || "").trim(),
        }));
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
    setMobileNavOpen(false);
  }, [pathname]);

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

  const resetProjectForm = () => {
    for (const photo of photos) {
      try {
        URL.revokeObjectURL(photo.previewUrl);
      } catch {
        // ignore
      }
    }
    setProjectName("");
    setClientName("");
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
        } as LocalPhoto;
      }),
    );
    setPhotos((prev) => {
      const room = Math.max(0, 5 - prev.length);
      return [...prev, ...prepared.slice(0, room)];
    });
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

  const selectedAssignee = useMemo(() => {
    return staffOptions.find((s) => s.uid === assigneeUid) ?? null;
  }, [staffOptions, assigneeUid]);

  const filteredStaffOptions = useMemo(() => {
    const q = String(assigneeSearch || "").trim().toLowerCase();
    if (!q) return staffOptions;
    return staffOptions.filter((s) => `${s.name} ${s.email}`.toLowerCase().includes(q));
  }, [staffOptions, assigneeSearch]);

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
    const name = String(projectName || "").trim();
    const customer = String(clientName || "").trim();
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
        const uploaded = await Promise.all(
          photos.map(async (p, idx) => {
            try {
              const ext = p.file.name.includes(".") ? p.file.name.split(".").pop() : "jpg";
              const path = `companies/${companyId}/jobs/${projectId}/images/${idx + 1}_${Date.now()}.${ext}`;
              const ref = storageRef(storageClient, path);
              await uploadBytes(ref, p.file, { contentType: p.file.type || "image/jpeg" });
              return await getDownloadURL(ref);
            } catch {
              return "";
            }
          }),
        );
        uploadedImageUrls = uploaded.filter(Boolean);
      }
      const projectSettings = {
        boardTypes: [],
        projectPermissions: {},
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
        projectImages: uploadedImageUrls,
        cutlist: { rows: [] },
        cutlistJson: { rows: [] },
        projectSettings,
        projectSettingsJson: JSON.stringify(projectSettings),
        sales,
        salesJson: JSON.stringify(sales),
      });
      if (tags.length > 0) {
        await resyncCompanyProjectTagUsage(companyId);
      }
      setShowNewProject(false);
      resetProjectForm();
      router.push(`/projects/${projectId}`);
    } catch (error) {
      const message =
        error && typeof error === "object" && "code" in error
          ? String((error as { code?: unknown }).code || "create-failed")
          : String((error as { message?: unknown } | null)?.message || "Could not create project.");
      setProjectFormError(`Could not create project (${message}).`);
    } finally {
      setCreatingProject(false);
    }
  };

  const modalRowClass =
    "grid items-start gap-2 md:gap-3 [grid-template-columns:minmax(0,1fr)] md:[grid-template-columns:220px_minmax(0,1fr)]";
  const modalLabelClass = "text-[11px] font-bold text-[#475467]";
  const modalSectionLabelClass = "pt-1 md:pt-2 text-[11px] font-bold text-[#475467]";
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

  return (
    <div className="min-h-screen bg-[var(--bg-app)]" data-theme-mode={themeMode} style={{ backgroundColor: shellPalette.appBg, color: shellPalette.text }}>
      <header
        className="fixed inset-x-0 top-0 z-[80] flex h-14 items-center justify-between border-b border-[var(--panel-border)] bg-white px-3 lg:hidden"
        style={{ backgroundColor: shellPalette.panelBg, borderColor: shellPalette.border, color: shellPalette.text }}
      >
        <div className="flex items-center gap-2">
          {!hideSidebar && (
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
          {isProjectDetailsRoute && (
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
          )}
        </div>
        <div className="flex items-center gap-2">
          <div className="rounded-[8px] border border-[var(--panel-border)] bg-[var(--brand)] p-1.5 text-white">
            <Building2 size={14} />
          </div>
          <p className="text-[12px] font-bold text-[var(--text-main)]" style={{ color: shellPalette.text }}>CutSmart</p>
        </div>
        {canCreateProject && (
          <button
            type="button"
            onClick={() => setShowNewProject(true)}
            className="inline-flex h-9 w-9 items-center justify-center rounded-[8px] border border-[#159947] bg-[#22C55E] text-white hover:bg-[#16A34A]"
            aria-label="New project"
          >
            <Plus size={20} strokeWidth={2.8} />
          </button>
        )}
      </header>

      {!hideSidebar && mobileNavOpen && (
        <div className="fixed inset-0 z-[120] lg:hidden">
          <button
            type="button"
            className="absolute inset-0 bg-[rgba(15,23,42,0.45)]"
            onClick={() => setMobileNavOpen(false)}
            aria-label="Close menu backdrop"
          />
          <aside className="relative z-[121] flex h-full w-[260px] flex-col overflow-hidden border-r border-[var(--panel-border)] bg-white" style={{ backgroundColor: shellPalette.panelBg, borderColor: shellPalette.border, color: shellPalette.text }}>
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

            <div className="flex min-h-0 h-full flex-1 flex-col px-3 py-3">
              <div className="min-h-0 flex-1 space-y-1 overflow-y-auto pr-1">
                {canCreateProject && (
                  <button
                    type="button"
                    onClick={() => {
                      setShowNewProject(true);
                      setMobileNavOpen(false);
                    }}
                    className="flex w-full items-center gap-2 rounded-[10px] border border-transparent px-3 py-2 text-left text-[13px] font-bold transition"
                    style={{ color: shellPalette.textMuted }}
                  >
                    <PlusCircle size={16} />
                    New Project
                  </button>
                )}
                {visibleTopNav.map((item) => {
                  const active = pathname?.startsWith(item.href);
                  const Icon = item.icon;
                  return (
                    <Link
                      key={item.href}
                      href={item.href}
                      className={cn(
                        "flex items-center gap-2 rounded-[10px] border px-3 py-2 text-[13px] font-bold transition",
                        active
                          ? "border-[var(--panel-border)] bg-[var(--panel-muted)]"
                          : "border-transparent",
                      )}
                      style={{
                        borderColor: active ? shellPalette.border : "transparent",
                        backgroundColor: active ? shellPalette.panelMuted : "transparent",
                        color: shellPalette.textMuted,
                      }}
                    >
                      <Icon size={16} />
                      {item.label}
                    </Link>
                  );
                })}
              </div>

              <div className="shrink-0 space-y-1 border-t border-[var(--panel-border)] pt-3" style={{ borderColor: shellPalette.border }}>
                {bottomNav.map((item) => {
                  const active = pathname?.startsWith(item.href);
                  const Icon = item.icon;
                  return (
                    <Link
                      key={item.href}
                      href={item.href}
                      className={cn(
                        "flex items-center gap-2 rounded-[10px] border px-3 py-2 text-[13px] font-bold transition",
                        active
                          ? "border-[var(--panel-border)] bg-[var(--panel-muted)]"
                          : "border-transparent",
                      )}
                      style={{
                        borderColor: active ? shellPalette.border : "transparent",
                        backgroundColor: active ? shellPalette.panelMuted : "transparent",
                        color: shellPalette.textMuted,
                      }}
                    >
                      <Icon size={16} />
                      {item.label}
                    </Link>
                  );
                })}
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-8 w-full justify-start text-[13px] font-bold"
                  style={{ color: shellPalette.textMuted }}
                  onClick={() => void logout()}
                >
                  <LogOut size={14} className="mr-2" />
                  Log Out
                </Button>
                <div className="mt-2 flex items-center gap-2 rounded-[10px] border px-2 py-2" style={{ borderColor: shellPalette.border, backgroundColor: shellPalette.panelMuted }}>
                  <div
                    className="inline-flex h-7 w-7 items-center justify-center rounded-full text-[11px] font-extrabold text-white"
                    style={{ backgroundColor: userEmblemColor }}
                  >
                    {userInitials}
                  </div>
                  <span className="truncate text-[12px] font-semibold" style={{ color: shellPalette.text }}>{user?.displayName || "CutSmart User"}</span>
                </div>
              </div>
            </div>
          </aside>
        </div>
      )}

      {!hideSidebar && (
      <aside
        className="z-[70] hidden w-[230px] flex-col overflow-hidden border-r border-[var(--panel-border)] bg-white lg:flex"
        style={{ position: "fixed", left: 0, top: 0, height: "100vh", backgroundColor: shellPalette.panelBg, borderColor: shellPalette.border, color: shellPalette.text }}
      >
        <div className="border-b border-[var(--panel-border)] px-4 py-3" style={{ borderColor: shellPalette.border }}>
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
        </div>

        <div className="flex min-h-0 h-full flex-1 flex-col px-3 py-3">
          <div className="min-h-0 flex-1 space-y-1 overflow-y-auto pr-1">
            {canCreateProject && (
              <button
                type="button"
                onClick={() => setShowNewProject(true)}
                className="flex w-full items-center gap-2 rounded-[10px] border border-transparent px-3 py-2 text-left text-[13px] font-bold transition"
                style={{ color: shellPalette.textMuted }}
              >
                <PlusCircle size={16} />
                New Project
              </button>
            )}
            {visibleTopNav.map((item) => {
              const active = pathname?.startsWith(item.href);
              const Icon = item.icon;
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  className={cn(
                    "flex items-center gap-2 rounded-[10px] border px-3 py-2 text-[13px] font-bold transition",
                    active
                      ? "border-[var(--panel-border)] bg-[var(--panel-muted)]"
                      : "border-transparent",
                  )}
                  style={{
                    borderColor: active ? shellPalette.border : "transparent",
                    backgroundColor: active ? shellPalette.panelMuted : "transparent",
                    color: shellPalette.textMuted,
                  }}
                >
                  <Icon size={16} />
                  {item.label}
                </Link>
              );
            })}
          </div>

          <div className="shrink-0 space-y-1 border-t border-[var(--panel-border)] pt-3" style={{ borderColor: shellPalette.border }}>
            {bottomNav.map((item) => {
              const active = pathname?.startsWith(item.href);
              const Icon = item.icon;
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  className={cn(
                    "flex items-center gap-2 rounded-[10px] border px-3 py-2 text-[13px] font-bold transition",
                    active
                      ? "border-[var(--panel-border)] bg-[var(--panel-muted)]"
                      : "border-transparent",
                  )}
                  style={{
                    borderColor: active ? shellPalette.border : "transparent",
                    backgroundColor: active ? shellPalette.panelMuted : "transparent",
                    color: shellPalette.textMuted,
                  }}
                >
                  <Icon size={16} />
                  {item.label}
                </Link>
              );
            })}
            <Button
              variant="ghost"
              size="sm"
              className="h-8 w-full justify-start text-[13px] font-bold"
              style={{ color: shellPalette.textMuted }}
              onClick={() => void logout()}
            >
              <LogOut size={14} className="mr-2" />
              Log Out
            </Button>
            <div className="mt-2 flex items-center gap-2 rounded-[10px] border px-2 py-2" style={{ borderColor: shellPalette.border, backgroundColor: shellPalette.panelMuted }}>
              <div
                className="inline-flex h-7 w-7 items-center justify-center rounded-full text-[11px] font-extrabold text-white"
                style={{ backgroundColor: userEmblemColor }}
              >
                {userInitials}
              </div>
              <span className="truncate text-[12px] font-semibold" style={{ color: shellPalette.text }}>{user?.displayName || "CutSmart User"}</span>
            </div>
            {isDemoMode && (
              <span className="inline-flex rounded-[8px] border border-[#F1D46A] bg-[#FFF7CC] px-2 py-1 text-[11px] font-bold text-[#7A5A00]">
                Demo data mode
              </span>
            )}
          </div>
        </div>
      </aside>
      )}

      <div
        className="min-w-0 overflow-x-hidden pt-14 lg:pt-0"
        style={{ width: "100%", paddingLeft: 0 }}
      >
        <main className="min-w-0 overflow-x-clip px-3 py-3 md:px-4 md:py-4 lg:px-5 lg:py-4" style={{ paddingLeft: "max(12px, env(safe-area-inset-left))", paddingRight: "max(12px, env(safe-area-inset-right))", marginLeft: "0" }}>
          <div className={hideSidebar ? "" : "lg:ml-[230px]"}>{children}</div>
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
          <div className="relative flex w-[min(860px,calc(100vw-20px))] max-h-[min(80vh,720px)] flex-col overflow-hidden rounded-[14px] border border-[#D7DEE8] bg-white shadow-xl text-black">
            <div className="flex h-[50px] shrink-0 items-center justify-between border-b border-[#D7DEE8] bg-[#F8FAFC] px-3">
              <p className="text-[20px] font-medium uppercase tracking-[1px] text-black">
                Updated to {updateNoticeVersion || "Unknown Version"}
              </p>
              <button
                type="button"
                onClick={dismissUpdateNotice}
                className="h-8 rounded-[9px] border border-[#C8DAFF] bg-[#EAF1FF] px-3 text-[12px] font-bold text-[#24589A] hover:bg-[#DFE9FF]"
              >
                OK
              </button>
            </div>
            <div className="min-h-0 flex-1 overflow-auto px-4 py-4">
              <div
                className="text-[15px] leading-7 text-black"
                dangerouslySetInnerHTML={{
                  __html: updateNotesToDisplayHtml(updateNoticeText || "- No update notes provided."),
                }}
              />
            </div>
          </div>
        </div>
      )}

      {showNewProject && (
        <div
          className="fixed inset-0 z-[9000] flex items-center justify-center px-4"
          style={{
            backgroundColor: "rgba(8,12,20,0.52)",
            backdropFilter: "blur(6px)",
            WebkitBackdropFilter: "blur(6px)",
          }}
        >
          <div
            className="relative flex flex-col overflow-hidden rounded-[14px] border border-[#D7DEE8] bg-white p-3 shadow-xl sm:p-4"
            style={{ width: "min(1000px, calc(100vw - 16px))", height: "min(600px, calc(100vh - 16px))" }}
          >
            <p className="text-[15px] font-extrabold uppercase tracking-[1px] text-[#12345B]">New Project</p>
            <div className="relative mt-3 flex-1 space-y-3 overflow-y-auto pr-0 sm:pr-1">
              <div className={modalRowClass}>
                <p className={modalLabelClass}>Project Name</p>
                <input
                  value={projectName}
                  onChange={(e) => setProjectName(e.target.value)}
                  className="h-9 w-full rounded-[8px] border border-[#D8DEE8] bg-white px-2 text-[12px]"
                  placeholder="Project name"
                />
              </div>
              <div className={modalRowClass}>
                <p className={modalLabelClass}>Client Name</p>
                <input
                  value={clientName}
                  onChange={(e) => setClientName(e.target.value)}
                  className="h-9 w-full rounded-[8px] border border-[#D8DEE8] bg-white px-2 text-[12px]"
                  placeholder="Client name"
                />
              </div>
              <div className={modalRowClass}>
                <p className={modalLabelClass}>Client Phone</p>
                <input
                  value={clientPhone}
                  onChange={(e) => setClientPhone(formatMobileLikeDesktop(e.target.value))}
                  className="h-9 w-full rounded-[8px] border border-[#D8DEE8] bg-white px-2 text-[12px]"
                  placeholder="021 234 5678"
                />
              </div>
              <div className={modalRowClass}>
                <p className={modalLabelClass}>Client Email</p>
                <input
                  value={clientEmail}
                  onChange={(e) => setClientEmail(e.target.value)}
                  className="h-9 w-full rounded-[8px] border border-[#D8DEE8] bg-white px-2 text-[12px]"
                  placeholder="client@email.com"
                />
              </div>
              <div className={modalRowClass}>
                <p className={modalLabelClass}>Project Address</p>
                <input
                  value={projectAddress}
                  onChange={(e) => setProjectAddress(e.target.value)}
                  className="h-9 w-full rounded-[8px] border border-[#D8DEE8] bg-white px-2 text-[12px]"
                  placeholder="Street, suburb, city"
                />
              </div>
              {projectAddress.trim().length > 5 && (
                <div className={modalRowClass}>
                  <div className="hidden md:block" />
                  <div className="overflow-hidden rounded-[10px] border border-[#D8DEE8]">
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
                        className="inline-flex items-center gap-1 rounded-[8px] border border-[#D6DEE9] bg-[#EEF2F7] px-2 py-[2px] text-[12px] font-semibold text-[#7B8798] hover:bg-[#FDECEC] hover:text-[#B42318]"
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
                          className="h-7 w-[120px] rounded-[8px] border border-[#D6DEE9] bg-white px-2 text-[12px] text-[#334155] outline-none"
                          placeholder="Tag"
                        />
                        {showTagSuggestions && filteredTagSuggestions.length > 0 && (
                          <div className="absolute left-0 top-[calc(100%+2px)] z-30 max-h-[220px] w-[220px] overflow-auto rounded-[8px] border border-[#D6DEE9] bg-white p-1 shadow-[0_12px_28px_rgba(15,23,42,0.14)]">
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
                                className="block w-full rounded-[6px] px-2 py-1 text-left text-[12px] font-semibold text-[#334155] hover:bg-[#EEF2F7]"
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
                        className="inline-flex h-[22px] w-[22px] items-center justify-center rounded-[8px] border border-[#D6DEE9] bg-[#EEF2F7] text-[#64748B] hover:bg-[#E2E8F0]"
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
                  <div className="overflow-hidden rounded-[8px] border border-[#D8DEE8] bg-white px-2 py-2">
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
                          className="block min-h-[88px] w-full bg-transparent text-left text-[12px] text-[#2F3F56] outline-none"
                        >
                          {notesHtmlIsEmpty(projectNotes) ? (
                            <span className="text-[#98A2B3]">Project notes...</span>
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
                <p className={modalSectionLabelClass}>Photos (max 5)</p>
                <div
                  className="grid w-full grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-5"
                >
                  {Array.from({ length: Math.min(photos.length + 1, 5) }).map((_, idx) => {
                    const photo = photos[idx] ?? null;
                    return (
                      <div
                        key={`photo_slot_${idx}`}
                        className="relative flex items-center justify-center"
                        style={{ height: 88, minHeight: 88 }}
                        onMouseLeave={() => setHoveredPhotoId("")}
                      >
                        {photo ? (
                          <>
                            <div
                              className="relative flex h-full items-center justify-center overflow-hidden rounded-[8px] border border-[#D8DEE8] bg-transparent"
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
                            </div>
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
                          </>
                        ) : (
                          <label className="relative flex h-full w-full cursor-pointer items-center justify-center overflow-hidden rounded-[8px] border border-[#D8DEE8] bg-[#F8FAFC] text-[11px] font-bold text-[#64748B]">
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
                  <div className="relative">
                    <button
                      type="button"
                      onClick={() => setAssigneeMenuOpen((v) => !v)}
                      className="flex h-9 w-full items-center justify-between rounded-[8px] border border-[#D8DEE8] bg-white px-2 text-left text-[12px]"
                    >
                      <span className="truncate">{selectedAssignee?.name || "Select staff member"}</span>
                      <span className="text-[#64748B]">&#9662;</span>
                    </button>
                    {assigneeMenuOpen && (
                      <div className="absolute z-20 mt-1 w-full rounded-[8px] border border-[#D8DEE8] bg-white shadow-lg">
                        <div className="relative border-b border-[#E2E8F0] px-2 py-2">
                          <Search size={13} className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-[#94A3B8]" />
                          <input
                            value={assigneeSearch}
                            onChange={(e) => setAssigneeSearch(e.target.value)}
                            className="h-8 w-full rounded-[7px] border border-[#D8DEE8] bg-white pl-7 pr-2 text-[12px]"
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
                              className="block w-full px-2 py-2 text-left text-[12px] hover:bg-[#F1F5F9]"
                            >
                              <p className="font-semibold text-[#0F172A]">{s.name}</p>
                              <p className="text-[11px] text-[#64748B]">{s.email}</p>
                            </button>
                          ))}
                          {!filteredStaffOptions.length && (
                            <div className="px-2 py-2 text-[12px] text-[#64748B]">No staff found.</div>
                          )}
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              )}
              {!!projectFormError && (
                <p className="text-[12px] font-semibold text-[#B42318]">{projectFormError}</p>
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
            <div className="mt-4 flex flex-col-reverse items-stretch justify-end gap-2 sm:flex-row sm:items-center">
              <button
                type="button"
                onClick={() => {
                  setShowNewProject(false);
                  resetProjectForm();
                }}
                className="h-9 rounded-[9px] border border-[#D8DEE8] bg-white px-3 text-[12px] font-bold text-[#334155] sm:w-auto"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={creatingProject}
                onClick={() => void onCreateProject()}
                className="h-9 rounded-[9px] border border-[#C8DAFF] bg-[#EAF1FF] px-3 text-[12px] font-bold text-[#24589A] disabled:opacity-55 sm:w-auto"
              >
                {creatingProject ? "Creating..." : "Create Project"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
