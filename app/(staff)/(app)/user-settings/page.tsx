"use client";

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Building2, Check, ClipboardList, Mail, MailCheck, Pencil, Plus, ShieldCheck, Smartphone, Trash2, UserCog, X } from "lucide-react";
import { useAuth } from "@/lib/auth-context";
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
import { readThemeMode, saveThemeMode, type ThemeMode } from "@/lib/theme-mode";
import type { ChecklistTemplate } from "@/lib/types";
import { dispatchUserColorUpdated } from "@/lib/user-color-sync";
import { contrastTextForFill, labelFromRoleKey, normalizeRoleKey } from "@/lib/user-profile-format";
import { SidebarColorPickerPopover, type ColorPickerAnchorRect } from "@/components/sidebar-color-picker-popover";

function newChecklistLocalId(prefix: string) {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

const ACTIVE_COMPANY_STORAGE_KEY = "cutsmart_active_company_id";
const ACTIVE_COMPANY_THEME_COLOR_STORAGE_KEY = "cutsmart_active_company_theme_color";

export default function UserSettingsPage() {
  const router = useRouter();
  const { user, setUserColorLocal, setUserProfileLocal, setUserVerifiedLocal } = useAuth();
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
    setChecklistEditorId("");
    setChecklistNameDraft("");
    setChecklistRowsDraft([""]);
    setIsChecklistEditorOpen(true);
  };

  const openExistingChecklistEditor = (template: ChecklistTemplate) => {
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
  const saveStatusTone = isSaving ? "#8ab4f8" : profileDirty ? "#B54708" : "#027A48";

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
                    className="absolute left-full ml-1.5 inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-[7px] opacity-0 transition-opacity group-hover:opacity-100 hover:bg-[var(--panel-muted)]"
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
            {!user?.verified && isVerifyBoxOpen && (
              <div
                className="mt-3 w-full space-y-2 rounded-[12px] border p-3 text-left"
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
            )}
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
                      className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-[7px] opacity-0 transition-opacity group-hover:opacity-100 hover:bg-[var(--panel-bg)]"
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
        </aside>

        <div className="space-y-5">
          <div className="rounded-[18px] border p-5" style={glassCardStyle}>
            <div className="mb-5 flex items-start justify-between gap-3">
              <div>
                <h3 className="text-[15px] font-extrabold uppercase tracking-[1px]" style={{ color: "var(--text-main)" }}>
                  Checklists
                </h3>
                <p className="mt-1 text-[12px]" style={{ color: "var(--text-muted)" }}>
                  Create reusable checklists here, then add them to a project from Design {"->"} Project Management.
                </p>
              </div>
              {!isChecklistEditorOpen && (
                <button
                  type="button"
                  onClick={openNewChecklistEditor}
                  className="inline-flex h-9 shrink-0 items-center gap-1.5 rounded-[10px] border px-3 text-[12px] font-bold transition hover:brightness-95"
                  style={{ borderColor: "var(--brand-strong)", backgroundColor: "var(--brand-soft)", color: "var(--brand-strong)" }}
                >
                  <Plus size={14} />
                  Create Checklist
                </button>
              )}
            </div>

            {isChecklistEditorOpen ? (
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
                        onClick={() => setChecklistRowsDraft((prev) => prev.filter((_, i) => i !== idx))}
                        className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-[8px] transition hover:bg-[var(--panel-bg)] disabled:opacity-30"
                        style={{ color: "var(--text-muted)" }}
                        aria-label="Remove row"
                      >
                        <X size={14} />
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
                        onClick={() => void removeChecklistTemplate(template.id)}
                        className="inline-flex h-8 w-8 items-center justify-center rounded-[8px] transition hover:bg-[var(--danger-soft)]"
                        style={{ color: "var(--danger-strong)" }}
                        aria-label={`Delete ${template.name}`}
                      >
                        <Trash2 size={13} />
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
            )}
          </div>
        </div>
      </div>

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
