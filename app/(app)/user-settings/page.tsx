"use client";

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Building2, Mail, Palette, ShieldCheck, Smartphone, UserCog } from "lucide-react";
import { useAuth } from "@/lib/auth-context";
import { fetchCompanyDoc, fetchProjects, saveUserProfilePatchDetailed } from "@/lib/firestore-data";
import { fetchCompanyAccess, fetchPrimaryMembership } from "@/lib/membership";
import { readThemeMode, saveThemeMode, type ThemeMode } from "@/lib/theme-mode";
import { dispatchUserColorUpdated } from "@/lib/user-color-sync";
import { contrastTextForFill, labelFromRoleKey, normalizeRoleKey } from "@/lib/user-profile-format";

const ACTIVE_COMPANY_STORAGE_KEY = "cutsmart_active_company_id";
const ACTIVE_COMPANY_THEME_COLOR_STORAGE_KEY = "cutsmart_active_company_theme_color";

export default function UserSettingsPage() {
  const router = useRouter();
  const { user, setUserColorLocal, setUserProfileLocal } = useAuth();
  const [companyColor, setCompanyColor] = useState("#2F6BFF");
  const [displayName, setDisplayName] = useState(user?.displayName || "");
  const [userColor, setUserColor] = useState(user?.userColor || "");
  const [mobile, setMobile] = useState(user?.mobile || "");
  const [isSaving, setIsSaving] = useState(false);
  const [saveMsg, setSaveMsg] = useState("");
  const [resolvedCompanyId, setResolvedCompanyId] = useState("");
  const [companyName, setCompanyName] = useState("");
  const [companyRoleLabel, setCompanyRoleLabel] = useState("");
  const [companyRoleColor, setCompanyRoleColor] = useState("");
  const [themeSource, setThemeSource] = useState("unknown");
  const [themeMode, setThemeMode] = useState<ThemeMode>("light");
  const autoSaveTimerRef = useRef<number | null>(null);
  const pendingSaveRef = useRef(false);
  const isSavingRef = useRef(false);
  const lastSavedSnapshotRef = useRef("");

  // queueAutoSave's setTimeout closure freezes displayName/userColor/mobile at
  // whatever they were when it was scheduled — one render stale whenever a setter
  // and queueAutoSave() are called back-to-back in the same handler (e.g. the
  // native color input's onChange, or applyCompanyDefault), since React hasn't
  // re-rendered yet at that point. Syncing refs in a layout effect (rather than
  // during render) keeps them current well before the 180ms debounce ever fires.
  const displayNameRef = useRef(displayName);
  const userColorRef = useRef(userColor);
  const mobileRef = useRef(mobile);
  useLayoutEffect(() => {
    displayNameRef.current = displayName;
    userColorRef.current = userColor;
    mobileRef.current = mobile;
  }, [displayName, userColor, mobile]);

  const profileSnapshot = useMemo(
    () =>
      JSON.stringify({
        displayName: String(displayName || "").trim(),
        userColor: String(userColor || "").trim(),
        mobile: String(mobile || "").trim(),
      }),
    [displayName, mobile, userColor],
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
    isSavingRef.current = isSaving;
  }, [isSaving]);

  useEffect(() => {
    lastSavedSnapshotRef.current = JSON.stringify({
      displayName: String(user?.displayName || "").trim(),
      userColor: String(user?.userColor || "").trim(),
      mobile: String(user?.mobile || "").trim(),
    });
  }, [user?.displayName, user?.mobile, user?.userColor]);

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
        setThemeSource("company-settings-cache");
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
          setThemeSource("company-doc");
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
  const saveStatusTone = isSaving ? "#8ab4f8" : profileDirty ? "#B54708" : "#027A48";
  const companyColorSourceLabel =
    themeSource === "company-doc"
      ? "Live company color"
      : themeSource === "company-settings-cache"
        ? "Cached company color"
        : "Default company color";

  const glassCardStyle = {
    borderColor: "var(--glass-border)",
    backgroundColor: "var(--glass-bg-strong)",
    backdropFilter: "blur(20px) saturate(180%)",
    WebkitBackdropFilter: "blur(20px) saturate(180%)",
    boxShadow: "var(--shadow-glass)",
  } as const;

  return (
    <div className="space-y-4">
      <div className="glass-page-header -mx-4 -mt-4 flex h-[56px] shrink-0 items-center justify-between px-4 md:-mx-5 md:px-5">
        <div className="flex min-w-0 items-center gap-5">
          <div className="flex min-w-0 items-center gap-2">
            <UserCog size={16} style={{ color: "var(--text-main)" }} strokeWidth={2.1} />
            <p className="truncate text-[14px] font-bold uppercase tracking-[1px]" style={{ color: "var(--text-main)" }}>
              User Settings
            </p>
            <span className="text-[14px] font-medium" style={{ color: "var(--text-muted)" }}>|</span>
            <p className="truncate text-[14px] font-medium" style={{ color: "var(--text-main)" }}>
              {activeDisplayName}
            </p>
          </div>
          <div
            className="inline-flex shrink-0 items-center gap-2 rounded-full border px-3 py-1 text-[11px] font-bold"
            style={{ borderColor: "var(--glass-border)", backgroundColor: "var(--panel-muted)", color: saveStatusTone }}
          >
            <span className="inline-flex h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: saveStatusTone }} />
            {saveStatusLabel}
          </div>
        </div>
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
      </div>

      <div className="grid gap-5 xl:grid-cols-[320px_minmax(0,1fr)]">
        <aside className="rounded-[18px] border p-5" style={glassCardStyle}>
          <div className="flex flex-col items-center text-center">
            <div
              className="inline-flex h-24 w-24 items-center justify-center rounded-full text-[30px] font-extrabold text-white"
              style={{ backgroundColor: effectiveColor, boxShadow: "var(--shadow-glass)" }}
            >
              {profileInitials}
            </div>
            <h2 className="mt-4 text-[20px] font-extrabold leading-tight" style={{ color: "var(--text-main)" }}>
              {activeDisplayName}
            </h2>
            <p className="mt-1 flex items-center gap-1.5 text-[13px] font-medium" style={{ color: "var(--text-muted)" }}>
              <Mail size={13} />
              {user?.email || "-"}
            </p>
            <div className="mt-4 flex flex-wrap items-center justify-center gap-2">
              <span
                className="inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-[11px] font-bold uppercase tracking-[0.8px]"
                style={{ borderColor: "var(--glass-border)", backgroundColor: "var(--panel-muted)", color: "var(--text-main)" }}
              >
                <ShieldCheck size={12} />
                {user?.role || "User"}
              </span>
            </div>
          </div>

          <div className="mt-6 space-y-3">
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
            <div className="rounded-[14px] border px-4 py-3" style={{ borderColor: "var(--glass-border)", backgroundColor: "var(--panel-muted)" }}>
              <p className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-[0.9px]" style={{ color: "var(--text-muted)" }}>
                <Smartphone size={11} />
                Mobile
              </p>
              <p className="mt-1 text-[14px] font-semibold" style={{ color: "var(--text-main)" }}>{mobile || "-"}</p>
            </div>
            <div className="rounded-[14px] border px-4 py-3" style={{ borderColor: "var(--glass-border)", backgroundColor: "var(--panel-muted)" }}>
              <div className="flex items-center justify-between gap-2">
                <p className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-[0.9px]" style={{ color: "var(--text-muted)" }}>
                  <Palette size={11} />
                  Emblem Color
                </p>
                <span className="inline-flex h-5 w-5 shrink-0 rounded-full border" style={{ backgroundColor: effectiveColor, borderColor: "var(--glass-border)" }} />
              </div>
              <p className="mt-1 text-[13px] font-semibold" style={{ color: "var(--text-main)" }}>{effectiveColor}</p>
            </div>
          </div>
        </aside>

        <div className="space-y-5">
          <div className="rounded-[18px] border p-5" style={glassCardStyle}>
            <div className="mb-5">
              <h3 className="text-[15px] font-extrabold uppercase tracking-[1px]" style={{ color: "var(--text-main)" }}>
                Profile Details
              </h3>
              <p className="mt-1 text-[12px]" style={{ color: "var(--text-muted)" }}>
                Update how your information appears across the app. Changes save automatically when you finish editing.
              </p>
            </div>
            <div className="grid gap-4 md:grid-cols-2">
              <label className="block">
                <span className="mb-2 block text-[11px] font-bold uppercase tracking-[0.9px]" style={{ color: "var(--text-muted)" }}>Display Name</span>
                <input
                  value={displayName}
                  onChange={(e) => setDisplayName(e.target.value)}
                  onBlur={() => queueAutoSave()}
                  placeholder="Enter your name"
                  className="h-11 w-full rounded-[10px] border px-3 text-[13px] outline-none"
                  style={{ borderColor: "var(--glass-border)", backgroundColor: "var(--panel-bg)", color: "var(--text-main)" }}
                />
              </label>
              <label className="block">
                <span className="mb-2 block text-[11px] font-bold uppercase tracking-[0.9px]" style={{ color: "var(--text-muted)" }}>Mobile Number</span>
                <input
                  value={mobile}
                  onChange={(e) => setMobile(e.target.value)}
                  onBlur={() => queueAutoSave()}
                  placeholder="Enter mobile number"
                  className="h-11 w-full rounded-[10px] border px-3 text-[13px] outline-none"
                  style={{ borderColor: "var(--glass-border)", backgroundColor: "var(--panel-bg)", color: "var(--text-main)" }}
                />
              </label>
              <div className="rounded-[10px] border px-4 py-3" style={{ borderColor: "var(--glass-border)", backgroundColor: "var(--panel-muted)" }}>
                <p className="text-[11px] font-bold uppercase tracking-[0.9px]" style={{ color: "var(--text-muted)" }}>Email</p>
                <p className="mt-2 text-[14px] font-semibold" style={{ color: "var(--text-main)" }}>{user?.email || "-"}</p>
              </div>
              <div className="rounded-[10px] border px-4 py-3" style={{ borderColor: "var(--glass-border)", backgroundColor: "var(--panel-muted)" }}>
                <p className="text-[11px] font-bold uppercase tracking-[0.9px]" style={{ color: "var(--text-muted)" }}>Role</p>
                <p className="mt-2 text-[14px] font-semibold" style={{ color: "var(--text-main)" }}>{user?.role || "-"}</p>
              </div>
            </div>
          </div>

          <div className="rounded-[18px] border p-5" style={glassCardStyle}>
            <div className="mb-5">
              <h3 className="text-[15px] font-extrabold uppercase tracking-[1px]" style={{ color: "var(--text-main)" }}>
                Appearance
              </h3>
              <p className="mt-1 text-[12px]" style={{ color: "var(--text-muted)" }}>
                Personalize your emblem color and the theme on this device.
              </p>
            </div>

            <div className="rounded-[14px] border p-4" style={{ borderColor: "var(--glass-border)", backgroundColor: "var(--panel-muted)" }}>
              <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                <div className="min-w-0">
                  <p className="text-[12px] font-bold" style={{ color: "var(--text-main)" }}>User Emblem Color</p>
                  <p className="mt-1 text-[11px]" style={{ color: "var(--text-muted)" }}>
                    Leave the value blank to inherit the company color.
                  </p>
                </div>
                <div className="inline-flex items-center gap-3 rounded-[12px] border px-3 py-3" style={{ borderColor: "var(--glass-border)", backgroundColor: "var(--panel-bg)" }}>
                  <div
                    className="inline-flex h-9 w-9 items-center justify-center rounded-full text-[13px] font-extrabold text-white"
                    style={{ backgroundColor: effectiveColor }}
                  >
                    {profileInitials}
                  </div>
                  <div className="min-w-0">
                    <p className="truncate text-[12px] font-bold" style={{ color: "var(--text-main)" }}>{activeDisplayName}</p>
                    <p className="truncate text-[11px]" style={{ color: "var(--text-muted)" }}>{companyColorSourceLabel}</p>
                  </div>
                </div>
              </div>
              <div className="mt-4 flex flex-col gap-3 xl:flex-row xl:items-center">
                <input
                  type="color"
                  value={/^#[0-9A-Fa-f]{6}$/.test(userColor) ? userColor : effectiveColor}
                  onChange={(e) => {
                    setUserColor(e.target.value);
                    queueAutoSave();
                  }}
                  className="h-11 w-14 cursor-pointer rounded-[10px] border p-1"
                  style={{ borderColor: "var(--glass-border)", backgroundColor: "var(--panel-bg)" }}
                />
                <input
                  value={userColor}
                  onChange={(e) => setUserColor(e.target.value)}
                  onBlur={() => queueAutoSave()}
                  placeholder="Leave blank to use company color"
                  className="h-11 w-full rounded-[10px] border px-3 text-[13px] outline-none xl:max-w-[320px]"
                  style={{ borderColor: "var(--glass-border)", backgroundColor: "var(--panel-bg)", color: "var(--text-main)" }}
                />
                <button
                  type="button"
                  onClick={() => void applyCompanyDefault()}
                  className="h-11 rounded-[10px] border px-4 text-[12px] font-bold transition hover:brightness-95"
                  style={{ borderColor: "var(--glass-border)", backgroundColor: "var(--panel-bg)", color: "var(--text-main)" }}
                >
                  Use Company Default
                </button>
              </div>
            </div>

            <div className="mt-4 rounded-[14px] border p-4" style={{ borderColor: "var(--glass-border)", backgroundColor: "var(--panel-muted)" }}>
              <p className="text-[12px] font-bold" style={{ color: "var(--text-main)" }}>App Theme</p>
              <p className="mt-1 text-[11px]" style={{ color: "var(--text-muted)" }}>
                Applies only on this device for your app.
              </p>
              <div className="mt-4 flex flex-wrap items-center gap-4">
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
                <div className="flex items-center gap-2 rounded-[10px] border px-3 py-2" style={{ borderColor: "var(--glass-border)", backgroundColor: "var(--panel-bg)" }}>
                  <span className="inline-flex h-3 w-3 rounded-full" style={{ backgroundColor: isDarkMode ? "#0f0f0f" : "#ffffff", border: "1px solid var(--glass-border)" }} />
                  <span className="text-[12px] font-semibold" style={{ color: "var(--text-main)" }}>
                    {isDarkMode ? "Dark theme active" : "Light theme active"}
                  </span>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
