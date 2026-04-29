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
        typeof window !== "undefined" ? String(window.localStorage.getItem(ACTIVE_COMPANY_THEME_COLOR_STORAGE_KEY) || "").trim() : "";
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
        <section className="-mx-4 -mb-4 -mt-4 min-h-screen bg-white pb-4 pt-0 md:-mx-5" style={{ backgroundColor: pagePalette.pageBg, color: pagePalette.text }}>
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
              className="inline-flex h-9 items-center rounded-[10px] border border-[#D8DEE8] bg-white px-3 text-[12px] font-bold text-[#475467] disabled:opacity-55"
              style={{ borderColor: pagePalette.border, backgroundColor: pagePalette.inputBg, color: pagePalette.text }}
            >
              {isSaving ? "Saving..." : "Save & Back"}
            </button>
          </div>
          <div className="px-4 py-4 md:px-5">
          <div className="grid gap-2 text-[13px] text-[#334155]" style={{ color: pagePalette.text }}>
            <label className="flex items-center gap-2">
              <span className="font-bold" style={{ color: pagePalette.text }}>Name:</span>
              <input
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
                onBlur={() => queueAutoSave()}
                placeholder="Enter your name"
                className="h-8 w-[240px] rounded-[8px] border border-[#D8DEE8] bg-white px-2 text-[12px]"
                style={{ borderColor: pagePalette.border, backgroundColor: pagePalette.inputBg, color: pagePalette.text }}
              />
            </label>
            <p style={{ color: pagePalette.text }}><span className="font-bold">Email:</span> {user?.email || "-"}</p>
            <p style={{ color: pagePalette.text }}><span className="font-bold">Role:</span> {user?.role || "-"}</p>
            <label className="flex items-center gap-2">
              <span className="font-bold" style={{ color: pagePalette.text }}>Mobile Number:</span>
              <input
                value={mobile}
                onChange={(e) => setMobile(e.target.value)}
                onBlur={() => queueAutoSave()}
                placeholder="Enter mobile number"
                className="h-8 w-[240px] rounded-[8px] border border-[#D8DEE8] bg-white px-2 text-[12px]"
                style={{ borderColor: pagePalette.border, backgroundColor: pagePalette.inputBg, color: pagePalette.text }}
              />
            </label>
          </div>
          <div className="mt-4 rounded-[10px] border border-[#D8DEE8] bg-[#F8FAFC] p-3" style={{ borderColor: pagePalette.border, backgroundColor: pagePalette.panelBg }}>
            <p className="text-[12px] font-bold text-[#334155]" style={{ color: pagePalette.text }}>User Emblem Color</p>
            <p className="mt-1 text-[11px] text-[#667085]" style={{ color: pagePalette.textMuted }}>
              Defaults to company color unless you set your own.
            </p>
            <div className="mt-2 flex items-center gap-3">
              <input
                type="color"
                value={/^#[0-9A-Fa-f]{6}$/.test(userColor) ? userColor : effectiveColor}
                onChange={(e) => {
                  setUserColor(e.target.value);
                  queueAutoSave();
                }}
                className="h-8 w-10 cursor-pointer rounded-[8px] border border-[#D8DEE8] bg-white p-1"
                style={{ borderColor: pagePalette.border, backgroundColor: pagePalette.inputBg }}
              />
              <input
                value={userColor}
                onChange={(e) => setUserColor(e.target.value)}
                onBlur={() => queueAutoSave()}
                placeholder="Leave blank to use company color"
                className="h-8 w-[260px] rounded-[8px] border border-[#D8DEE8] bg-white px-2 text-[12px]"
                style={{ borderColor: pagePalette.border, backgroundColor: pagePalette.inputBg, color: pagePalette.text }}
              />
              <button
                type="button"
                onClick={() => void applyCompanyDefault()}
                className="h-8 rounded-[8px] border border-[#D8DEE8] bg-white px-2 text-[11px] font-bold text-[#475467]"
                style={{ borderColor: pagePalette.border, backgroundColor: pagePalette.inputBg, color: pagePalette.text }}
              >
                Use Company Default
              </button>
              {!!saveMsg && <span className="text-[11px] font-bold text-[#475467]" style={{ color: pagePalette.textMuted }}>{saveMsg}</span>}
            </div>
            <div className="mt-3 inline-flex items-center gap-2 rounded-[10px] border border-[#E4E7EC] bg-white px-2 py-2" style={{ borderColor: pagePalette.border, backgroundColor: pagePalette.panelMuted }}>
              <div
                className="inline-flex h-7 w-7 items-center justify-center rounded-full text-[11px] font-extrabold text-white"
                style={{ backgroundColor: effectiveColor }}
              >
                {(displayName || user?.displayName || "CU")
                  .split(/\s+/)
                  .filter(Boolean)
                  .slice(0, 2)
                  .map((p) => p[0]?.toUpperCase() ?? "")
                  .join("") || "CU"}
              </div>
              <span className="truncate text-[12px] font-semibold text-[#0F172A]" style={{ color: pagePalette.text }}>{displayName || user?.displayName || "CutSmart User"}</span>
            </div>
          </div>
          <div className="mt-4 rounded-[10px] border border-[#D8DEE8] bg-[#F8FAFC] p-3" style={{ borderColor: pagePalette.border, backgroundColor: pagePalette.panelBg }}>
            <p className="text-[12px] font-bold text-[#334155]" style={{ color: pagePalette.text }}>App Theme</p>
            <p className="mt-1 text-[11px] text-[#667085]" style={{ color: pagePalette.textMuted }}>
              Applies only on this device for your app.
            </p>
            <div className="mt-3 flex items-center gap-3">
              <button
                type="button"
                role="switch"
                aria-checked={isDarkMode}
                aria-label={`Theme mode: ${isDarkMode ? "Dark" : "Light"}`}
                onClick={() => onSelectThemeMode(isDarkMode ? "light" : "dark")}
                className="relative inline-flex h-9 w-[132px] items-center rounded-[999px] border px-1 transition-colors"
                style={{
                  borderColor: isDarkMode ? "#65b8ff" : pagePalette.border,
                  backgroundColor: isDarkMode ? "#3ea6ff" : "#E5E7EB",
                }}
              >
                <span
                  className="absolute left-1 top-[2px] h-[30px] w-[59px] rounded-[999px] transition-transform"
                  style={{
                    transform: isDarkMode ? "translateX(65px)" : "translateX(-2px)",
                    backgroundColor: isDarkMode ? "#0f0f0f" : "#ffffff",
                    border: isDarkMode ? "1px solid transparent" : "1px solid #D1D5DB",
                    boxShadow: isDarkMode
                      ? "0 2px 10px rgba(15,23,42,0.18)"
                      : "0 1px 3px rgba(15,23,42,0.14)",
                  }}
                />
                <span className="relative z-10 flex w-full items-center justify-between px-3 text-[12px] font-medium">
                  <span
                    style={{
                      color: isDarkMode ? "#d1d5db" : "#24589A",
                      transform: isDarkMode ? "scale(0.92)" : "scale(1.08)",
                      transformOrigin: "left center",
                      transition: "transform 140ms ease, color 140ms ease",
                    }}
                  >
                    Light
                  </span>
                  <span
                    style={{
                      color: isDarkMode ? "#f1f1f1" : "#64748B",
                      transform: `${isDarkMode ? "scale(1.08)" : "scale(0.92)"} translateX(-2px)`,
                      transformOrigin: "right center",
                      transition: "transform 140ms ease, color 140ms ease",
                    }}
                  >
                    Dark
                  </span>
                </span>
              </button>
            </div>
          </div>
          </div>
        </section>
      </AppShell>
    </ProtectedRoute>
  );
}
