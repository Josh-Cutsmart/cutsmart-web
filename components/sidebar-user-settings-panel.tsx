"use client";

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Check, ChevronDown, LogOut, MailCheck, Pencil, Settings } from "lucide-react";
import { useAuth } from "@/lib/auth-context";
import { fetchCompanyAccess, fetchPrimaryMembership } from "@/lib/membership";
import { fetchCompanyDoc, fetchProjects, saveUserProfilePatchDetailed } from "@/lib/firestore-data";
import { readThemeMode, saveThemeMode, type ThemeMode } from "@/lib/theme-mode";
import { dispatchUserColorUpdated } from "@/lib/user-color-sync";
import { contrastTextForFill, labelFromRoleKey, normalizeRoleKey } from "@/lib/user-profile-format";
import { SidebarColorPickerPopover, type ColorPickerAnchorRect } from "@/components/sidebar-color-picker-popover";
import { VerifyAccountModal } from "@/components/verify-account-modal";
import { captureGlassModalOrigin, type GlassModalOrigin } from "@/lib/use-glass-modal-pop-origin";

const ACTIVE_COMPANY_STORAGE_KEY = "cutsmart_active_company_id";
const ACTIVE_COMPANY_THEME_COLOR_STORAGE_KEY = "cutsmart_active_company_theme_color";

function initials(name: string) {
  const parts = String(name || "").trim().split(/\s+/).filter(Boolean).slice(0, 2);
  return parts.map((part) => part[0]?.toUpperCase() ?? "").join("") || "CU";
}

export function SidebarUserSettingsPanel({
  isOpen,
  onRequestClose,
  onRequestLogout,
}: {
  isOpen: boolean;
  onRequestClose: () => void;
  onRequestLogout: (e: React.MouseEvent<HTMLButtonElement>) => void;
}) {
  const router = useRouter();
  const { user, setUserColorLocal, setUserProfileLocal } = useAuth();
  const [companyColor, setCompanyColor] = useState("#2F6BFF");
  const [userColor, setUserColor] = useState(user?.userColor || "");
  const [mobile, setMobile] = useState(user?.mobile || "");
  const [displayName, setDisplayName] = useState(user?.displayName || "");
  const [resolvedCompanyId, setResolvedCompanyId] = useState("");
  const [companyName, setCompanyName] = useState("");
  const [companyRoleLabel, setCompanyRoleLabel] = useState("");
  const [companyRoleColor, setCompanyRoleColor] = useState("");
  const [themeMode, setThemeMode] = useState<ThemeMode>("light");
  const [isMobileEditing, setIsMobileEditing] = useState(false);
  const [mobileDraft, setMobileDraft] = useState("");
  const [isNameEditing, setIsNameEditing] = useState(false);
  const [nameDraft, setNameDraft] = useState("");
  const [isColorPopoverOpen, setIsColorPopoverOpen] = useState(false);
  const [colorPopoverAnchor, setColorPopoverAnchor] = useState<ColorPickerAnchorRect | null>(null);
  const [isVerifyBoxOpen, setIsVerifyBoxOpen] = useState(false);
  const [verifyModalOrigin, setVerifyModalOrigin] = useState<GlassModalOrigin>(null);

  const autoSaveTimerRef = useRef<number | null>(null);
  const pendingSaveRef = useRef(false);
  const isSavingRef = useRef(false);
  const lastSavedSnapshotRef = useRef("");
  const hasLoadedRef = useRef(false);
  const emblemSwatchRef = useRef<HTMLButtonElement | null>(null);

  // queueAutoSave schedules saveProfile to run ~180ms later via setTimeout, but a
  // plain closure over userColor/mobile/displayName would freeze whatever those
  // were AT THE MOMENT queueAutoSave was called — which is always one state update
  // stale, since setUserColor(x)/queueAutoSave() run synchronously back-to-back in
  // the same event handler, before React has re-rendered with the new value. That
  // staleness is what made a freshly-picked color (or "Use Company Default")
  // silently get overwritten back to the previous value once the debounced save
  // fired. Syncing refs in a layout effect (rather than during render) keeps them
  // current well before the 180ms debounce ever fires, regardless of which
  // render's closure ends up calling saveProfile.
  const userColorRef = useRef(userColor);
  const mobileRef = useRef(mobile);
  const displayNameRef = useRef(displayName);
  useLayoutEffect(() => {
    userColorRef.current = userColor;
    mobileRef.current = mobile;
    displayNameRef.current = displayName;
  }, [userColor, mobile, displayName]);

  useEffect(() => {
    // Mirrors user-settings/page.tsx's identical prop-sync pattern.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setUserColor(user?.userColor || "");
  }, [user?.userColor]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setMobile(user?.mobile || "");
  }, [user?.mobile]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setDisplayName(user?.displayName || "");
  }, [user?.displayName]);

  useEffect(() => {
    lastSavedSnapshotRef.current = JSON.stringify({
      userColor: String(user?.userColor || "").trim(),
      mobile: String(user?.mobile || "").trim(),
      displayName: String(user?.displayName || "").trim(),
    });
  }, [user?.mobile, user?.userColor, user?.displayName]);

  useEffect(() => {
    // Client-only theme read (avoids SSR hydration mismatch), same as user-settings/page.tsx.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setThemeMode(readThemeMode());
  }, []);

  useEffect(() => {
    if (!isOpen || hasLoadedRef.current) return;
    hasLoadedRef.current = true;
    const load = async () => {
      const storedCompanyId =
        typeof window !== "undefined" ? String(window.localStorage.getItem(ACTIVE_COMPANY_STORAGE_KEY) || "").trim() : "";
      const storedThemeColor =
        typeof window !== "undefined"
          ? String(window.localStorage.getItem(ACTIVE_COMPANY_THEME_COLOR_STORAGE_KEY) || "").trim()
          : "";
      const directCompanyId = String(user?.companyId || "").trim();
      const fallbackMembership = !directCompanyId && user?.uid ? await fetchPrimaryMembership(user.uid) : null;
      const membershipCompanyId = String(fallbackMembership?.companyId || "").trim();

      const candidateIds = new Set<string>();
      if (storedCompanyId) candidateIds.add(storedCompanyId);
      if (directCompanyId) candidateIds.add(directCompanyId);
      if (membershipCompanyId) candidateIds.add(membershipCompanyId);
      if (process.env.NEXT_PUBLIC_DEFAULT_COMPANY_ID) candidateIds.add(String(process.env.NEXT_PUBLIC_DEFAULT_COMPANY_ID).trim());
      candidateIds.add("cmp_mykm_91647c");

      if (user?.uid) {
        try {
          const projects = await fetchProjects(user.uid);
          for (const project of projects) {
            const cid = String(project.companyId || "").trim();
            if (cid) candidateIds.add(cid);
          }
        } catch {
          // ignore project fallback errors
        }
      }

      if (/^#[0-9A-Fa-f]{6}$/.test(storedThemeColor)) {
        setCompanyColor(storedThemeColor);
      }

      let resolvedId = "";
      let resolvedRoles: unknown[] = [];
      for (const cid of candidateIds) {
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
          const access = await fetchCompanyAccess(resolvedId, user.uid);
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
  }, [isOpen, user?.companyId, user?.role, user?.uid]);

  const effectiveColor = useMemo(() => String(userColor || "").trim() || companyColor, [userColor, companyColor]);
  const activeDisplayName = String(displayName || user?.displayName || "CutSmart User").trim() || "CutSmart User";
  const profileInitials = initials(activeDisplayName);

  const saveProfile = async () => {
    const uid = String(user?.uid || "").trim();
    const companyId = String(resolvedCompanyId || user?.companyId || "").trim();
    if (!uid) return;
    if (isSavingRef.current) {
      pendingSaveRef.current = true;
      return;
    }
    const normalized = {
      userColor: String(userColorRef.current || "").trim(),
      mobile: String(mobileRef.current || "").trim(),
      displayName: String(displayNameRef.current || "").trim(),
    };
    const nextSnapshot = JSON.stringify(normalized);
    if (nextSnapshot === lastSavedSnapshotRef.current) return;

    isSavingRef.current = true;
    const result = await saveUserProfilePatchDetailed(uid, companyId, normalized);
    if (result.ok) {
      setUserColorLocal(normalized.userColor);
      setUserProfileLocal(normalized);
      lastSavedSnapshotRef.current = nextSnapshot;
      dispatchUserColorUpdated({ uid, color: normalized.userColor, companyId: companyId || undefined });
    }
    isSavingRef.current = false;

    if (pendingSaveRef.current) {
      pendingSaveRef.current = false;
      void saveProfile();
    }
  };

  const queueAutoSave = () => {
    if (autoSaveTimerRef.current) window.clearTimeout(autoSaveTimerRef.current);
    autoSaveTimerRef.current = window.setTimeout(() => {
      autoSaveTimerRef.current = null;
      void saveProfile();
    }, 180);
  };

  useEffect(() => {
    return () => {
      if (autoSaveTimerRef.current) window.clearTimeout(autoSaveTimerRef.current);
    };
  }, []);

  // companyColor is already correctly resolved by the load() effect above by the
  // time this panel (and its color popover) can even be open, so re-deriving it
  // here from a possibly-stale localStorage cache or a redundant re-fetch (the
  // previous implementation) only risked landing on the wrong color, and the
  // async gap made it visibly slower/less reliable than a tile click, which
  // updates userColor synchronously. Just clear the override and let
  // effectiveColor fall back to the already-known-good companyColor immediately.
  const applyCompanyDefault = () => {
    setUserColor("");
    setUserColorLocal("");
    queueAutoSave();
  };

  const onSelectThemeMode = (mode: ThemeMode) => {
    setThemeMode(mode);
    saveThemeMode(mode);
  };

  const isDarkMode = themeMode === "dark";

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

  return (
    <div className="flex h-full flex-col pt-1">
      <div className="grid grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center px-1">
        <span aria-hidden="true" />
        <button
          type="button"
          onClick={onRequestClose}
          className="inline-flex h-7 w-7 shrink-0 items-center justify-center justify-self-center rounded-[8px] transition hover:bg-[var(--panel-muted)]"
          style={{ color: "var(--text-muted)" }}
          aria-label="Back"
          title="Collapse"
        >
          <ChevronDown size={16} />
        </button>
        <div className="mr-2 flex items-center justify-self-end gap-1">
          <button
            type="button"
            onClick={() => router.push("/user-settings")}
            className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-[8px] transition hover:bg-[var(--panel-muted)]"
            style={{ color: "var(--text-muted)" }}
            aria-label="User Settings"
            title="User Settings"
          >
            <Settings size={16} />
          </button>
          <button
            type="button"
            onClick={onRequestLogout}
            className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-[8px] transition hover:bg-[var(--panel-muted)]"
            style={{ color: "var(--text-muted)" }}
            aria-label="Log out"
            title="Log out"
          >
            <LogOut size={14} />
          </button>
        </div>
      </div>

      <div className="mt-1 flex flex-col items-center text-center">
        <div className="group relative">
          <div
            className="inline-flex h-20 w-20 items-center justify-center rounded-full text-[26px] font-extrabold text-white"
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
            className="absolute inset-0 flex h-20 w-20 items-center justify-center rounded-full opacity-0 transition-opacity group-hover:opacity-100"
            style={{ backgroundColor: "rgba(0,0,0,0.45)" }}
          >
            <Pencil size={20} color="#ffffff" />
          </button>
        </div>
        <div className="mt-3 flex h-8 items-center justify-center">
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
                className="h-8 w-[150px] rounded-[8px] border px-2 text-center text-[16px] font-extrabold outline-none"
                style={{ borderColor: "var(--glass-border)", backgroundColor: "var(--panel-bg)", color: "var(--text-main)" }}
              />
              <button
                type="button"
                onMouseDown={(e) => e.preventDefault()}
                onClick={commitNameEdit}
                className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-[8px] border"
                style={{ borderColor: "var(--brand-strong)", backgroundColor: "var(--brand-soft)", color: "var(--brand-strong)" }}
                aria-label="Save name"
              >
                <Check size={16} />
              </button>
            </div>
          ) : (
            <div className="group relative inline-flex max-w-full items-center">
              <p className="truncate text-[16px] font-extrabold leading-tight" style={{ color: "var(--text-main)" }}>
                {activeDisplayName}
              </p>
              <button
                type="button"
                onClick={startEditingName}
                className="absolute left-full ml-1.5 inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-[6px] opacity-0 transition-opacity group-hover:opacity-100 hover:bg-[var(--panel-muted)]"
                style={{ color: "var(--text-muted)" }}
                aria-label="Edit name"
              >
                <Pencil size={12} />
              </button>
            </div>
          )}
        </div>
      </div>

      <div className="mt-3 flex items-center justify-center gap-4">
        <button
          type="button"
          role="switch"
          aria-checked={isDarkMode}
          aria-label={`Theme mode: ${isDarkMode ? "Dark" : "Light"}`}
          onClick={() => onSelectThemeMode(isDarkMode ? "light" : "dark")}
          className="relative inline-flex h-8 w-[112px] items-center rounded-[999px] border p-1 transition-colors"
          style={{
            borderColor: isDarkMode ? "var(--brand-strong)" : "var(--glass-border)",
            backgroundImage: isDarkMode ? "var(--brand-gradient)" : "none",
            backgroundColor: isDarkMode ? undefined : "var(--panel-bg)",
          }}
        >
          <span
            className="absolute left-1 top-[2px] h-[25px] w-[52px] rounded-[999px] transition-transform"
            style={{
              transform: isDarkMode ? "translateX(52px)" : "translateX(0px)",
              backgroundColor: "var(--panel-bg)",
              border: "1px solid var(--glass-border)",
              boxShadow: "var(--shadow-glass)",
            }}
          />
          <div className="relative z-10 grid w-full grid-cols-2 text-[11px] font-bold">
            <span className="text-center" style={{ color: isDarkMode ? "#ffffff" : "var(--brand-strong)", transition: "color 140ms ease" }}>Light</span>
            <span className="text-center" style={{ color: isDarkMode ? "#ffffff" : "var(--text-muted)", transition: "color 140ms ease", transform: "translateX(3px)" }}>Dark</span>
          </div>
        </button>
      </div>

      <div className="mt-3 mb-3 space-y-3">
        <div className="border px-3 py-2.5" style={{ borderColor: "var(--glass-border)", backgroundColor: "var(--panel-muted)" }}>
          <p className="text-[10px] font-bold uppercase tracking-[0.9px]" style={{ color: "var(--text-muted)" }}>Company</p>
          <p className="mt-1 truncate text-[13px] font-semibold" style={{ color: "var(--text-main)" }}>{companyName || "-"}</p>
          {(companyRoleLabel || user?.role) ? (
            <div className="mt-2 flex items-center gap-2">
              <p className="text-[10px] font-bold uppercase tracking-[0.9px]" style={{ color: "var(--text-muted)" }}>Role</p>
              <span
                className="inline-flex shrink-0 items-center rounded-full px-2 py-0.5 text-[10px] font-bold"
                style={{ backgroundColor: companyRoleColor || "#7D99B3", color: contrastTextForFill(companyRoleColor || "#7D99B3") }}
              >
                {companyRoleLabel || user?.role}
              </span>
            </div>
          ) : null}
        </div>

        <div className="group border px-3 py-2.5" style={{ borderColor: "var(--glass-border)", backgroundColor: "var(--panel-muted)" }}>
          <p className="text-[10px] font-bold uppercase tracking-[0.9px]" style={{ color: "var(--text-muted)" }}>Mobile</p>
          <div className="mt-1 flex h-7 items-center justify-between gap-2">
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
                  className="h-7 min-w-0 flex-1 rounded-[8px] border px-2 text-[13px] outline-none"
                  style={{ borderColor: "var(--glass-border)", backgroundColor: "var(--panel-bg)", color: "var(--text-main)" }}
                />
                <button
                  type="button"
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={commitMobileEdit}
                  className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-[8px] border"
                  style={{ borderColor: "var(--brand-strong)", backgroundColor: "var(--brand-soft)", color: "var(--brand-strong)" }}
                  aria-label="Save mobile number"
                >
                  <Check size={14} />
                </button>
              </>
            ) : (
              <>
                <p className="truncate text-[13px] font-semibold" style={{ color: "var(--text-main)" }}>{mobile || "-"}</p>
                <button
                  type="button"
                  onClick={startEditingMobile}
                  className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-[6px] opacity-0 transition-opacity group-hover:opacity-100 hover:bg-[var(--panel-bg)]"
                  style={{ color: "var(--text-muted)" }}
                  aria-label="Edit mobile number"
                >
                  <Pencil size={12} />
                </button>
              </>
            )}
          </div>
        </div>

        <div
          className="border px-3 py-2.5"
          style={{ borderColor: "var(--glass-border)", backgroundColor: "var(--panel-muted)" }}
        >
          <div className="flex items-center justify-between gap-2" title="Contact an admin to change your email">
            <p className="text-[10px] font-bold uppercase tracking-[0.9px]" style={{ color: "var(--text-muted)" }}>Email</p>
            {user?.verified ? (
              <span
                className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[9px] font-bold uppercase tracking-[0.6px]"
                style={{ backgroundColor: "#E7F6EC", color: "#1E7A34" }}
              >
                <Check size={9} strokeWidth={3} />
                Verified
              </span>
            ) : (
              <button
                type="button"
                onClick={(e) => {
                  setVerifyModalOrigin(captureGlassModalOrigin(e));
                  setIsVerifyBoxOpen(true);
                }}
                className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[9px] font-bold uppercase tracking-[0.6px]"
                style={{ backgroundColor: "var(--danger-soft)", color: "var(--danger-strong)" }}
              >
                <MailCheck size={9} />
                Unverified
              </button>
            )}
          </div>
          <p className="mt-1 truncate text-[13px] font-semibold" style={{ color: "var(--text-main)" }}>{user?.email || "-"}</p>
        </div>
      </div>

      <VerifyAccountModal
        open={isVerifyBoxOpen}
        origin={verifyModalOrigin}
        onClose={() => setIsVerifyBoxOpen(false)}
      />

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
