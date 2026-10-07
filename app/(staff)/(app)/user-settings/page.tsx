"use client";

import { useEffect, useLayoutEffect, useMemo, useRef, useState, type MouseEvent as ReactMouseEvent, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { useRouter } from "next/navigation";
import {
  BadgeCheck,
  Bell,
  Building2,
  Check,
  ChevronLeft,
  ChevronRight,
  ClipboardList,
  Download,
  HelpCircle,
  LayoutDashboard,
  Lock,
  Mail,
  MailCheck,
  Moon,
  Palette,
  PanelTop,
  Pencil,
  Plus,
  Search,
  Share,
  SlidersHorizontal,
  Smartphone,
  Timer,
  Trash2,
  UserCog,
  UserRound,
  X,
  type LucideIcon,
} from "lucide-react";
import { useAuth } from "@/lib/auth-context";
import { useAppTabs } from "@/lib/app-tabs-context";
import { isIosDevice, promptPwaInstall, usePwaInstall } from "@/lib/pwa-install";
import { auth } from "@/lib/firebase";
import {
  deleteChecklistTemplate,
  fetchChecklistTemplates,
  fetchCompanyDoc,
  fetchProjects,
  saveChecklistTemplate,
  saveUserProfilePatchDetailed,
} from "@/lib/firestore-data";
import { fetchCompanyAccess, fetchPrimaryMembership } from "@/lib/membership";
import { hedgedAsync } from "@/lib/load-retry";
import { readThemeMode, saveThemeMode, type ThemeMode } from "@/lib/theme-mode";
import {
  readDashboardStatCardsEnabled,
  readMobileTopBarEnabled,
  readSidebarResizeLockEnabled,
  saveDashboardStatCardsEnabled,
  saveMobileTopBarEnabled,
  saveSidebarResizeLockEnabled,
} from "@/lib/ui-preferences";
import type { ChecklistTemplate } from "@/lib/types";
import { dispatchUserColorUpdated } from "@/lib/user-color-sync";
import { contrastTextForFill, labelFromRoleKey, normalizeRoleKey } from "@/lib/user-profile-format";
import { SidebarColorPickerPopover, type ColorPickerAnchorRect } from "@/components/sidebar-color-picker-popover";
import { captureGlassModalOrigin, useGlassModalPopOrigin, type GlassModalOrigin } from "@/lib/use-glass-modal-pop-origin";
import { PUSH_CATEGORY_ICONS, PushNotificationSettings } from "@/components/push-notification-settings";
import { iconRemoveButtonClass } from "@/components/settings-ui";
import { PUSH_NOTIFICATION_CATEGORIES } from "@/lib/push-notification-types";
import { SlideOverPane, useIsPhone, useSlideOverPage } from "@/components/slide-over-page";

function newChecklistLocalId(prefix: string) {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

// Same pill-switch look as the cutlist editor's own toggles (e.g. Top Scribers, Grain).
function SettingsToggleSwitch({
  checked,
  onChange,
  disabled,
}: {
  checked: boolean;
  onChange: (checked: boolean) => void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className="relative inline-flex h-5 w-9 shrink-0 items-center rounded-full border transition-colors disabled:opacity-50"
      style={{
        borderColor: checked ? "var(--brand-strong)" : "var(--glass-border)",
        backgroundColor: checked ? "var(--brand-strong)" : "var(--panel-muted)",
      }}
    >
      <span
        className="inline-block h-3.5 w-3.5 rounded-full shadow transition-transform"
        style={{ backgroundColor: "#FFFFFF", transform: checked ? "translateX(18px)" : "translateX(2px)" }}
      />
    </button>
  );
}

// Phone: every page here is cards of rows — an icon, a name (and a line under it), then its value or
// control on the right.
const MOBILE_ROWS_CARD_CLASS = "divide-y divide-[var(--glass-border)] overflow-hidden rounded-[18px] border";
const MOBILE_ROW_CLASS = "flex min-h-[52px] w-full items-center gap-3 px-4 py-2.5 text-left";

function MobileSettingsRow({
  icon: Icon,
  label,
  detail,
  accent,
  onClick,
  children,
}: {
  icon: LucideIcon;
  label: string;
  detail?: ReactNode;
  // In the brand colour (e.g. Create Checklist).
  accent?: boolean;
  onClick?: (event: ReactMouseEvent<HTMLButtonElement>) => void;
  children?: ReactNode;
}) {
  const tone = accent ? "var(--brand-strong)" : "";
  const content = (
    <>
      <Icon size={17} className="shrink-0" style={{ color: tone || "var(--text-muted)" }} />
      <div className="min-w-0 flex-1">
        <p className="truncate text-[14px] font-medium" style={{ color: tone || "var(--text-main)" }}>{label}</p>
        {detail ? <p className="mt-0.5 text-[11px] leading-snug" style={{ color: "var(--text-muted)" }}>{detail}</p> : null}
      </div>
      {children}
    </>
  );
  return onClick ? (
    <button type="button" onClick={onClick} className={`${MOBILE_ROW_CLASS} transition active:bg-[var(--panel-muted)]`}>
      {content}
    </button>
  ) : (
    <div className={MOBILE_ROW_CLASS}>{content}</div>
  );
}

// Phone: the page's sections, each opening as its own page.
const USER_SETTINGS_SECTIONS = [
  { id: "general", label: "General", icon: UserRound },
  { id: "preferences", label: "Preferences", icon: SlidersHorizontal },
  { id: "notifications", label: "Notifications", icon: Bell },
  { id: "checklists", label: "Checklists", icon: ClipboardList },
] as const;

const ACTIVE_COMPANY_STORAGE_KEY = "cutsmart_active_company_id";
const ACTIVE_COMPANY_THEME_COLOR_STORAGE_KEY = "cutsmart_active_company_theme_color";

export default function UserSettingsPage() {
  const router = useRouter();
  const { user, setUserColorLocal, setUserProfileLocal, setUserVerifiedLocal } = useAuth();
  const { setSaveAndBackHandler } = useAppTabs();
  const [companyColor, setCompanyColor] = useState("#2F6BFF");
  const [displayName, setDisplayName] = useState(user?.displayName || "");
  const [userColor, setUserColor] = useState(user?.userColor || "");
  const [mobile, setMobile] = useState(user?.mobile || "");
  const [notifyAsCreator, setNotifyAsCreator] = useState(Boolean(user?.notifyAsCreator));
  // Per-device UI toggles — localStorage-only (see lib/ui-preferences.ts), not part of the
  // account profile save/dirty tracking above.
  const [mobileTopBarEnabled, setMobileTopBarEnabled] = useState(true);
  const [dashboardStatCardsEnabled, setDashboardStatCardsEnabled] = useState(true);
  const [sidebarResizeLocked, setSidebarResizeLocked] = useState(false);
  useEffect(() => {
    setMobileTopBarEnabled(readMobileTopBarEnabled());
    setDashboardStatCardsEnabled(readDashboardStatCardsEnabled());
    setSidebarResizeLocked(readSidebarResizeLockEnabled());
  }, []);
  // "Download App" row — mobile only (per the user's own request; the underlying install prompt
  // works on desktop Chrome too, but this is specifically about replacing "visit the site and
  // bookmark it" on a phone).
  const [isCompactUserSettingsViewport, setIsCompactUserSettingsViewport] = useState(false);
  useEffect(() => {
    if (typeof window === "undefined") return;
    const mq = window.matchMedia("(max-width: 1023px)");
    setIsCompactUserSettingsViewport(mq.matches);
    const onChange = (event: MediaQueryListEvent) => setIsCompactUserSettingsViewport(event.matches);
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);
  // The page itself — on a phone it's a profile card and a list of sections, and slides away as a section
  // slides in over it (useSlideOverPage).
  const settingsPageRef = useRef<HTMLDivElement | null>(null);
  const isPhone = useIsPhone();
  const sectionSlide = useSlideOverPage(settingsPageRef, "userSettingsSection");
  // Phone: the first page's search across every setting, and what the Notifications page opens searched for.
  const [settingsSearch, setSettingsSearch] = useState("");
  const [notificationsSearch, setNotificationsSearch] = useState("");
  const openSection = (sectionId: string, notificationsQuery = "") => {
    setNotificationsSearch(notificationsQuery);
    sectionSlide.open(sectionId);
  };
  // Phone: a checklist's own page (its items), sliding in over the Checklists page.
  const checklistSlide = useSlideOverPage(sectionSlide.paneRef, "userSettingsChecklist");
  const { canInstall: pwaCanInstall, isInstalled: pwaIsInstalled } = usePwaInstall();
  const [isIosInstallHint, setIsIosInstallHint] = useState(false);
  useEffect(() => {
    setIsIosInstallHint(isIosDevice());
  }, []);
  const [pwaInstallStatusMsg, setPwaInstallStatusMsg] = useState("");
  const onClickDownloadApp = async () => {
    const outcome = await promptPwaInstall();
    if (outcome === "unavailable") {
      setPwaInstallStatusMsg("Install isn't available right now — try again after using the site a bit more.");
      window.setTimeout(() => setPwaInstallStatusMsg(""), 5000);
    }
  };
  // Shown instead of the Download App button whenever there's no native install prompt available
  // (iOS always, or Android/Chrome before it decides the site is install-eligible) — walks through
  // the manual "Add to Home Screen" steps rather than leaving people to look it up themselves.
  const [isPwaHelpOpen, setIsPwaHelpOpen] = useState(false);
  const [pwaHelpOrigin, setPwaHelpOrigin] = useState<GlassModalOrigin>(null);
  const pwaHelpPanelRef = useRef<HTMLDivElement | null>(null);
  const pwaHelpOriginElRef = useRef<HTMLElement | null>(null);
  const shouldRenderPwaHelp = useGlassModalPopOrigin(isPwaHelpOpen, pwaHelpOrigin, pwaHelpPanelRef, undefined, pwaHelpOriginElRef);
  const [isSaving, setIsSaving] = useState(false);
  const [saveMsg, setSaveMsg] = useState("");
  const [resolvedCompanyId, setResolvedCompanyId] = useState("");
  const [companyName, setCompanyName] = useState("");
  const [companyRoleLabel, setCompanyRoleLabel] = useState("");
  const [companyRoleColor, setCompanyRoleColor] = useState("");
  const [themeMode, setThemeMode] = useState<ThemeMode>("light");
  const [isColorPopoverOpen, setIsColorPopoverOpen] = useState(false);
  const [colorPopoverAnchor, setColorPopoverAnchor] = useState<ColorPickerAnchorRect | null>(null);
  const [isNameEditing, setIsNameEditing] = useState(false);
  const [nameDraft, setNameDraft] = useState("");
  const [isMobileEditing, setIsMobileEditing] = useState(false);
  const [mobileDraft, setMobileDraft] = useState("");
  const [checklistTemplates, setChecklistTemplates] = useState<ChecklistTemplate[]>([]);
  const [isChecklistEditorOpen, setIsChecklistEditorOpen] = useState(false);
  const [checklistEditorId, setChecklistEditorId] = useState("");
  const [checklistNameDraft, setChecklistNameDraft] = useState("");
  const [checklistRowsDraft, setChecklistRowsDraft] = useState<string[]>([""]);
  // Deleting a checklist with anything in it takes a second tap to confirm (its Delete shows "Delete?").
  const [confirmDeleteChecklistId, setConfirmDeleteChecklistId] = useState("");
  // Likewise removing a checklist row with something typed in it ("Remove?") — an empty one just goes. Keyed
  // by the item's id (a checklist's page) or "draft:<index>" (the checklist editor).
  const [confirmRemoveRowKey, setConfirmRemoveRowKey] = useState("");
  const confirmRowRemoval = (rowKey: string, hasText: boolean) => {
    if (!hasText || confirmRemoveRowKey === rowKey) {
      setConfirmRemoveRowKey("");
      return true;
    }
    setConfirmRemoveRowKey(rowKey);
    return false;
  };
  const [isVerifyBoxOpen, setIsVerifyBoxOpen] = useState(false);
  const [verifyCode, setVerifyCode] = useState("");
  const [verifyError, setVerifyError] = useState("");
  const [verifyBusy, setVerifyBusy] = useState(false);
  const [verifyResendCooldown, setVerifyResendCooldown] = useState(0);
  const verifyCooldownTimerRef = useRef<number | null>(null);
  const autoSaveTimerRef = useRef<number | null>(null);
  const pendingSaveRef = useRef(false);
  const isSavingRef = useRef(false);
  const lastSavedSnapshotRef = useRef("");
  const emblemSwatchRef = useRef<HTMLButtonElement | null>(null);
  // Phone: the badge in General's Badge Colour row (the colour picker opens beside it).
  const phoneColorSwatchRef = useRef<HTMLSpanElement | null>(null);

  // queueAutoSave's setTimeout closure freezes displayName/userColor/mobile at
  // whatever they were when it was scheduled — one render stale whenever a setter
  // and queueAutoSave() are called back-to-back in the same handler (e.g. the
  // native color input's onChange, or applyCompanyDefault), since React hasn't
  // re-rendered yet at that point. Syncing refs in a layout effect (rather than
  // during render) keeps them current well before the 180ms debounce ever fires.
  const displayNameRef = useRef(displayName);
  const userColorRef = useRef(userColor);
  const mobileRef = useRef(mobile);
  const notifyAsCreatorRef = useRef(notifyAsCreator);
  useLayoutEffect(() => {
    displayNameRef.current = displayName;
    userColorRef.current = userColor;
    mobileRef.current = mobile;
    notifyAsCreatorRef.current = notifyAsCreator;
  }, [displayName, userColor, mobile, notifyAsCreator]);

  const profileSnapshot = useMemo(
    () =>
      JSON.stringify({
        displayName: String(displayName || "").trim(),
        userColor: String(userColor || "").trim(),
        mobile: String(mobile || "").trim(),
        notifyAsCreator: Boolean(notifyAsCreator),
      }),
    [displayName, mobile, userColor, notifyAsCreator],
  );

  useEffect(() => {
    setDisplayName(user?.displayName || "");
  }, [user?.displayName]);

  useEffect(() => {
    setUserColor(user?.userColor || "");
  }, [user?.userColor]);

  useEffect(() => {
    setMobile(user?.mobile || "");
  }, [user?.mobile]);

  useEffect(() => {
    setNotifyAsCreator(Boolean(user?.notifyAsCreator));
  }, [user?.notifyAsCreator]);

  useEffect(() => {
    isSavingRef.current = isSaving;
  }, [isSaving]);

  useEffect(() => {
    lastSavedSnapshotRef.current = JSON.stringify({
      displayName: String(user?.displayName || "").trim(),
      userColor: String(user?.userColor || "").trim(),
      mobile: String(user?.mobile || "").trim(),
      notifyAsCreator: Boolean(user?.notifyAsCreator),
    });
  }, [user?.displayName, user?.mobile, user?.userColor, user?.notifyAsCreator]);

  useEffect(() => {
    setThemeMode(readThemeMode());
  }, []);

  useEffect(() => {
    const load = async () => {
      const storedCompanyId =
        typeof window !== "undefined" ? String(window.localStorage.getItem(ACTIVE_COMPANY_STORAGE_KEY) || "").trim() : "";
      const storedThemeColor =
        typeof window !== "undefined"
          ? String(window.localStorage.getItem(ACTIVE_COMPANY_THEME_COLOR_STORAGE_KEY) || "").trim()
          : "";
      const directCompanyId = String(user?.companyId || "").trim();
      const fallbackMembership =
        !directCompanyId && user?.uid
          ? await hedgedAsync(() => fetchPrimaryMembership(user.uid!), { message: "Membership lookup timed out" }).catch(() => null)
          : null;
      const membershipCompanyId = String(fallbackMembership?.companyId || "").trim();

      const candidateIds = new Set<string>();
      if (storedCompanyId) candidateIds.add(storedCompanyId);
      if (directCompanyId) candidateIds.add(directCompanyId);
      if (membershipCompanyId) candidateIds.add(membershipCompanyId);
      if (process.env.NEXT_PUBLIC_DEFAULT_COMPANY_ID) candidateIds.add(String(process.env.NEXT_PUBLIC_DEFAULT_COMPANY_ID).trim());
      candidateIds.add("cmp_mykm_91647c");

      if (/^#[0-9A-Fa-f]{6}$/.test(storedThemeColor)) {
        setCompanyColor(storedThemeColor);
      }

      let resolvedId = "";
      let resolvedRoles: unknown[] = [];
      // The known company ids first; only if none is readable, the companies of the user's projects
      // (this used to load every project up front on every visit, just to collect ids).
      let candidateList = Array.from(candidateIds);
      if (user?.uid && !(await Promise.all(candidateList.map((cid) => fetchCompanyDoc(cid)))).some(Boolean)) {
        try {
          const projects = await fetchProjects(user.uid, undefined, { lightweight: true });
          for (const project of projects) {
            const cid = String(project.companyId || "").trim();
            if (cid) candidateIds.add(cid);
          }
        } catch {
          // ignore project fallback errors
        }
        candidateList = Array.from(candidateIds);
      }
      for (const cid of candidateList) {
        if (!cid) continue;
        const doc = await fetchCompanyDoc(cid);
        if (!doc) continue;
        resolvedId = cid;
        const name = String((doc as Record<string, unknown> | null)?.name ?? "").trim();
        if (name) setCompanyName(name);
        const rolesRaw = (doc as Record<string, unknown> | null)?.roles;
        if (Array.isArray(rolesRaw)) resolvedRoles = rolesRaw;
        const themeColor = String((doc as Record<string, unknown> | null)?.themeColor ?? "").trim();
        if (/^#[0-9A-Fa-f]{6}$/.test(themeColor)) {
          setCompanyColor(themeColor);
          if (typeof window !== "undefined") {
            window.localStorage.setItem(ACTIVE_COMPANY_STORAGE_KEY, cid);
            window.localStorage.setItem(ACTIVE_COMPANY_THEME_COLOR_STORAGE_KEY, themeColor);
          }
        }
        break;
      }
      setResolvedCompanyId(resolvedId);

      if (resolvedId && user?.uid) {
        try {
          const access = await hedgedAsync(() => fetchCompanyAccess(resolvedId, user.uid!), {
            message: "Company access lookup timed out",
          });
          const roleKey = normalizeRoleKey(access?.roleId || access?.role || user?.role);
          let label = "";
          let color = "";
          for (const item of resolvedRoles) {
            if (!item || typeof item !== "object") continue;
            const row = item as Record<string, unknown>;
            const key = normalizeRoleKey(row.id ?? row.name);
            if (key && key === roleKey) {
              label = String(row.name ?? "").trim();
              color = String(row.color ?? "").trim();
              break;
            }
          }
          if (!label && roleKey) label = labelFromRoleKey(roleKey);
          setCompanyRoleLabel(label);
          setCompanyRoleColor(/^#[0-9A-Fa-f]{6}$/.test(color) ? color : "#7D99B3");
        } catch {
          // ignore role lookup errors, falls back to the account-level role
        }
      }
    };
    void load();
  }, [user?.companyId, user?.role, user?.uid]);

  const effectiveColor = useMemo(() => String(userColor || "").trim() || companyColor, [userColor, companyColor]);

  const saveProfile = async (mode: "manual" | "auto" = "manual") => {
    const uid = String(user?.uid || "").trim();
    const companyId = String(resolvedCompanyId || user?.companyId || "").trim();
    if (!uid) return;
    if (isSavingRef.current) {
      pendingSaveRef.current = true;
      return;
    }

    const normalized = {
      displayName: String(displayNameRef.current || "").trim(),
      userColor: String(userColorRef.current || "").trim(),
      mobile: String(mobileRef.current || "").trim(),
      notifyAsCreator: Boolean(notifyAsCreatorRef.current),
    };
    const nextSnapshot = JSON.stringify(normalized);
    if (nextSnapshot === lastSavedSnapshotRef.current) {
      if (mode === "manual") {
        setSaveMsg("Saved");
      }
      return;
    }

    setIsSaving(true);
    const result = await saveUserProfilePatchDetailed(uid, companyId, normalized);
    if (result.ok) {
      setUserColorLocal(normalized.userColor);
      setUserProfileLocal(normalized);
      lastSavedSnapshotRef.current = nextSnapshot;
      dispatchUserColorUpdated({
        uid,
        color: normalized.userColor,
        companyId: companyId || undefined,
      });
    }
    setSaveMsg(result.ok ? "Saved" : `Save failed${result.error ? ` (${result.error})` : ""}`);
    setIsSaving(false);

    if (pendingSaveRef.current) {
      pendingSaveRef.current = false;
      void saveProfile("auto");
    }
  };

  // Mobile pull-down gesture's "Save & Back" zone (app-shell.tsx) — kept in a ref since
  // saveProfile is recreated every render and the effect below should only re-register once.
  const saveProfileRef = useRef(saveProfile);
  saveProfileRef.current = saveProfile;
  useEffect(() => {
    setSaveAndBackHandler(async () => {
      await saveProfileRef.current("manual");
      router.push("/dashboard");
    });
    return () => setSaveAndBackHandler(null);
  }, [router, setSaveAndBackHandler]);

  const queueAutoSave = () => {
    if (autoSaveTimerRef.current) {
      window.clearTimeout(autoSaveTimerRef.current);
    }
    autoSaveTimerRef.current = window.setTimeout(() => {
      autoSaveTimerRef.current = null;
      void saveProfile("auto");
    }, 180);
  };

  useEffect(() => {
    return () => {
      if (autoSaveTimerRef.current) {
        window.clearTimeout(autoSaveTimerRef.current);
      }
    };
  }, []);

  // companyColor is already correctly resolved by the load() effect above by the
  // time this page can be interacted with, so re-deriving it here from a possibly
  // stale localStorage cache or a redundant re-fetch only risked landing on the
  // wrong color, and the async gap made it visibly slower/less reliable than the
  // color input, which updates userColor synchronously. Just clear the override
  // and let effectiveColor fall back to the already-known-good companyColor.
  const applyCompanyDefault = () => {
    setUserColor("");
    setUserColorLocal("");
    queueAutoSave();
  };

  const onSelectThemeMode = (mode: ThemeMode) => {
    setThemeMode(mode);
    saveThemeMode(mode);
  };

  const startEditingName = () => {
    setNameDraft(activeDisplayName);
    setIsNameEditing(true);
  };

  const commitNameEdit = () => {
    setDisplayName(nameDraft);
    setIsNameEditing(false);
    queueAutoSave();
  };

  const startEditingMobile = () => {
    setMobileDraft(mobile);
    setIsMobileEditing(true);
  };

  const commitMobileEdit = () => {
    setMobile(mobileDraft);
    setIsMobileEditing(false);
    queueAutoSave();
  };

  useEffect(() => {
    const uid = String(user?.uid || "").trim();
    if (!uid) return;
    void fetchChecklistTemplates(uid).then(setChecklistTemplates);
  }, [user?.uid]);

  const openNewChecklistEditor = () => {
    setConfirmRemoveRowKey("");
    setChecklistEditorId("");
    setChecklistNameDraft("");
    setChecklistRowsDraft([""]);
    setIsChecklistEditorOpen(true);
  };

  const openExistingChecklistEditor = (template: ChecklistTemplate) => {
    setConfirmRemoveRowKey("");
    setChecklistEditorId(template.id);
    setChecklistNameDraft(template.name);
    setChecklistRowsDraft(template.items.length ? template.items.map((item) => item.text) : [""]);
    setIsChecklistEditorOpen(true);
  };

  const closeChecklistEditor = () => {
    setIsChecklistEditorOpen(false);
  };

  const saveChecklistDraft = async () => {
    const uid = String(user?.uid || "").trim();
    if (!uid) return;
    const name = checklistNameDraft.trim();
    if (!name) return;
    const items = checklistRowsDraft
      .map((text) => text.trim())
      .filter(Boolean)
      .map((text) => ({ id: newChecklistLocalId("item"), text }));
    if (!items.length) return;
    const template: ChecklistTemplate = { id: checklistEditorId || newChecklistLocalId("checklist"), name, items };
    const ok = await saveChecklistTemplate(uid, template);
    if (ok) {
      setChecklistTemplates((prev) => {
        const next = prev.filter((t) => t.id !== template.id);
        next.push(template);
        return next.sort((a, b) => a.name.localeCompare(b.name));
      });
      setIsChecklistEditorOpen(false);
    }
  };

  const requestDeleteChecklist = (template: ChecklistTemplate, onDeleting?: () => void) => {
    const hasItems = template.items.some((item) => item.text.trim());
    if (hasItems && confirmDeleteChecklistId !== template.id) {
      setConfirmDeleteChecklistId(template.id);
      return;
    }
    setConfirmDeleteChecklistId("");
    onDeleting?.();
    void removeChecklistTemplate(template.id);
  };

  const removeChecklistTemplate = async (templateId: string) => {
    const uid = String(user?.uid || "").trim();
    if (!uid) return;
    const ok = await deleteChecklistTemplate(uid, templateId);
    if (ok) {
      setChecklistTemplates((prev) => prev.filter((t) => t.id !== templateId));
    }
  };

  const startVerifyCooldown = (seconds: number) => {
    if (verifyCooldownTimerRef.current) window.clearInterval(verifyCooldownTimerRef.current);
    setVerifyResendCooldown(seconds);
    verifyCooldownTimerRef.current = window.setInterval(() => {
      setVerifyResendCooldown((prev) => {
        if (prev <= 1) {
          if (verifyCooldownTimerRef.current) window.clearInterval(verifyCooldownTimerRef.current);
          verifyCooldownTimerRef.current = null;
          return 0;
        }
        return prev - 1;
      });
    }, 1000);
  };

  useEffect(() => {
    return () => {
      if (verifyCooldownTimerRef.current) window.clearInterval(verifyCooldownTimerRef.current);
    };
  }, []);

  const onSendVerificationCode = async () => {
    if (verifyBusy || verifyResendCooldown > 0 || !auth) return;
    setVerifyBusy(true);
    setVerifyError("");
    try {
      const idToken = await auth.currentUser?.getIdToken();
      if (!idToken) {
        setVerifyError("Not signed in.");
        return;
      }
      const res = await fetch("/api/verify/user/send", {
        method: "POST",
        headers: { Authorization: `Bearer ${idToken}` },
      });
      const data = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string; retryAfterSeconds?: number };
      if (!data.ok) {
        if (data.error === "cooldown" && data.retryAfterSeconds) {
          startVerifyCooldown(data.retryAfterSeconds);
        } else {
          setVerifyError(data.error || "Could not send verification code.");
        }
        return;
      }
      startVerifyCooldown(60);
    } catch {
      setVerifyError("Could not send verification code.");
    } finally {
      setVerifyBusy(false);
    }
  };

  const onConfirmVerificationCode = async () => {
    const code = verifyCode.trim();
    if (!code || verifyBusy || !auth) return;
    setVerifyBusy(true);
    setVerifyError("");
    try {
      const idToken = await auth.currentUser?.getIdToken();
      if (!idToken) {
        setVerifyError("Not signed in.");
        return;
      }
      const res = await fetch("/api/verify/user/confirm", {
        method: "POST",
        headers: { Authorization: `Bearer ${idToken}`, "Content-Type": "application/json" },
        body: JSON.stringify({ code }),
      });
      const data = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string };
      if (!data.ok) {
        setVerifyError(
          data.error === "invalid-code"
            ? "Incorrect code."
            : data.error === "expired"
              ? "Code expired — resend a new one."
              : data.error === "too-many-attempts"
                ? "Too many attempts — resend a new code."
                : data.error || "Could not verify your account.",
        );
        return;
      }
      setUserVerifiedLocal(true);
      setVerifyCode("");
      setIsVerifyBoxOpen(false);
    } catch {
      setVerifyError("Could not verify your account.");
    } finally {
      setVerifyBusy(false);
    }
  };

  const isDarkMode = themeMode === "dark";
  const activeDisplayName = String(displayName || user?.displayName || "CutSmart User").trim() || "CutSmart User";
  const profileInitials =
    activeDisplayName
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((part) => part[0]?.toUpperCase() ?? "")
      .join("") || "CU";
  const profileDirty = profileSnapshot !== lastSavedSnapshotRef.current;
  const saveStatusLabel = isSaving ? "Saving..." : profileDirty ? "Unsaved changes" : saveMsg || "Saved";
  const saveStatusTone = isSaving ? "#8ab4f8" : profileDirty ? (isDarkMode ? "#FDB022" : "#B54708") : "var(--success-strong)";

  const saveStatusPill =
    isSaving || profileDirty || saveMsg ? (
      <div
        className="inline-flex shrink-0 items-center gap-2 rounded-full border px-3 py-1 text-[11px] font-bold"
        style={{ borderColor: "var(--glass-border)", backgroundColor: "var(--panel-muted)", color: saveStatusTone }}
      >
        <span className="inline-flex h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: saveStatusTone }} />
        {saveStatusLabel}
      </div>
    ) : null;

  const glassCardStyle = {
    borderColor: "var(--glass-border)",
    backgroundColor: "var(--glass-bg-strong)",
    backdropFilter: "blur(20px) saturate(180%)",
    WebkitBackdropFilter: "blur(20px) saturate(180%)",
    boxShadow: "var(--shadow-glass)",
  } as const;

  // Enter the emailed code to verify the account (shown under the email while unverified).
  const renderVerifyBox = (className: string) => (
    <div
      className={className}
      style={{ borderColor: "var(--glass-border)", backgroundColor: "var(--panel-muted)" }}
    >
      <p className="text-[11px]" style={{ color: "var(--text-muted)" }}>
        Enter the code emailed to you when you registered to unlock editing anywhere in the app.
      </p>
      <div className="flex flex-wrap items-center gap-2">
        <input
          value={verifyCode}
          onChange={(e) => setVerifyCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
          placeholder="6-digit code"
          inputMode="numeric"
          className="h-8 w-[120px] rounded-[8px] border px-2 text-[12px] tracking-[2px]"
          style={{ borderColor: "var(--glass-border)", backgroundColor: "var(--panel-bg)", color: "var(--text-main)" }}
        />
        <button
          type="button"
          disabled={verifyBusy || verifyCode.trim().length !== 6}
          onClick={() => void onConfirmVerificationCode()}
          className="h-8 rounded-[8px] px-2.5 text-[11px] font-bold text-white disabled:opacity-55"
          style={{ backgroundImage: "var(--brand-gradient)" }}
        >
          Verify
        </button>
        <button
          type="button"
          disabled={verifyBusy || verifyResendCooldown > 0}
          onClick={() => void onSendVerificationCode()}
          className="h-8 rounded-[8px] border px-2.5 text-[11px] font-bold disabled:opacity-55"
          style={{ borderColor: "var(--glass-border)", backgroundColor: "var(--panel-bg)", color: "var(--text-main)" }}
        >
          {verifyResendCooldown > 0 ? `Resend (${verifyResendCooldown}s)` : "Resend Code"}
        </button>
      </div>
      {verifyError ? <p className="text-[11px] font-semibold" style={{ color: "var(--danger-strong)" }}>{verifyError}</p> : null}
    </div>
  );

  // Each section's contents on a computer (the cards below); a phone has its own rows further down.
  const generalContent = (
    <>
      <div className="flex flex-col items-center text-center">
        <div className="group relative">
          <div
            className="inline-flex h-24 w-24 items-center justify-center rounded-full text-[30px] font-extrabold text-white"
            style={{ backgroundColor: effectiveColor, boxShadow: "var(--shadow-glass)" }}
          >
            {profileInitials}
          </div>
          <button
            ref={emblemSwatchRef}
            type="button"
            onClick={() => {
              const rect = emblemSwatchRef.current?.getBoundingClientRect();
              if (rect) setColorPopoverAnchor({ left: rect.left, top: rect.top, width: rect.width, height: rect.height });
              setIsColorPopoverOpen(true);
            }}
            aria-label="Change emblem color"
            className="absolute inset-0 flex h-24 w-24 items-center justify-center rounded-full opacity-0 transition-opacity group-hover:opacity-100"
            style={{ backgroundColor: "rgba(0,0,0,0.45)" }}
          >
            <Pencil size={22} color="#ffffff" />
          </button>
        </div>
        <div className="mt-4 flex h-9 items-center justify-center">
          {isNameEditing ? (
            <div className="flex items-center gap-1.5">
              <input
                autoFocus
                value={nameDraft}
                onChange={(e) => setNameDraft(e.target.value)}
                onBlur={commitNameEdit}
                onKeyDown={(e) => {
                  if (e.key === "Enter") (e.target as HTMLInputElement).blur();
                }}
                className="h-9 w-[190px] rounded-[8px] border px-2 text-center text-[18px] font-extrabold outline-none"
                style={{ borderColor: "var(--glass-border)", backgroundColor: "var(--panel-bg)", color: "var(--text-main)" }}
              />
              <button
                type="button"
                onMouseDown={(e) => e.preventDefault()}
                onClick={commitNameEdit}
                className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-[8px] border"
                style={{ borderColor: "var(--brand-strong)", backgroundColor: "var(--brand-soft)", color: "var(--brand-strong)" }}
                aria-label="Save name"
              >
                <Check size={16} />
              </button>
            </div>
          ) : (
            <div className="group relative inline-flex max-w-full items-center">
              <h2 className="truncate text-[20px] font-extrabold leading-tight" style={{ color: "var(--text-main)" }}>
                {activeDisplayName}
              </h2>
              <button
                type="button"
                onClick={startEditingName}
                className="absolute left-full ml-1.5 inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-[7px] opacity-0 transition-opacity group-hover:opacity-100 [@media(hover:none)]:opacity-100 hover:bg-[var(--panel-muted)]"
                style={{ color: "var(--text-muted)" }}
                aria-label="Edit name"
              >
                <Pencil size={13} />
              </button>
            </div>
          )}
        </div>
        <p className="mt-1 flex items-center gap-1.5 text-[13px] font-medium" style={{ color: "var(--text-muted)" }}>
          <Mail size={13} />
          {user?.email || "-"}
          {!user?.verified && (
            <button
              type="button"
              onClick={() => setIsVerifyBoxOpen((prev) => !prev)}
              className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-[0.6px]"
              style={{ backgroundColor: "var(--danger-soft)", color: "var(--danger-strong)" }}
            >
              <MailCheck size={10} />
              Unverified
            </button>
          )}
        </p>
        {!user?.verified && isVerifyBoxOpen && renderVerifyBox("mt-3 w-full space-y-2 rounded-[12px] border p-3 text-left")}
      </div>

      <div className="mt-5 flex items-center justify-center">
        <button
          type="button"
          role="switch"
          aria-checked={isDarkMode}
          aria-label={`Theme mode: ${isDarkMode ? "Dark" : "Light"}`}
          onClick={() => onSelectThemeMode(isDarkMode ? "light" : "dark")}
          className="relative inline-flex h-10 w-[148px] items-center rounded-[999px] border px-1 transition-colors"
          style={{
            borderColor: isDarkMode ? "var(--brand-strong)" : "var(--glass-border)",
            backgroundImage: isDarkMode ? "var(--brand-gradient)" : "none",
            backgroundColor: isDarkMode ? undefined : "var(--panel-muted)",
          }}
        >
          <span
            className="absolute left-1 top-[3px] h-[32px] w-[67px] rounded-[999px] transition-transform"
            style={{
              transform: isDarkMode ? "translateX(71px)" : "translateX(-1px)",
              backgroundColor: "var(--panel-bg)",
              border: "1px solid var(--glass-border)",
              boxShadow: "var(--shadow-glass)",
            }}
          />
          <span className="relative z-10 flex w-full items-center justify-between px-3 text-[12px] font-bold">
            <span
              style={{
                color: isDarkMode ? "#ffffff" : "var(--brand-strong)",
                transform: isDarkMode ? "scale(0.92)" : "scale(1.05)",
                transformOrigin: "left center",
                transition: "transform 140ms ease, color 140ms ease",
              }}
            >
              Light
            </span>
            <span
              style={{
                color: isDarkMode ? "#ffffff" : "var(--text-muted)",
                transform: `${isDarkMode ? "scale(1.05)" : "scale(0.92)"} translateX(-2px)`,
                transformOrigin: "right center",
                transition: "transform 140ms ease, color 140ms ease",
              }}
            >
              Dark
            </span>
          </span>
        </button>
      </div>

      <div className="mt-5 space-y-3">
        <div className="rounded-[14px] border px-4 py-3" style={{ borderColor: "var(--glass-border)", backgroundColor: "var(--panel-muted)" }}>
          <p className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-[0.9px]" style={{ color: "var(--text-muted)" }}>
            <Building2 size={11} />
            Company
          </p>
          <p className="mt-1 text-[14px] font-semibold" style={{ color: "var(--text-main)" }}>{companyName || "-"}</p>
          {(companyRoleLabel || user?.role) ? (
            <span
              className="mt-1.5 inline-flex items-center rounded-full px-2.5 py-1 text-[11px] font-bold"
              style={{
                backgroundColor: companyRoleColor || "#7D99B3",
                color: contrastTextForFill(companyRoleColor || "#7D99B3"),
              }}
            >
              {companyRoleLabel || user?.role}
            </span>
          ) : null}
        </div>
        <div className="group rounded-[14px] border px-4 py-3" style={{ borderColor: "var(--glass-border)", backgroundColor: "var(--panel-muted)" }}>
          <p className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-[0.9px]" style={{ color: "var(--text-muted)" }}>
            <Smartphone size={11} />
            Mobile
          </p>
          <div className="mt-1 flex h-8 items-center justify-between gap-2">
            {isMobileEditing ? (
              <>
                <input
                  autoFocus
                  value={mobileDraft}
                  onChange={(e) => setMobileDraft(e.target.value)}
                  onBlur={commitMobileEdit}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") (e.target as HTMLInputElement).blur();
                  }}
                  className="h-8 min-w-0 flex-1 rounded-[8px] border px-2 text-[14px] outline-none"
                  style={{ borderColor: "var(--glass-border)", backgroundColor: "var(--panel-bg)", color: "var(--text-main)" }}
                />
                <button
                  type="button"
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={commitMobileEdit}
                  className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-[8px] border"
                  style={{ borderColor: "var(--brand-strong)", backgroundColor: "var(--brand-soft)", color: "var(--brand-strong)" }}
                  aria-label="Save mobile number"
                >
                  <Check size={14} />
                </button>
              </>
            ) : (
              <>
                <p className="truncate text-[14px] font-semibold" style={{ color: "var(--text-main)" }}>{mobile || "-"}</p>
                <button
                  type="button"
                  onClick={startEditingMobile}
                  className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-[7px] opacity-0 transition-opacity group-hover:opacity-100 [@media(hover:none)]:opacity-100 hover:bg-[var(--panel-bg)]"
                  style={{ color: "var(--text-muted)" }}
                  aria-label="Edit mobile number"
                >
                  <Pencil size={13} />
                </button>
              </>
            )}
          </div>
        </div>
      </div>
    </>
  );
  // Per-device ones (lib/ui-preferences.ts) save straight away; Notifications as Creator is part of the profile.
  const preferenceRows: Array<{ id: string; icon: LucideIcon; label: string; description: string; checked: boolean; onChange: (next: boolean) => void; phone: boolean }> = [
    {
      id: "notifyAsCreator",
      icon: Bell,
      label: "Notifications as Creator",
      description: "Auto-subscribe to notifications for projects you create.",
      checked: notifyAsCreator,
      onChange: (next) => {
        setNotifyAsCreator(next);
        queueAutoSave();
      },
      phone: true,
    },
    {
      id: "mobileTopBar",
      icon: PanelTop,
      label: "Mobile Top Navigation Bar",
      description: "The bar above the page with the menu and Dashboard button — not the page's own tab bar. Still reachable by swiping while off.",
      checked: mobileTopBarEnabled,
      onChange: (next) => {
        setMobileTopBarEnabled(next);
        saveMobileTopBarEnabled(next);
      },
      phone: true,
    },
    {
      id: "dashboardStatCards",
      icon: LayoutDashboard,
      label: "Dashboard Stat Cards",
      description: "Show the Projects/Active/Completed/Staff cards at the top of the dashboard.",
      checked: dashboardStatCardsEnabled,
      onChange: (next) => {
        setDashboardStatCardsEnabled(next);
        saveDashboardStatCardsEnabled(next);
      },
      phone: true,
    },
    {
      // A phone has no sidebar to resize.
      id: "sidebarResizeLock",
      icon: Lock,
      label: "Lock Sidebar Resizing",
      description: "Freezes the sidebar at its current width and disables the drag handle.",
      checked: sidebarResizeLocked,
      onChange: (next) => {
        setSidebarResizeLocked(next);
        saveSidebarResizeLockEnabled(next);
      },
      phone: false,
    },
  ];
  const preferencesContent = (
    <div className="space-y-4">
      {preferenceRows.map((row) => {
        const Icon = row.icon;
        return (
          <div key={row.id} className="flex items-center justify-between gap-3">
            <div className="flex min-w-0 items-center gap-2.5">
              <Icon size={16} style={{ color: "var(--text-muted)" }} />
              <div className="min-w-0">
                <p className="text-[13px] font-semibold" style={{ color: "var(--text-main)" }}>{row.label}</p>
                <p className="text-[11px]" style={{ color: "var(--text-muted)" }}>
                  {row.description}
                </p>
              </div>
            </div>
            <SettingsToggleSwitch checked={row.checked} onChange={row.onChange} />
          </div>
        );
      })}
    </div>
  );
  const checklistsHelp = <>Create reusable checklists here, then add them to a project from Design {"->"} Project Management.</>;
  const createChecklistButton = (
    <button
      type="button"
      onClick={openNewChecklistEditor}
      className="inline-flex h-9 shrink-0 items-center gap-1.5 rounded-[10px] border px-3 text-[12px] font-bold transition hover:brightness-95"
      style={{ borderColor: "var(--brand-strong)", backgroundColor: "var(--brand-soft)", color: "var(--brand-strong)" }}
    >
      <Plus size={14} />
      Create Checklist
    </button>
  );
  const checklistsContent = isChecklistEditorOpen ? (
    <div className="rounded-[14px] border p-4" style={{ borderColor: "var(--glass-border)", backgroundColor: "var(--panel-muted)" }}>
      <label className="block">
        <span className="mb-2 block text-[11px] font-bold uppercase tracking-[0.9px]" style={{ color: "var(--text-muted)" }}>Checklist Name</span>
        <input
          autoFocus
          value={checklistNameDraft}
          onChange={(e) => setChecklistNameDraft(e.target.value)}
          placeholder="e.g. Site Handover"
          className="h-10 w-full max-w-[320px] rounded-[10px] border px-3 text-[13px] outline-none"
          style={{ borderColor: "var(--glass-border)", backgroundColor: "var(--panel-bg)", color: "var(--text-main)" }}
        />
      </label>

      <div className="mt-4 space-y-2">
        {checklistRowsDraft.map((rowText, idx) => (
          <div key={idx} className="flex items-center gap-2">
            <input
              value={rowText}
              onChange={(e) =>
                setChecklistRowsDraft((prev) => prev.map((v, i) => (i === idx ? e.target.value : v)))
              }
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  setChecklistRowsDraft((prev) => [...prev, ""]);
                }
              }}
              placeholder={`Item ${idx + 1}`}
              className="h-10 w-full rounded-[10px] border px-3 text-[13px] outline-none"
              style={{ borderColor: "var(--glass-border)", backgroundColor: "var(--panel-bg)", color: "var(--text-main)" }}
            />
            <button
              type="button"
              disabled={checklistRowsDraft.length <= 1}
              onClick={() => {
                if (confirmRowRemoval(`draft:${idx}`, Boolean(rowText.trim()))) {
                  setChecklistRowsDraft((prev) => prev.filter((_, i) => i !== idx));
                }
              }}
              className="inline-flex h-8 min-w-8 shrink-0 items-center justify-center gap-1 rounded-[8px] px-2 transition hover:bg-[var(--panel-bg)] disabled:opacity-30"
              style={
                confirmRemoveRowKey === `draft:${idx}`
                  ? { color: "var(--danger-strong)", backgroundColor: "var(--danger-soft)" }
                  : { color: "var(--text-muted)" }
              }
              aria-label={confirmRemoveRowKey === `draft:${idx}` ? "Click again to remove row" : "Remove row"}
            >
              <X size={14} />
              {confirmRemoveRowKey === `draft:${idx}` ? <span className="text-[11px] font-semibold">Remove?</span> : null}
            </button>
          </div>
        ))}
      </div>

      <button
        type="button"
        onClick={() => setChecklistRowsDraft((prev) => [...prev, ""])}
        className="mt-3 inline-flex h-9 items-center gap-1.5 rounded-[10px] border px-3 text-[12px] font-bold transition hover:brightness-95"
        style={{ borderColor: "var(--glass-border)", backgroundColor: "var(--panel-bg)", color: "var(--text-main)" }}
      >
        <Plus size={14} />
        Add Row
      </button>

      <div className="mt-4 flex items-center gap-2">
        <button
          type="button"
          disabled={!checklistNameDraft.trim() || !checklistRowsDraft.some((v) => v.trim())}
          onClick={() => void saveChecklistDraft()}
          className="h-10 rounded-[10px] px-4 text-[12px] font-bold text-white disabled:opacity-55"
          style={{ backgroundImage: "var(--brand-gradient)" }}
        >
          Save Checklist
        </button>
        <button
          type="button"
          onClick={closeChecklistEditor}
          className="h-10 rounded-[10px] border px-4 text-[12px] font-bold transition hover:brightness-95"
          style={{ borderColor: "var(--glass-border)", backgroundColor: "var(--panel-bg)", color: "var(--text-main)" }}
        >
          Cancel
        </button>
      </div>
    </div>
  ) : checklistTemplates.length ? (
    <div className="space-y-2">
      {checklistTemplates.map((template) => (
        <div
          key={template.id}
          className="flex items-center justify-between gap-3 rounded-[14px] border px-4 py-3"
          style={{ borderColor: "var(--glass-border)", backgroundColor: "var(--panel-muted)" }}
        >
          <div className="flex min-w-0 items-center gap-2">
            <ClipboardList size={15} style={{ color: "var(--text-muted)" }} />
            <div className="min-w-0">
              <p className="truncate text-[13px] font-bold" style={{ color: "var(--text-main)" }}>{template.name}</p>
              <p className="text-[11px]" style={{ color: "var(--text-muted)" }}>
                {template.items.length} item{template.items.length === 1 ? "" : "s"}
              </p>
            </div>
          </div>
          <div className="flex shrink-0 items-center gap-1">
            <button
              type="button"
              onClick={() => openExistingChecklistEditor(template)}
              className="inline-flex h-8 w-8 items-center justify-center rounded-[8px] transition hover:bg-[var(--panel-bg)]"
              style={{ color: "var(--text-muted)" }}
              aria-label={`Edit ${template.name}`}
            >
              <Pencil size={13} />
            </button>
            <button
              type="button"
              onClick={() => requestDeleteChecklist(template)}
              className="inline-flex h-8 min-w-8 items-center justify-center gap-1 rounded-[8px] px-2 transition hover:bg-[var(--danger-soft)]"
              style={{
                color: "var(--danger-strong)",
                backgroundColor: confirmDeleteChecklistId === template.id ? "var(--danger-soft)" : undefined,
              }}
              aria-label={confirmDeleteChecklistId === template.id ? `Click again to delete ${template.name}` : `Delete ${template.name}`}
            >
              <Trash2 size={13} />
              {confirmDeleteChecklistId === template.id ? <span className="text-[11px] font-semibold">Delete?</span> : null}
            </button>
          </div>
        </div>
      ))}
    </div>
  ) : (
    <div className="flex flex-col items-center justify-center gap-2 rounded-[14px] border py-8 text-center" style={{ borderColor: "var(--glass-border)", backgroundColor: "var(--panel-muted)" }}>
      <ClipboardList size={22} style={{ color: "var(--text-muted)", opacity: 0.6 }} />
      <p className="text-[12px] font-semibold" style={{ color: "var(--text-muted)" }}>No checklists yet.</p>
    </div>
  );
  // The page's bar. On a phone it's fixed under the app's tab bar, so it stays put while the pages slide
  // beneath it (they start below it, at 92px); its button saves and leaves User Settings from any of them.
  const headerBar = (
  <div
    className={
      isPhone
        ? "glass-page-header fixed inset-x-0 top-12 z-[31] flex h-[44px] items-center justify-between px-4"
        : "glass-page-header -mx-4 -mt-3 flex h-[44px] shrink-0 items-center justify-between px-4 md:-mx-5 md:-mt-4 md:h-[56px] md:px-5"
    }
  >
    <div className="flex min-w-0 items-center gap-5">
      <div className="flex min-w-0 items-center gap-2">
        <UserCog size={16} style={{ color: "var(--text-main)" }} strokeWidth={2.1} />
        <p className="truncate text-[14px] font-medium uppercase tracking-[1px]" style={{ color: "var(--text-main)" }}>
          User Settings
        </p>
        <span className="text-[14px] font-medium" style={{ color: "var(--text-muted)" }}>|</span>
        <p className="truncate text-[14px] font-medium" style={{ color: "var(--text-main)" }}>
          {activeDisplayName}
        </p>
      </div>
      {/* Only shown for an active/meaningful state (saving, unsaved changes, or a transient
          save-result message) — hidden at rest instead of sitting there permanently reading
          "Saved", which carried no real information once nothing was happening. */}
      {saveStatusPill}
    </div>
    {isCompactUserSettingsViewport ? (
      <button
        type="button"
        disabled={isSaving}
        onClick={async () => {
          await saveProfile("manual");
          router.push("/dashboard");
        }}
        className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-[10px] border hover:brightness-95 disabled:opacity-55"
        style={{ backgroundImage: "var(--brand-gradient)", borderColor: "var(--brand-strong)" }}
        aria-label={isSaving ? "Saving..." : "Save & Back"}
      >
        <ChevronLeft size={18} color="#ffffff" strokeWidth={2.5} />
      </button>
    ) : (
      <button
        type="button"
        disabled={isSaving}
        onClick={async () => {
          await saveProfile("manual");
          router.push("/dashboard");
        }}
        className="inline-flex h-9 shrink-0 items-center rounded-[10px] border px-4 text-[12px] font-bold transition hover:brightness-95 disabled:opacity-55"
        style={{ borderColor: "var(--brand-strong)", backgroundColor: "var(--brand-soft)", color: "var(--brand-strong)" }}
      >
        {isSaving ? "Saving..." : "Save & Back"}
      </button>
    )}
  </div>
  );

  // ---- Phone: each section's page — a title card (with Back to the sections list — the bar's own button
  // leaves User Settings), then cards of rows.
  const renderSectionTitle = (sectionId: string, help?: ReactNode) => {
    const section = USER_SETTINGS_SECTIONS.find((item) => item.id === sectionId);
    if (!section) return null;
    const Icon = section.icon;
    return (
      <div className="flex items-center gap-3 rounded-[18px] border p-4" style={glassCardStyle}>
        <button
          type="button"
          onClick={() => sectionSlide.close()}
          className="glass-nav-arrow inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full"
          aria-label="Back"
        >
          <ChevronLeft size={18} />
        </button>
        <div
          className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-full"
          style={{ backgroundColor: "var(--panel-muted)", color: "var(--text-main)" }}
        >
          <Icon size={20} />
        </div>
        <div className="min-w-0">
          <p className="truncate text-[20px] font-semibold leading-tight" style={{ color: "var(--text-main)" }}>{section.label}</p>
          {help ? <p className="mt-0.5 text-[12px]" style={{ color: "var(--text-muted)" }}>{help}</p> : null}
        </div>
      </div>
    );
  };
  const phoneValueClass = "max-w-[55%] truncate text-[13px]";
  const phoneInputStyle = { borderColor: "var(--glass-border)", backgroundColor: "var(--panel-bg)", color: "var(--text-main)" } as const;
  const phoneSaveButtonStyle = { borderColor: "var(--brand-strong)", backgroundColor: "var(--brand-soft)", color: "var(--brand-strong)" } as const;
  // Name / Mobile, editable in place (16px text, so a phone doesn't zoom in on it).
  const renderPhoneEditRow = (icon: LucideIcon, label: string, value: string, draft: { editing: boolean; value: string; set: (next: string) => void; start: () => void; commit: () => void }) => {
    const Icon = icon;
    return draft.editing ? (
      <div className={MOBILE_ROW_CLASS}>
        <Icon size={17} className="shrink-0" style={{ color: "var(--text-muted)" }} />
        <input
          autoFocus
          aria-label={label}
          value={draft.value}
          onChange={(e) => draft.set(e.target.value)}
          onBlur={draft.commit}
          onKeyDown={(e) => {
            if (e.key === "Enter") (e.target as HTMLInputElement).blur();
          }}
          className="h-9 min-w-0 flex-1 rounded-[8px] border px-2 text-[16px] outline-none"
          style={phoneInputStyle}
        />
        <button
          type="button"
          onMouseDown={(e) => e.preventDefault()}
          onClick={draft.commit}
          className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-[8px] border"
          style={phoneSaveButtonStyle}
          aria-label={`Save ${label.toLowerCase()}`}
        >
          <Check size={16} />
        </button>
      </div>
    ) : (
      <MobileSettingsRow icon={icon} label={label} onClick={() => draft.start()}>
        <span className={phoneValueClass} style={{ color: "var(--text-muted)" }}>{value || "-"}</span>
        <Pencil size={13} className="shrink-0" style={{ color: "var(--text-muted)" }} />
      </MobileSettingsRow>
    );
  };
  const phoneGeneral = (
    <>
      <div className={MOBILE_ROWS_CARD_CLASS} style={glassCardStyle}>
        <MobileSettingsRow
          icon={Palette}
          label="Badge Colour"
          onClick={() => {
            const rect = phoneColorSwatchRef.current?.getBoundingClientRect();
            if (rect) setColorPopoverAnchor({ left: rect.left, top: rect.top, width: rect.width, height: rect.height });
            setIsColorPopoverOpen(true);
          }}
        >
          <span
            ref={phoneColorSwatchRef}
            className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-[11px] font-extrabold text-white"
            style={{ backgroundColor: effectiveColor }}
          >
            {profileInitials}
          </span>
        </MobileSettingsRow>
        {renderPhoneEditRow(UserRound, "Name", activeDisplayName, {
          editing: isNameEditing,
          value: nameDraft,
          set: setNameDraft,
          start: startEditingName,
          commit: commitNameEdit,
        })}
        <MobileSettingsRow icon={Mail} label="Email">
          {!user?.verified ? (
            <button
              type="button"
              onClick={() => setIsVerifyBoxOpen((prev) => !prev)}
              className="inline-flex shrink-0 items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-[0.6px]"
              style={{ backgroundColor: "var(--danger-soft)", color: "var(--danger-strong)" }}
            >
              <MailCheck size={10} />
              Unverified
            </button>
          ) : null}
          <span className={phoneValueClass} style={{ color: "var(--text-muted)" }}>{user?.email || "-"}</span>
        </MobileSettingsRow>
        {renderPhoneEditRow(Smartphone, "Mobile", mobile, {
          editing: isMobileEditing,
          value: mobileDraft,
          set: setMobileDraft,
          start: startEditingMobile,
          commit: commitMobileEdit,
        })}
        <MobileSettingsRow icon={Moon} label="Dark Mode">
          <SettingsToggleSwitch checked={isDarkMode} onChange={(next) => onSelectThemeMode(next ? "dark" : "light")} />
        </MobileSettingsRow>
      </div>
      {!user?.verified && isVerifyBoxOpen
        ? renderVerifyBox("space-y-2 rounded-[18px] border p-4 text-left")
        : null}
      <div className={MOBILE_ROWS_CARD_CLASS} style={glassCardStyle}>
        <MobileSettingsRow icon={Building2} label="Company">
          <span className={phoneValueClass} style={{ color: "var(--text-muted)" }}>{companyName || "-"}</span>
        </MobileSettingsRow>
        <MobileSettingsRow icon={BadgeCheck} label="Role">
          {companyRoleLabel || user?.role ? (
            <span
              className="inline-flex shrink-0 items-center rounded-full px-2.5 py-1 text-[11px] font-bold"
              style={{ backgroundColor: companyRoleColor || "#7D99B3", color: contrastTextForFill(companyRoleColor || "#7D99B3") }}
            >
              {companyRoleLabel || user?.role}
            </span>
          ) : (
            <span className={phoneValueClass} style={{ color: "var(--text-muted)" }}>-</span>
          )}
        </MobileSettingsRow>
      </div>
    </>
  );
  const phonePreferences = (
    <div className={MOBILE_ROWS_CARD_CLASS} style={glassCardStyle}>
      {preferenceRows
        .filter((row) => row.phone)
        .map((row) => (
          <MobileSettingsRow key={row.id} icon={row.icon} label={row.label} detail={row.description}>
            <SettingsToggleSwitch checked={row.checked} onChange={row.onChange} />
          </MobileSettingsRow>
        ))}
    </div>
  );
  const itemCountLabel = (template: ChecklistTemplate) => `${template.items.length} item${template.items.length === 1 ? "" : "s"}`;
  // Opening a checklist's page starts it showing its items (not an editor left open from before).
  // A checklist's page is always editable: tap its name or an item to change it, X removes an item, Add Row
  // adds one — each change saved as it's made.
  const [editingChecklistItemId, setEditingChecklistItemId] = useState("");
  const [checklistItemDraft, setChecklistItemDraft] = useState("");
  const [isEditingChecklistName, setIsEditingChecklistName] = useState(false);
  const [checklistNameEditDraft, setChecklistNameEditDraft] = useState("");
  const openChecklistPage = (templateId: string) => {
    setConfirmDeleteChecklistId("");
    setConfirmRemoveRowKey("");
    setEditingChecklistItemId("");
    setIsEditingChecklistName(false);
    checklistSlide.open(templateId);
  };
  // Shown straight away, then saved (without any empty item still being typed).
  const saveChecklistChange = (next: ChecklistTemplate) => {
    setChecklistTemplates((prev) => prev.map((t) => (t.id === next.id ? next : t)).sort((a, b) => a.name.localeCompare(b.name)));
    const uid = String(user?.uid || "").trim();
    const items = next.items.map((item) => ({ ...item, text: item.text.trim() })).filter((item) => item.text);
    if (uid && next.name.trim() && items.length) void saveChecklistTemplate(uid, { ...next, items });
  };
  const commitChecklistName = (template: ChecklistTemplate) => {
    setIsEditingChecklistName(false);
    const name = checklistNameEditDraft.trim();
    if (name && name !== template.name) saveChecklistChange({ ...template, name });
  };
  const startEditingChecklistItem = (item: ChecklistTemplate["items"][number]) => {
    setConfirmRemoveRowKey("");
    setEditingChecklistItemId(item.id);
    setChecklistItemDraft(item.text);
  };
  // Emptied, an item goes (unless it's the only one).
  const commitChecklistItem = (template: ChecklistTemplate) => {
    const itemId = editingChecklistItemId;
    if (!itemId) return;
    setEditingChecklistItemId("");
    const text = checklistItemDraft.trim();
    const items = text
      ? template.items.map((item) => (item.id === itemId ? { ...item, text } : item))
      : template.items.length > 1
        ? template.items.filter((item) => item.id !== itemId)
        : template.items;
    saveChecklistChange({ ...template, items });
  };
  const removeChecklistItem = (template: ChecklistTemplate, itemId: string) => {
    if (template.items.length <= 1) return;
    if (editingChecklistItemId === itemId) setEditingChecklistItemId("");
    saveChecklistChange({ ...template, items: template.items.filter((item) => item.id !== itemId) });
  };
  // A new, empty item at the bottom, ready to type in (saved once it has text).
  const addChecklistRow = (templateId: string) => {
    const id = newChecklistLocalId("item");
    setChecklistTemplates((prev) => prev.map((t) => (t.id === templateId ? { ...t, items: [...t.items, { id, text: "" }] } : t)));
    setEditingChecklistItemId(id);
    setChecklistItemDraft("");
  };
  const isCreatingChecklist = isChecklistEditorOpen && !checklistEditorId;
  const phoneChecklists = isCreatingChecklist ? (
    <div className="rounded-[18px] border p-3" style={glassCardStyle}>
      {checklistsContent}
    </div>
  ) : (
    <div className={MOBILE_ROWS_CARD_CLASS} style={glassCardStyle}>
      {checklistTemplates.map((template) => (
        <MobileSettingsRow
          key={template.id}
          icon={ClipboardList}
          label={template.name}
          detail={itemCountLabel(template)}
          onClick={() => openChecklistPage(template.id)}
        >
          <ChevronRight size={16} className="shrink-0" style={{ color: "var(--text-muted)" }} />
        </MobileSettingsRow>
      ))}
      <MobileSettingsRow icon={Plus} label="Create Checklist" accent onClick={openNewChecklistEditor} />
    </div>
  );
  // A checklist's page: a title card (Back to Checklists, its name — tap to rename — and item count, and
  // Delete on the right — a second tap confirms it if it has items), then its items, always editable.
  const openChecklist = checklistTemplates.find((template) => template.id === checklistSlide.openId) ?? null;
  const checklistPage = openChecklist ? (
    <div className="space-y-4">
      <div className="flex items-center gap-3 rounded-[18px] border p-4" style={glassCardStyle}>
        <button
          type="button"
          onClick={() => checklistSlide.close()}
          className="glass-nav-arrow inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full"
          aria-label="Back"
        >
          <ChevronLeft size={18} />
        </button>
        <div
          className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-full"
          style={{ backgroundColor: "var(--panel-muted)", color: "var(--text-main)" }}
        >
          <ClipboardList size={20} />
        </div>
        {isEditingChecklistName ? (
          <input
            autoFocus
            aria-label="Checklist name"
            value={checklistNameEditDraft}
            onChange={(e) => setChecklistNameEditDraft(e.target.value)}
            onBlur={() => commitChecklistName(openChecklist)}
            onKeyDown={(e) => {
              if (e.key === "Enter") (e.target as HTMLInputElement).blur();
            }}
            className="h-10 min-w-0 flex-1 rounded-[8px] border px-2 text-[17px] font-semibold outline-none"
            style={phoneInputStyle}
          />
        ) : (
          <button
            type="button"
            onClick={() => {
              setChecklistNameEditDraft(openChecklist.name);
              setIsEditingChecklistName(true);
            }}
            className="min-w-0 flex-1 text-left"
            aria-label={`Rename ${openChecklist.name}`}
          >
            <p className="truncate text-[20px] font-semibold leading-tight" style={{ color: "var(--text-main)" }}>{openChecklist.name}</p>
            <p className="mt-0.5 text-[12px]" style={{ color: "var(--text-muted)" }}>{itemCountLabel(openChecklist)}</p>
          </button>
        )}
        <button
          type="button"
          onClick={() => requestDeleteChecklist(openChecklist, () => checklistSlide.close())}
          className="inline-flex h-9 min-w-9 shrink-0 items-center justify-center gap-1 rounded-[10px] px-2 transition active:bg-[var(--danger-soft)]"
          style={{
            color: "var(--danger-strong)",
            backgroundColor: confirmDeleteChecklistId === openChecklist.id ? "var(--danger-soft)" : undefined,
          }}
          aria-label={confirmDeleteChecklistId === openChecklist.id ? `Tap again to delete ${openChecklist.name}` : `Delete ${openChecklist.name}`}
        >
          <Trash2 size={16} />
          {confirmDeleteChecklistId === openChecklist.id ? <span className="text-[12px] font-semibold">Delete?</span> : null}
        </button>
      </div>
      <div className={MOBILE_ROWS_CARD_CLASS} style={glassCardStyle}>
        {openChecklist.items.map((item, index) => (
          <div key={item.id || index} className={MOBILE_ROW_CLASS}>
            <span
              className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[11px] font-semibold"
              style={{ backgroundColor: "var(--panel-muted)", color: "var(--text-muted)" }}
            >
              {index + 1}
            </span>
            {editingChecklistItemId === item.id ? (
              <input
                autoFocus
                aria-label={`Item ${index + 1}`}
                placeholder={`Item ${index + 1}`}
                value={checklistItemDraft}
                onChange={(e) => setChecklistItemDraft(e.target.value)}
                onBlur={() => commitChecklistItem(openChecklist)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") (e.target as HTMLInputElement).blur();
                }}
                className="h-9 min-w-0 flex-1 rounded-[8px] border px-2 text-[16px] outline-none"
                style={phoneInputStyle}
              />
            ) : (
              <button
                type="button"
                onClick={() => startEditingChecklistItem(item)}
                className="min-w-0 flex-1 break-words py-1 text-left text-[14px] font-medium"
                style={{ color: item.text ? "var(--text-main)" : "var(--text-muted)" }}
              >
                {item.text || `Item ${index + 1}`}
              </button>
            )}
            <button
              type="button"
              disabled={openChecklist.items.length <= 1}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => {
                const text = editingChecklistItemId === item.id ? checklistItemDraft : item.text;
                if (confirmRowRemoval(item.id, Boolean(text.trim()))) removeChecklistItem(openChecklist, item.id);
              }}
              className={
                confirmRemoveRowKey === item.id
                  ? "inline-flex h-7 shrink-0 items-center justify-center gap-1 rounded-[8px] px-2 text-[11px] font-semibold"
                  : iconRemoveButtonClass
              }
              style={confirmRemoveRowKey === item.id ? { color: "var(--danger-strong)", backgroundColor: "var(--danger-soft)" } : undefined}
              aria-label={confirmRemoveRowKey === item.id ? `Tap again to remove item ${index + 1}` : `Remove item ${index + 1}`}
            >
              <X size={confirmRemoveRowKey === item.id ? 14 : 16} />
              {confirmRemoveRowKey === item.id ? "Remove?" : null}
            </button>
          </div>
        ))}
        <MobileSettingsRow icon={Plus} label="Add Row" accent onClick={() => addChecklistRow(openChecklist.id)} />
      </div>
    </div>
  ) : null;

  // Every setting on every page, for the first page's search: tapping one opens its page (a notification
  // opens Notifications searched for it; a checklist opens Checklists, then its own page slides in).
  type SettingsSearchItem = {
    key: string;
    section: string;
    label: string;
    icon: LucideIcon;
    detail?: string;
    keywords?: string;
    notificationsQuery?: string;
    onOpen?: () => void;
    // Once its page has slid in.
    afterOpen?: () => void;
  };
  const settingsSearchItems: SettingsSearchItem[] = [
    { key: "general:colour", section: "general", label: "Badge Colour", icon: Palette, keywords: "color emblem initials" },
    { key: "general:name", section: "general", label: "Name", icon: UserRound, keywords: "display name" },
    { key: "general:email", section: "general", label: "Email", icon: Mail, keywords: "verify verification code" },
    { key: "general:mobile", section: "general", label: "Mobile", icon: Smartphone, keywords: "phone number" },
    { key: "general:dark", section: "general", label: "Dark Mode", icon: Moon, keywords: "theme light" },
    { key: "general:company", section: "general", label: "Company", icon: Building2 },
    { key: "general:role", section: "general", label: "Role", icon: BadgeCheck },
    ...preferenceRows
      .filter((row) => row.phone)
      .map((row) => ({ key: `preferences:${row.id}`, section: "preferences", label: row.label, icon: row.icon, keywords: row.description })),
    { key: "notifications:push", section: "notifications", label: "Push Notifications", icon: Bell, keywords: "phone desktop lock screen" },
    { key: "notifications:quiet", section: "notifications", label: "Time between notifications", icon: Timer, keywords: "group grouped" },
    ...PUSH_NOTIFICATION_CATEGORIES.flatMap((category) => [
      {
        key: `notifications:category:${category.id}`,
        section: "notifications",
        label: `${category.label} notifications`,
        icon: PUSH_CATEGORY_ICONS[category.id] ?? Bell,
        notificationsQuery: category.label,
      },
      ...category.types.map((option) => ({
        key: `notifications:type:${option.type}`,
        section: "notifications",
        label: option.label,
        icon: PUSH_CATEGORY_ICONS[category.id] ?? Bell,
        detail: `Notifications · ${category.label}`,
        keywords: option.description,
        notificationsQuery: option.label,
      })),
    ]),
    ...checklistTemplates.map((template) => ({
      key: `checklists:${template.id}`,
      section: "checklists",
      label: template.name,
      icon: ClipboardList,
      keywords: "checklist",
      afterOpen: () => openChecklistPage(template.id),
    })),
    { key: "checklists:create", section: "checklists", label: "Create Checklist", icon: Plus, keywords: "new checklist", onOpen: openNewChecklistEditor },
  ];
  const settingsQuery = settingsSearch.trim().toLowerCase();
  const sectionLabelOf = (sectionId: string) => USER_SETTINGS_SECTIONS.find((section) => section.id === sectionId)?.label ?? "";
  const settingsResults = settingsQuery
    ? settingsSearchItems.filter((item) =>
        `${item.label} ${item.keywords ?? ""} ${item.detail ?? sectionLabelOf(item.section)}`.toLowerCase().includes(settingsQuery),
      )
    : [];

  const downloadApp = (
    <div>
      {pwaCanInstall ? (
        <button
          type="button"
          onClick={() => void onClickDownloadApp()}
          className="flex h-11 w-full items-center justify-center gap-1.5 rounded-[12px] border text-[13px] font-bold text-white transition hover:brightness-95"
          style={{ backgroundImage: "var(--brand-gradient)", borderColor: "var(--brand-strong)" }}
        >
          <Download size={15} />
          Download App
        </button>
      ) : (
        <button
          type="button"
          onClick={(e) => {
            pwaHelpOriginElRef.current = e.currentTarget;
            setPwaHelpOrigin(captureGlassModalOrigin(e));
            setIsPwaHelpOpen(true);
          }}
          className="flex h-11 w-full items-center justify-center gap-1.5 rounded-[12px] border text-[13px] font-bold text-white transition hover:brightness-95"
          style={{ backgroundImage: "var(--brand-gradient)", borderColor: "var(--brand-strong)" }}
        >
          <HelpCircle size={15} />
          Help — Save as App
        </button>
      )}
      {pwaInstallStatusMsg ? (
        <p className="mt-1.5 text-center text-[11px] font-semibold" style={{ color: "var(--brand-strong)" }}>{pwaInstallStatusMsg}</p>
      ) : null}
    </div>
  );

  return (
    <div ref={settingsPageRef} className="space-y-4">
      {isPhone ? (
        <>
          {/* Holds the bar's place — the bar itself is fixed (below). */}
          <div aria-hidden className="-mx-4 -mt-3 h-[44px]" />
          {typeof document !== "undefined" ? createPortal(headerBar, document.body) : null}
        </>
      ) : (
        headerBar
      )}

      {isPhone ? (
        // Phone: a profile card, then the sections — each slides in as its own page (below).
        <>
          <div className="flex items-center gap-3.5 rounded-[18px] border p-4" style={glassCardStyle}>
            <div
              className="inline-flex h-14 w-14 shrink-0 items-center justify-center rounded-full text-[19px] font-extrabold text-white"
              style={{ backgroundColor: effectiveColor }}
            >
              {profileInitials}
            </div>
            <div className="min-w-0">
              <p className="truncate text-[17px] font-semibold" style={{ color: "var(--text-main)" }}>{activeDisplayName}</p>
              <p className="truncate text-[12.5px]" style={{ color: "var(--text-muted)" }}>{user?.email || ""}</p>
            </div>
          </div>
          <label className="flex h-10 items-center gap-2 rounded-[12px] border px-3" style={glassCardStyle}>
            <Search size={14} className="shrink-0" style={{ color: "var(--text-muted)" }} />
            <input
              value={settingsSearch}
              onChange={(e) => setSettingsSearch(e.target.value)}
              placeholder="Search settings"
              className="h-8 w-full min-w-0 bg-transparent text-[13px] outline-none"
              style={{ color: "var(--text-main)" }}
            />
            {settingsSearch ? (
              <button type="button" onClick={() => setSettingsSearch("")} aria-label="Clear search" className="shrink-0" style={{ color: "var(--text-muted)" }}>
                <X size={14} />
              </button>
            ) : null}
          </label>
          {settingsQuery ? (
            settingsResults.length ? (
              <div className={MOBILE_ROWS_CARD_CLASS} style={glassCardStyle}>
                {settingsResults.map((item) => (
                  <MobileSettingsRow
                    key={item.key}
                    icon={item.icon}
                    label={item.label}
                    detail={item.detail ?? sectionLabelOf(item.section)}
                    onClick={() => {
                      item.onOpen?.();
                      openSection(item.section, item.notificationsQuery);
                      if (item.afterOpen) window.setTimeout(item.afterOpen, 340);
                    }}
                  >
                    <ChevronRight size={16} className="shrink-0" style={{ color: "var(--text-muted)" }} />
                  </MobileSettingsRow>
                ))}
              </div>
            ) : (
              <p className="px-1 py-2 text-[12px]" style={{ color: "var(--text-muted)" }}>No settings match.</p>
            )
          ) : (
            <div className={MOBILE_ROWS_CARD_CLASS} style={glassCardStyle}>
              {USER_SETTINGS_SECTIONS.map((section) => (
                <MobileSettingsRow key={section.id} icon={section.icon} label={section.label} onClick={() => openSection(section.id)}>
                  <ChevronRight size={16} className="shrink-0" style={{ color: "var(--text-muted)" }} />
                </MobileSettingsRow>
              ))}
            </div>
          )}
          {!pwaIsInstalled ? downloadApp : null}
        </>
      ) : (
        <>
          {/* Mobile only — lets someone install the app straight from a button press instead of
              visiting the site and manually bookmarking it. Just the button, full width to match the
              containers below rather than living inside its own card. Hidden entirely once already
              installed. When there's no native install prompt available (iOS always, or Android/
              Chrome before it decides the site is install-eligible), shows a Help button that opens
              manual instructions instead of a dead/no-op button. On a phone it sits below the sections list. */}
          {isCompactUserSettingsViewport && !pwaIsInstalled ? downloadApp : null}

          <div className="grid gap-5 xl:grid-cols-[320px_minmax(0,1fr)]">
            <aside className="rounded-[18px] border p-5" style={glassCardStyle}>
              {generalContent}
            </aside>

            <div className="space-y-5">
              <div className="rounded-[18px] border p-5" style={glassCardStyle}>
                <h3 className="mb-4 text-[15px] font-extrabold uppercase tracking-[1px]" style={{ color: "var(--text-main)" }}>
                  Preferences
                </h3>
                {preferencesContent}
              </div>

              <PushNotificationSettings uid={String(user?.uid || "")} cardStyle={glassCardStyle} Toggle={SettingsToggleSwitch} pageRef={settingsPageRef} />

              <div className="rounded-[18px] border p-5" style={glassCardStyle}>
                <div className="mb-5 flex items-start justify-between gap-3">
                  <div>
                    <h3 className="text-[15px] font-extrabold uppercase tracking-[1px]" style={{ color: "var(--text-main)" }}>
                      Checklists
                    </h3>
                    <p className="mt-1 text-[12px]" style={{ color: "var(--text-muted)" }}>
                      {checklistsHelp}
                    </p>
                  </div>
                  {!isChecklistEditorOpen && createChecklistButton}
                </div>

                {checklistsContent}
              </div>
            </div>
          </div>
        </>
      )}

      {shouldRenderPwaHelp && typeof document !== "undefined" && createPortal(
        <div className="fixed inset-0 z-[9998] flex items-center justify-center p-4">
          <button
            type="button"
            aria-label="Close help backdrop"
            onClick={() => setIsPwaHelpOpen(false)}
            className="glass-modal-backdrop absolute inset-0"
          />
          <div ref={pwaHelpPanelRef} className="glass-modal-panel relative w-full max-w-[420px] overflow-hidden">
            <div className="glass-modal-header flex h-[50px] items-center justify-between px-4">
              <p className="text-[15px] font-bold uppercase tracking-[1px]" style={{ color: "var(--text-main)" }}>
                Save as App
              </p>
              <button
                type="button"
                onClick={() => setIsPwaHelpOpen(false)}
                className="h-8 rounded-[8px] border px-3 text-[12px] font-bold transition hover:brightness-95"
                style={{ borderColor: "var(--glass-border)", backgroundColor: "var(--panel-muted)", color: "var(--text-main)" }}
              >
                Close
              </button>
            </div>
            <div className="space-y-4 p-4 sm:p-6">
              {isIosInstallHint ? (
                <div>
                  <ol className="space-y-3">
                    <li className="flex items-start gap-2.5">
                      <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[11px] font-bold text-white" style={{ backgroundImage: "var(--brand-gradient)" }}>1</span>
                      <span className="flex items-center gap-1.5 text-[13px]" style={{ color: "var(--text-main)" }}>
                        Tap the <Share size={14} className="inline" style={{ color: "var(--text-main)" }} /> Share icon in the browser&apos;s toolbar.
                      </span>
                    </li>
                    <li className="flex items-start gap-2.5">
                      <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[11px] font-bold text-white" style={{ backgroundImage: "var(--brand-gradient)" }}>2</span>
                      <span className="text-[13px]" style={{ color: "var(--text-main)" }}>Scroll down and tap &quot;Add to Home Screen&quot;.</span>
                    </li>
                    <li className="flex items-start gap-2.5">
                      <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[11px] font-bold text-white" style={{ backgroundImage: "var(--brand-gradient)" }}>3</span>
                      <span className="text-[13px]" style={{ color: "var(--text-main)" }}>Tap &quot;Add&quot; in the top right.</span>
                    </li>
                  </ol>
                </div>
              ) : (
                <div>
                  <p className="mb-3 text-[12px] font-semibold" style={{ color: "var(--text-muted)" }}>
                    Steps can vary slightly by browser — this is the usual Chrome flow.
                  </p>
                  <ol className="space-y-3">
                    <li className="flex items-start gap-2.5">
                      <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[11px] font-bold text-white" style={{ backgroundImage: "var(--brand-gradient)" }}>1</span>
                      <span className="text-[13px]" style={{ color: "var(--text-main)" }}>Tap the ⋮ menu in the top right of the browser.</span>
                    </li>
                    <li className="flex items-start gap-2.5">
                      <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[11px] font-bold text-white" style={{ backgroundImage: "var(--brand-gradient)" }}>2</span>
                      <span className="text-[13px]" style={{ color: "var(--text-main)" }}>Tap &quot;Add to Home screen&quot; or &quot;Install app&quot;.</span>
                    </li>
                    <li className="flex items-start gap-2.5">
                      <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[11px] font-bold text-white" style={{ backgroundImage: "var(--brand-gradient)" }}>3</span>
                      <span className="text-[13px]" style={{ color: "var(--text-main)" }}>Confirm by tapping &quot;Add&quot; or &quot;Install&quot;.</span>
                    </li>
                  </ol>
                </div>
              )}
            </div>
          </div>
        </div>,
        document.body,
      )}

      {/* Phone: the open section's own page, sliding in over this one under the bar above. Notifications'
          categories slide in over it in turn (its pageRef is this page). */}
      <SlideOverPane {...sectionSlide} topClass="top-[92px]">
        <div className="space-y-4">
          {renderSectionTitle(sectionSlide.openId, sectionSlide.openId === "checklists" ? checklistsHelp : undefined)}
          {sectionSlide.openId === "general" ? (
            phoneGeneral
          ) : sectionSlide.openId === "preferences" ? (
            phonePreferences
          ) : sectionSlide.openId === "notifications" ? (
            <PushNotificationSettings
              uid={String(user?.uid || "")}
              cardStyle={glassCardStyle}
              Toggle={SettingsToggleSwitch}
              pageRef={sectionSlide.paneRef}
              layout="rows"
              initialSearch={notificationsSearch}
            />
          ) : sectionSlide.openId === "checklists" ? (
            phoneChecklists
          ) : null}
        </div>
      </SlideOverPane>
      <SlideOverPane {...checklistSlide} topClass="top-[92px]" zIndexClass="z-[30]">
        {checklistPage}
      </SlideOverPane>

      <SidebarColorPickerPopover
        isOpen={isColorPopoverOpen}
        anchorRect={colorPopoverAnchor}
        currentColor={effectiveColor}
        onSelect={(hex) => {
          setUserColor(hex);
          queueAutoSave();
        }}
        onUseCompanyDefault={() => {
          void applyCompanyDefault();
          setIsColorPopoverOpen(false);
        }}
        onClose={() => setIsColorPopoverOpen(false)}
      />
    </div>
  );
}
