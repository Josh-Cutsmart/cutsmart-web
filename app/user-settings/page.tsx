"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { UserCog } from "lucide-react";
import { AppShell } from "@/components/app-shell";
import { ProtectedRoute } from "@/components/protected-route";
import { useAuth } from "@/lib/auth-context";
import { fetchCompanyDoc, fetchProjects, saveUserProfilePatchDetailed } from "@/lib/firestore-data";
import { fetchPrimaryMembership } from "@/lib/membership";
import { readThemeMode, saveThemeMode, type ThemeMode } from "@/lib/theme-mode";
import { dispatchUserColorUpdated } from "@/lib/user-color-sync";

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
  const [themeSource, setThemeSource] = useState("unknown");
  const [themeMode, setThemeMode] = useState<ThemeMode>("light");
  const autoSaveTimerRef = useRef<number | null>(null);
  const pendingSaveRef = useRef(false);
  const isSavingRef = useRef(false);
  const lastSavedSnapshotRef = useRef("");

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
      for (const cid of candidateIds) {
        if (!cid) continue;
        const doc = await fetchCompanyDoc(cid);
        if (!doc) continue;
        resolvedId = cid;
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
    };
    void load();
  }, [user?.companyId, user?.uid]);

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
      displayName: String(displayName || "").trim(),
      userColor: String(userColor || "").trim(),
      mobile: String(mobile || "").trim(),
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

  const applyCompanyDefault = async () => {
    const storedThemeColor =
      typeof window !== "undefined" ? String(window.localStorage.getItem(ACTIVE_COMPANY_THEME_COLOR_STORAGE_KEY) || "").trim() : "";
    if (/^#[0-9A-Fa-f]{6}$/.test(storedThemeColor)) {
      setCompanyColor(storedThemeColor);
      setUserColor("");
      setUserColorLocal("");
      queueAutoSave();
      return;
    }
    const storedCompanyId =
      typeof window !== "undefined" ? String(window.localStorage.getItem(ACTIVE_COMPANY_STORAGE_KEY) || "").trim() : "";
    const companyId = String(storedCompanyId || resolvedCompanyId || user?.companyId || "").trim();
    if (companyId) {
      const doc = await fetchCompanyDoc(companyId);
      const themeColor = String((doc as Record<string, unknown> | null)?.themeColor ?? "").trim();
      if (themeColor) {
        setCompanyColor(themeColor);
      }
    }
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

  const pagePalette = isDarkMode
    ? {
        pageBg: "#0f0f0f",
        panelBg: "#212121",
        panelMuted: "#272727",
        border: "#3f3f46",
        text: "#f1f1f1",
        textMuted: "#aaaaaa",
        inputBg: "#303134",
      }
    : {
        pageBg: "#ffffff",
        panelBg: "#ffffff",
        panelMuted: "#F8FAFC",
        border: "#D8DEE8",
        text: "#0F172A",
        textMuted: "#667085",
        inputBg: "#ffffff",
      };

  return (
    <ProtectedRoute>
      <AppShell>
        <section className="-mx-4 -mb-4 -mt-4 min-h-screen pb-6 pt-0 md:-mx-5" style={{ backgroundColor: pagePalette.pageBg, color: pagePalette.text }}>
          <div className="flex h-[56px] flex-wrap items-center justify-between gap-2 border-b border-[#D7DEE8] bg-white px-4 md:px-5" style={{ borderColor: pagePalette.border, backgroundColor: pagePalette.panelBg }}>
            <div className="inline-flex items-center gap-2">
              <UserCog size={16} color={isDarkMode ? "#f1f1f1" : "#12345B"} strokeWidth={2.1} />
              <p className="text-[14px] font-medium uppercase tracking-[1px]" style={{ color: isDarkMode ? "#f1f1f1" : "#12345B" }}>
                User Settings
              </p>
            </div>
            <button
              type="button"
              disabled={isSaving}
              onClick={async () => {
                await saveProfile("manual");
                router.push("/dashboard");
              }}
              className="inline-flex h-9 items-center rounded-[10px] border px-3 text-[12px] font-bold disabled:opacity-55"
              style={{ borderColor: pagePalette.border, backgroundColor: pagePalette.inputBg, color: pagePalette.text }}
            >
              {isSaving ? "Saving..." : "Save & Back"}
            </button>
          </div>

          <div className="px-4 py-5 md:px-5">
            <div
              className="mb-5 rounded-[20px] border px-5 py-5"
              style={{
                borderColor: pagePalette.border,
                background: isDarkMode ? "linear-gradient(135deg, #18181b 0%, #232329 100%)" : "linear-gradient(135deg, #F7FAFF 0%, #EEF4FB 100%)",
              }}
            >
              <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
                <div className="max-w-[720px]">
                  <p className="text-[11px] font-bold uppercase tracking-[1.2px]" style={{ color: pagePalette.textMuted }}>Account</p>
                  <h1 className="mt-2 text-[28px] font-extrabold leading-tight" style={{ color: pagePalette.text }}>
                    User Settings
                  </h1>
                  <p className="mt-2 text-[13px] leading-[1.7]" style={{ color: pagePalette.textMuted }}>
                    Manage your profile details, emblem color, and device theme preferences in one place.
                  </p>
                </div>
                <div
                  className="inline-flex items-center gap-2 self-start rounded-full border px-3 py-2 text-[12px] font-bold"
                  style={{ borderColor: pagePalette.border, backgroundColor: pagePalette.panelBg, color: saveStatusTone }}
                >
                  <span className="inline-flex h-2.5 w-2.5 rounded-full" style={{ backgroundColor: saveStatusTone }} />
                  {saveStatusLabel}
                </div>
              </div>
            </div>

            <div className="grid gap-5 xl:grid-cols-[320px_minmax(0,1fr)]">
              <aside className="rounded-[20px] border p-5" style={{ borderColor: pagePalette.border, backgroundColor: pagePalette.panelBg }}>
                <div className="flex flex-col items-center text-center">
                  <div
                    className="inline-flex h-24 w-24 items-center justify-center rounded-full text-[30px] font-extrabold text-white shadow-[0_10px_28px_rgba(15,23,42,0.18)]"
                    style={{ backgroundColor: effectiveColor }}
                  >
                    {profileInitials}
                  </div>
                  <h2 className="mt-4 text-[22px] font-extrabold leading-tight" style={{ color: pagePalette.text }}>
                    {activeDisplayName}
                  </h2>
                  <p className="mt-1 text-[13px] font-medium" style={{ color: pagePalette.textMuted }}>
                    {user?.email || "-"}
                  </p>
                  <div className="mt-4 flex flex-wrap items-center justify-center gap-2">
                    <span className="inline-flex rounded-full border px-3 py-1 text-[11px] font-bold uppercase tracking-[0.8px]" style={{ borderColor: pagePalette.border, backgroundColor: pagePalette.panelMuted, color: pagePalette.text }}>
                      {user?.role || "User"}
                    </span>
                    {resolvedCompanyId ? (
                      <span className="inline-flex rounded-full border px-3 py-1 text-[11px] font-bold" style={{ borderColor: pagePalette.border, backgroundColor: pagePalette.panelMuted, color: pagePalette.textMuted }}>
                        {companyColorSourceLabel}
                      </span>
                    ) : null}
                  </div>
                </div>

                <div className="mt-6 space-y-3">
                  <div className="rounded-[16px] border px-4 py-3" style={{ borderColor: pagePalette.border, backgroundColor: pagePalette.panelMuted }}>
                    <p className="text-[10px] font-bold uppercase tracking-[0.9px]" style={{ color: pagePalette.textMuted }}>Mobile</p>
                    <p className="mt-1 text-[14px] font-semibold" style={{ color: pagePalette.text }}>{mobile || "-"}</p>
                  </div>
                  <div className="rounded-[16px] border px-4 py-3" style={{ borderColor: pagePalette.border, backgroundColor: pagePalette.panelMuted }}>
                    <p className="text-[10px] font-bold uppercase tracking-[0.9px]" style={{ color: pagePalette.textMuted }}>Color Preview</p>
                    <div className="mt-2 flex items-center gap-3">
                      <span className="inline-flex h-5 w-5 rounded-full border border-white/40 shadow-sm" style={{ backgroundColor: effectiveColor }} />
                      <span className="text-[13px] font-semibold" style={{ color: pagePalette.text }}>{effectiveColor}</span>
                    </div>
                  </div>
                  <div className="rounded-[16px] border px-4 py-3" style={{ borderColor: pagePalette.border, backgroundColor: pagePalette.panelMuted }}>
                    <p className="text-[10px] font-bold uppercase tracking-[0.9px]" style={{ color: pagePalette.textMuted }}>Theme</p>
                    <p className="mt-1 text-[14px] font-semibold" style={{ color: pagePalette.text }}>{isDarkMode ? "Dark Mode" : "Light Mode"}</p>
                  </div>
                </div>
              </aside>

              <div className="space-y-5">
                <div className="rounded-[20px] border p-5" style={{ borderColor: pagePalette.border, backgroundColor: pagePalette.panelBg }}>
                  <div className="mb-5">
                    <h3 className="text-[15px] font-extrabold uppercase tracking-[1px]" style={{ color: isDarkMode ? "#f1f1f1" : "#12345B" }}>
                      Profile Details
                    </h3>
                    <p className="mt-1 text-[12px]" style={{ color: pagePalette.textMuted }}>
                      Update how your information appears across the app. Changes save automatically when you finish editing.
                    </p>
                  </div>
                  <div className="grid gap-4 md:grid-cols-2">
                    <label className="block">
                      <span className="mb-2 block text-[11px] font-bold uppercase tracking-[0.9px]" style={{ color: pagePalette.textMuted }}>Display Name</span>
                      <input
                        value={displayName}
                        onChange={(e) => setDisplayName(e.target.value)}
                        onBlur={() => queueAutoSave()}
                        placeholder="Enter your name"
                        className="h-11 w-full rounded-[12px] border px-3 text-[13px]"
                        style={{ borderColor: pagePalette.border, backgroundColor: pagePalette.inputBg, color: pagePalette.text }}
                      />
                    </label>
                    <label className="block">
                      <span className="mb-2 block text-[11px] font-bold uppercase tracking-[0.9px]" style={{ color: pagePalette.textMuted }}>Mobile Number</span>
                      <input
                        value={mobile}
                        onChange={(e) => setMobile(e.target.value)}
                        onBlur={() => queueAutoSave()}
                        placeholder="Enter mobile number"
                        className="h-11 w-full rounded-[12px] border px-3 text-[13px]"
                        style={{ borderColor: pagePalette.border, backgroundColor: pagePalette.inputBg, color: pagePalette.text }}
                      />
                    </label>
                    <div className="rounded-[12px] border px-4 py-3" style={{ borderColor: pagePalette.border, backgroundColor: pagePalette.panelMuted }}>
                      <p className="text-[11px] font-bold uppercase tracking-[0.9px]" style={{ color: pagePalette.textMuted }}>Email</p>
                      <p className="mt-2 text-[14px] font-semibold" style={{ color: pagePalette.text }}>{user?.email || "-"}</p>
                    </div>
                    <div className="rounded-[12px] border px-4 py-3" style={{ borderColor: pagePalette.border, backgroundColor: pagePalette.panelMuted }}>
                      <p className="text-[11px] font-bold uppercase tracking-[0.9px]" style={{ color: pagePalette.textMuted }}>Role</p>
                      <p className="mt-2 text-[14px] font-semibold" style={{ color: pagePalette.text }}>{user?.role || "-"}</p>
                    </div>
                  </div>
                </div>

                <div className="rounded-[20px] border p-5" style={{ borderColor: pagePalette.border, backgroundColor: pagePalette.panelBg }}>
                  <div className="mb-5">
                    <h3 className="text-[15px] font-extrabold uppercase tracking-[1px]" style={{ color: isDarkMode ? "#f1f1f1" : "#12345B" }}>
                      Appearance
                    </h3>
                    <p className="mt-1 text-[12px]" style={{ color: pagePalette.textMuted }}>
                      Personalize your emblem color and the theme on this device.
                    </p>
                  </div>

                  <div className="rounded-[16px] border p-4" style={{ borderColor: pagePalette.border, backgroundColor: pagePalette.panelMuted }}>
                    <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                      <div className="min-w-0">
                        <p className="text-[12px] font-bold" style={{ color: pagePalette.text }}>User Emblem Color</p>
                        <p className="mt-1 text-[11px]" style={{ color: pagePalette.textMuted }}>
                          Leave the value blank to inherit the company color.
                        </p>
                      </div>
                      <div className="inline-flex items-center gap-3 rounded-[14px] border px-3 py-3" style={{ borderColor: pagePalette.border, backgroundColor: pagePalette.panelBg }}>
                        <div
                          className="inline-flex h-9 w-9 items-center justify-center rounded-full text-[13px] font-extrabold text-white"
                          style={{ backgroundColor: effectiveColor }}
                        >
                          {profileInitials}
                        </div>
                        <div className="min-w-0">
                          <p className="truncate text-[12px] font-bold" style={{ color: pagePalette.text }}>{activeDisplayName}</p>
                          <p className="truncate text-[11px]" style={{ color: pagePalette.textMuted }}>{companyColorSourceLabel}</p>
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
                        className="h-11 w-14 cursor-pointer rounded-[12px] border p-1"
                        style={{ borderColor: pagePalette.border, backgroundColor: pagePalette.inputBg }}
                      />
                      <input
                        value={userColor}
                        onChange={(e) => setUserColor(e.target.value)}
                        onBlur={() => queueAutoSave()}
                        placeholder="Leave blank to use company color"
                        className="h-11 w-full rounded-[12px] border px-3 text-[13px] xl:max-w-[320px]"
                        style={{ borderColor: pagePalette.border, backgroundColor: pagePalette.inputBg, color: pagePalette.text }}
                      />
                      <button
                        type="button"
                        onClick={() => void applyCompanyDefault()}
                        className="h-11 rounded-[12px] border px-4 text-[12px] font-bold"
                        style={{ borderColor: pagePalette.border, backgroundColor: pagePalette.inputBg, color: pagePalette.text }}
                      >
                        Use Company Default
                      </button>
                    </div>
                  </div>

                  <div className="mt-4 rounded-[16px] border p-4" style={{ borderColor: pagePalette.border, backgroundColor: pagePalette.panelMuted }}>
                    <p className="text-[12px] font-bold" style={{ color: pagePalette.text }}>App Theme</p>
                    <p className="mt-1 text-[11px]" style={{ color: pagePalette.textMuted }}>
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
                          borderColor: isDarkMode ? "#65b8ff" : pagePalette.border,
                          backgroundColor: isDarkMode ? "#3ea6ff" : "#E5E7EB",
                        }}
                      >
                        <span
                          className="absolute left-1 top-[3px] h-[32px] w-[67px] rounded-[999px] transition-transform"
                          style={{
                            transform: isDarkMode ? "translateX(71px)" : "translateX(-1px)",
                            backgroundColor: isDarkMode ? "#0f0f0f" : "#ffffff",
                            border: isDarkMode ? "1px solid transparent" : "1px solid #D1D5DB",
                            boxShadow: isDarkMode
                              ? "0 2px 10px rgba(15,23,42,0.18)"
                              : "0 1px 3px rgba(15,23,42,0.14)",
                          }}
                        />
                        <span className="relative z-10 flex w-full items-center justify-between px-3 text-[12px] font-bold">
                          <span
                            style={{
                              color: isDarkMode ? "#d1d5db" : "#24589A",
                              transform: isDarkMode ? "scale(0.92)" : "scale(1.05)",
                              transformOrigin: "left center",
                              transition: "transform 140ms ease, color 140ms ease",
                            }}
                          >
                            Light
                          </span>
                          <span
                            style={{
                              color: isDarkMode ? "#f1f1f1" : "#64748B",
                              transform: `${isDarkMode ? "scale(1.05)" : "scale(0.92)"} translateX(-2px)`,
                              transformOrigin: "right center",
                              transition: "transform 140ms ease, color 140ms ease",
                            }}
                          >
                            Dark
                          </span>
                        </span>
                      </button>
                      <div className="flex items-center gap-2 rounded-[12px] border px-3 py-2" style={{ borderColor: pagePalette.border, backgroundColor: pagePalette.panelBg }}>
                        <span className="inline-flex h-3 w-3 rounded-full" style={{ backgroundColor: isDarkMode ? "#0f0f0f" : "#ffffff", border: `1px solid ${pagePalette.border}` }} />
                        <span className="text-[12px] font-semibold" style={{ color: pagePalette.text }}>
                          {isDarkMode ? "Dark theme active" : "Light theme active"}
                        </span>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </section>
      </AppShell>
    </ProtectedRoute>
  );
}
