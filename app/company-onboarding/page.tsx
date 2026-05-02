"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  collection,
  collectionGroup,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  limit,
  query,
  serverTimestamp,
  setDoc,
  where,
} from "firebase/firestore";
import { ProtectedRoute } from "@/components/protected-route";
import { useAuth } from "@/lib/auth-context";
import { db, hasFirebaseConfig } from "@/lib/firebase";

const ACTIVE_COMPANY_STORAGE_KEY = "cutsmart_active_company_id";

type InviteRow = {
  id: string;
  companyId: string;
  companyName: string;
  code: string;
};

const DEFAULT_COMPANY_ROLE_DEFS = [
  {
    id: "owner",
    name: "Owner",
    color: "#1F2937",
    permissions: {
      "company.*": true,
      "company.dashboard.view": true,
      "leads.*": true,
      "projects.create": true,
      "projects.view": true,
      "projects.view.others": true,
      "projects.edit.others": true,
      "projects.status": true,
      "projects.create.others": true,
      "sales.view": true,
      "sales.edit": true,
      "production.view": true,
      "production.edit": true,
      "production.key": true,
      "staff.add": true,
      "staff.remove": true,
      "staff.change.role": true,
      "staff.change.display_name": true,
      "company.settings": true,
      "company.updates": true,
      "dashboard.complete.bonus": true,
    },
  },
  {
    id: "admin",
    name: "Admin",
    color: "#2F6BFF",
    permissions: {
      "company.*": true,
      "company.dashboard.view": true,
      "leads.*": true,
      "projects.create": true,
      "projects.view": true,
      "projects.view.others": true,
      "projects.edit.others": true,
      "projects.status": true,
      "projects.create.others": true,
      "sales.view": true,
      "sales.edit": true,
      "production.view": true,
      "production.edit": true,
      "production.key": true,
      "staff.add": true,
      "staff.remove": true,
      "staff.change.role": true,
      "staff.change.display_name": true,
      "company.settings": true,
      "company.updates": true,
      "dashboard.complete.bonus": true,
    },
  },
  {
    id: "staff",
    name: "Staff",
    color: "#7D99B3",
    permissions: {
      "company.dashboard.view": true,
    },
  },
] as const;

function randToken(length: number) {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let out = "";
  for (let i = 0; i < length; i += 1) {
    out += chars[Math.floor(Math.random() * chars.length)];
  }
  return out;
}

function companyIdFromName(name: string) {
  const seed = String(name || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 16);
  return `cmp_${seed || "new"}_${randToken(6).toLowerCase()}`;
}

function toLower(v: string) {
  return String(v || "").trim().toLowerCase();
}

function joinCodeKeyFromInput(v: string) {
  return String(v || "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "");
}

function describeInviteLookupError(error: unknown, label: string): string {
  const code =
    error && typeof error === "object" && "code" in error
      ? String((error as { code?: unknown }).code ?? "")
      : "";
  const message =
    error && typeof error === "object" && "message" in error
      ? String((error as { message?: unknown }).message ?? "")
      : "";
  const detail = [code, message].filter(Boolean).join(" | ");
  return detail ? `invite lookup failed (${label}): ${detail}` : `invite lookup failed (${label})`;
}

export default function CompanyOnboardingPage() {
  const router = useRouter();
  const { user, logout } = useAuth();
  const [mounted, setMounted] = useState(false);
  const [hoveredChoice, setHoveredChoice] = useState<"create" | "join" | null>(null);
  const [lockedPreview, setLockedPreview] = useState<"create" | "join" | null>(null);
  const [createFieldsVisible, setCreateFieldsVisible] = useState(false);
  const [joinFieldsVisible, setJoinFieldsVisible] = useState(false);
  const [createFormMounted, setCreateFormMounted] = useState(false);
  const [joinFormMounted, setJoinFormMounted] = useState(false);
  const [createFormFocused, setCreateFormFocused] = useState(false);
  const [joinFormFocused, setJoinFormFocused] = useState(false);
  const [showCreateCode, setShowCreateCode] = useState(false);
  const [showJoinCode, setShowJoinCode] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState("");
  const createFormRef = useRef<HTMLFormElement | null>(null);
  const joinFormRef = useRef<HTMLFormElement | null>(null);
  const createPaneRef = useRef<HTMLDivElement | null>(null);
  const joinPaneRef = useRef<HTMLDivElement | null>(null);
  const createCodeTimerRef = useRef<number | null>(null);
  const joinCodeTimerRef = useRef<number | null>(null);
  const createHideTimerRef = useRef<number | null>(null);
  const joinHideTimerRef = useRef<number | null>(null);

  const [createName, setCreateName] = useState("");
  const [createCode, setCreateCode] = useState("");
  const [createCodeConfirm, setCreateCodeConfirm] = useState("");
  const [joinCode, setJoinCode] = useState("");
  const [createStackedInSplit, setCreateStackedInSplit] = useState(false);
  const [joinStackedInSplit, setJoinStackedInSplit] = useState(false);
  const [inviteConfirmState, setInviteConfirmState] = useState<{ id: string; action: "accept" | "decline" } | null>(null);
  const [inviteBusyId, setInviteBusyId] = useState<string | null>(null);

  const [invites, setInvites] = useState<InviteRow[]>([]);
  const [inviteLoadError, setInviteLoadError] = useState("");

  useEffect(() => {
    const t = window.setTimeout(() => setMounted(true), 20);
    return () => window.clearTimeout(t);
  }, []);

  useEffect(() => {
    if (createHideTimerRef.current) {
      window.clearTimeout(createHideTimerRef.current);
      createHideTimerRef.current = null;
    }
    if (hoveredChoice !== "create" || lockedPreview === "create") {
      setCreateFieldsVisible(false);
      createHideTimerRef.current = window.setTimeout(() => {
        setCreateFormMounted(false);
        createHideTimerRef.current = null;
      }, 430);
      return;
    }
    setCreateFormMounted(true);
    const t = window.setTimeout(() => setCreateFieldsVisible(true), 30);
    return () => window.clearTimeout(t);
  }, [hoveredChoice, lockedPreview]);

  useEffect(() => {
    if (joinHideTimerRef.current) {
      window.clearTimeout(joinHideTimerRef.current);
      joinHideTimerRef.current = null;
    }
    if (hoveredChoice !== "join" || lockedPreview === "join") {
      setJoinFieldsVisible(false);
      joinHideTimerRef.current = window.setTimeout(() => {
        setJoinFormMounted(false);
        joinHideTimerRef.current = null;
      }, 430);
      return;
    }
    setJoinFormMounted(true);
    const t = window.setTimeout(() => setJoinFieldsVisible(true), 30);
    return () => window.clearTimeout(t);
  }, [hoveredChoice, lockedPreview]);

  const showCreateForm = hoveredChoice === "create" && lockedPreview !== "create";
  const showJoinForm = hoveredChoice === "join" && lockedPreview !== "join";

  useEffect(() => {
    const loadInvites = async () => {
      if (!db || !hasFirebaseConfig || !user?.email) {
        setInvites([]);
        setInviteLoadError("");
        return;
      }
      const email = toLower(user.email);
      const rows: InviteRow[] = [];
      let firstError = "";

      if (!rows.length) {
        try {
          const byLower = await getDocs(
            query(collectionGroup(db, "invites"), where("emailLower", "==", email), limit(100)),
          );
          for (const snap of byLower.docs) {
            const data = (snap.data() ?? {}) as Record<string, unknown>;
            const parentCompanyId = String(snap.ref.parent.parent?.id ?? "").trim();
            if (!parentCompanyId) continue;
            rows.push({
              id: snap.id,
              companyId: parentCompanyId,
              companyName: String(data.companyName ?? "").trim() || parentCompanyId,
              code: String(data.companyCode ?? data.joinCode ?? data.code ?? "").trim(),
            });
          }
        } catch (error) {
          if (!firstError) firstError = describeInviteLookupError(error, "emailLower");
        }
      }

      const deduped = Array.from(
        new Map(rows.map((row) => [`${row.companyId}:${row.id}`, row])).values(),
      );
      setInvites(deduped);
      setInviteLoadError(deduped.length ? "" : firstError);
    };
    void loadInvites();
  }, [user?.email]);

  const inviteHint = useMemo(() => (invites.length ? `${invites.length} invite(s)` : "No invites yet"), [invites.length]);
  const createBasis = hoveredChoice === "create" ? "60%" : hoveredChoice === "join" ? "40%" : "50%";
  const joinBasis = hoveredChoice === "join" ? "60%" : hoveredChoice === "create" ? "40%" : "50%";

  const closeFlow = () => {
    if (hoveredChoice === "create") setLockedPreview("create");
    if (hoveredChoice === "join") setLockedPreview("join");
    setHoveredChoice(null);
    setCreateFormFocused(false);
    setJoinFormFocused(false);
    setCreateFieldsVisible(false);
    setJoinFieldsVisible(false);
    setShowCreateCode(false);
    setShowJoinCode(false);
    setError("");
  };

  useEffect(() => {
    return () => {
      if (createCodeTimerRef.current) window.clearTimeout(createCodeTimerRef.current);
      if (joinCodeTimerRef.current) window.clearTimeout(joinCodeTimerRef.current);
      if (createHideTimerRef.current) window.clearTimeout(createHideTimerRef.current);
      if (joinHideTimerRef.current) window.clearTimeout(joinHideTimerRef.current);
    };
  }, []);

  useEffect(() => {
    const recomputeSplitStacking = () => {
      // Capture how headings fit in 50/50 split mode, and reuse that layout when expanded.
      if (hoveredChoice !== null) return;
      const createWidth = createPaneRef.current?.clientWidth ?? 0;
      const joinWidth = joinPaneRef.current?.clientWidth ?? 0;
      if (createWidth > 0) setCreateStackedInSplit(createWidth < 430);
      if (joinWidth > 0) setJoinStackedInSplit(joinWidth < 400);
    };
    recomputeSplitStacking();
    window.addEventListener("resize", recomputeSplitStacking);
    return () => window.removeEventListener("resize", recomputeSplitStacking);
  }, [hoveredChoice]);

  const revealCreateCodeFor10s = () => {
    if (showCreateCode) {
      setShowCreateCode(false);
      if (createCodeTimerRef.current) {
        window.clearTimeout(createCodeTimerRef.current);
        createCodeTimerRef.current = null;
      }
      return;
    }
    setShowCreateCode(true);
    if (createCodeTimerRef.current) window.clearTimeout(createCodeTimerRef.current);
    createCodeTimerRef.current = window.setTimeout(() => setShowCreateCode(false), 10000);
  };

  const revealJoinCodeFor10s = () => {
    if (showJoinCode) {
      setShowJoinCode(false);
      if (joinCodeTimerRef.current) {
        window.clearTimeout(joinCodeTimerRef.current);
        joinCodeTimerRef.current = null;
      }
      return;
    }
    setShowJoinCode(true);
    if (joinCodeTimerRef.current) window.clearTimeout(joinCodeTimerRef.current);
    joinCodeTimerRef.current = window.setTimeout(() => setShowJoinCode(false), 10000);
  };

  const onCreateCompany = async () => {
    if (!db || !user?.uid) return;
    const companyName = String(createName || "").trim();
    const code = String(createCode || "").trim();
    const confirmCode = String(createCodeConfirm || "").trim();
    if (!companyName || !code || !confirmCode) {
      setError("Company Name and Company Code / Password are required.");
      return;
    }
    if (code !== confirmCode) {
      setError("Company Code / Password does not match confirmation.");
      return;
    }
    setError("");
    setIsSaving(true);
    try {
      const companyId = companyIdFromName(companyName);
      const ownerName = String(user.displayName || user.email || "Owner").trim();

      await setDoc(doc(db, "companies", companyId), {
        name: companyName,
        companyName,
        applicationPreferences: {
          companyName,
        },
        roles: DEFAULT_COMPANY_ROLE_DEFS,
        id: companyId,
        ownerUid: user.uid,
        ownerId: user.uid,
        companyCode: code,
        companyPassword: code,
        joinCode: code,
        joinPassword: code,
        createdAt: serverTimestamp(),
        createdAtIso: new Date().toISOString(),
        updatedAt: serverTimestamp(),
        updatedAtIso: new Date().toISOString(),
      }, { merge: true });

      const joinCodeKey = joinCodeKeyFromInput(code);
      await setDoc(
        doc(db, "companyJoinCodes", joinCodeKey),
        {
          id: joinCodeKey,
          companyId,
          companyName,
          active: true,
          updatedAt: serverTimestamp(),
          updatedAtIso: new Date().toISOString(),
          createdAt: serverTimestamp(),
          createdAtIso: new Date().toISOString(),
        },
        { merge: true },
      );

      await setDoc(doc(db, "companies", companyId, "memberships", user.uid), {
        uid: user.uid,
        email: user.email || "",
        displayName: ownerName,
        role: "owner",
        roleId: "owner",
        createdAt: serverTimestamp(),
        createdAtIso: new Date().toISOString(),
        updatedAt: serverTimestamp(),
        updatedAtIso: new Date().toISOString(),
      }, { merge: true });

      await setDoc(doc(db, "users", user.uid), {
        email: user.email || "",
        displayName: ownerName,
        companyId,
        updatedAt: serverTimestamp(),
        updatedAtIso: new Date().toISOString(),
      }, { merge: true });

      window.localStorage.setItem(ACTIVE_COMPANY_STORAGE_KEY, companyId);
      router.push("/dashboard");
    } catch {
      setError("Could not create company. Check Firestore rules for companies create/write.");
    } finally {
      setIsSaving(false);
    }
  };

  const onJoinCompany = async () => {
    if (!db || !user?.uid) return;
    const code = String(joinCode || "").trim();
    if (!code) {
      setError("Company Code / Password is required.");
      return;
    }
    setError("");
    setIsSaving(true);
    try {
      const joinCodeKey = joinCodeKeyFromInput(code);
      const joinCodeSnap = await getDoc(doc(db, "companyJoinCodes", joinCodeKey));
      if (!joinCodeSnap.exists()) {
        setError("No company found for that Company Code / Password.");
        setIsSaving(false);
        return;
      }
      const joinCodeData = (joinCodeSnap.data() ?? {}) as Record<string, unknown>;
      const selectedId = String(joinCodeData.companyId ?? "").trim();
      const selectedName = String(joinCodeData.companyName ?? selectedId).trim();
      if (!selectedId) {
        setError("No company found for that Company Code / Password.");
        setIsSaving(false);
        return;
      }

      const memberName = String(user.displayName || user.email || "User").trim();
      await setDoc(doc(db, "companies", selectedId, "memberships", user.uid), {
        uid: user.uid,
        email: user.email || "",
        displayName: memberName,
        role: "staff",
        roleId: "staff",
        joinCodeKey,
        companyName: selectedName,
        createdAt: serverTimestamp(),
        createdAtIso: new Date().toISOString(),
        updatedAt: serverTimestamp(),
        updatedAtIso: new Date().toISOString(),
      }, { merge: true });

      await setDoc(doc(db, "users", user.uid), {
        email: user.email || "",
        displayName: memberName,
        companyId: selectedId,
        updatedAt: serverTimestamp(),
        updatedAtIso: new Date().toISOString(),
      }, { merge: true });

      window.localStorage.setItem(ACTIVE_COMPANY_STORAGE_KEY, selectedId);
      router.push("/dashboard");
    } catch {
      setError("Could not join company. Check Firestore rules for companies read/write.");
    } finally {
      setIsSaving(false);
    }
  };

  const joinSpecificCompany = async (companyId: string, companyName?: string, codeFromInvite?: string) => {
    if (!db || !user?.uid) return false;
    const selectedId = String(companyId || "").trim();
    if (!selectedId) return false;
    const selectedName = String(companyName || "").trim() || selectedId;
    const memberName = String(user.displayName || user.email || "User").trim();
    const inviteJoinCodeKey = joinCodeKeyFromInput(String(codeFromInvite || ""));
    await setDoc(
      doc(db, "companies", selectedId, "memberships", user.uid),
      {
        uid: user.uid,
        email: user.email || "",
        displayName: memberName,
        role: "staff",
        roleId: "staff",
        ...(inviteJoinCodeKey ? { joinCodeKey: inviteJoinCodeKey } : {}),
        companyName: selectedName,
        createdAt: serverTimestamp(),
        createdAtIso: new Date().toISOString(),
        updatedAt: serverTimestamp(),
        updatedAtIso: new Date().toISOString(),
      },
      { merge: true },
    );

    await setDoc(
      doc(db, "users", user.uid),
      {
        email: user.email || "",
        displayName: memberName,
        companyId: selectedId,
        updatedAt: serverTimestamp(),
        updatedAtIso: new Date().toISOString(),
      },
      { merge: true },
    );

    window.localStorage.setItem(ACTIVE_COMPANY_STORAGE_KEY, selectedId);
    return true;
  };

  const onAcceptInvite = async (invite: InviteRow) => {
    if (!db || !user?.uid) return;
    setInviteBusyId(invite.id);
    setError("");
    try {
      const ok = await joinSpecificCompany(invite.companyId, invite.companyName, invite.code);
      if (!ok) {
        setError("Could not accept invite.");
        return;
      }
      await deleteDoc(doc(db, "companies", invite.companyId, "invites", invite.id));
      setInvites((prev) => prev.filter((row) => !(row.companyId === invite.companyId && row.id === invite.id)));
      router.push("/dashboard");
    } catch {
      setError("Could not accept invite.");
    } finally {
      setInviteBusyId(null);
      setInviteConfirmState(null);
    }
  };

  const onDeclineInvite = async (invite: InviteRow) => {
    if (!db) return;
    setInviteBusyId(invite.id);
    setError("");
    try {
      await deleteDoc(doc(db, "companies", invite.companyId, "invites", invite.id));
      setInvites((prev) => prev.filter((row) => !(row.companyId === invite.companyId && row.id === invite.id)));
    } catch {
      setError("Could not decline invite.");
    } finally {
      setInviteBusyId(null);
      setInviteConfirmState(null);
    }
  };

  const onLogout = async () => {
    try {
      await logout();
    } finally {
      router.push("/");
    }
  };

  return (
    <ProtectedRoute>
      <div
        className="relative min-h-screen overflow-hidden"
        style={{
          backgroundImage: "url('/bg.png')",
          backgroundSize: "cover",
          backgroundPosition: "center",
          backgroundRepeat: "no-repeat",
        }}
      >
        <div
          className="z-30"
          style={{
            position: "fixed",
            top: "10px",
            left: "10px",
          }}
        >
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={() => void onLogout()}
              className="h-9 cursor-pointer rounded-[10px] border border-[#D7DEE8] bg-white px-4 text-[13px] font-bold text-[#334155] hover:bg-[#F8FAFC]"
            >
              Log Out
            </button>
            <span className="text-[13px] font-semibold text-[#111827]">{String(user?.email || "")}</span>
          </div>
        </div>

        <div
          className="relative flex min-h-screen flex-row overflow-hidden"
          style={{
            transform: mounted ? "translateY(0)" : "translateY(42px)",
            opacity: mounted ? 1 : 0,
            transition: "transform 520ms ease, opacity 520ms ease",
          }}
        >
          <div
            ref={createPaneRef}
            onMouseEnter={() => setHoveredChoice("create")}
            onMouseLeave={() => {
              if (showCreateForm && createFormFocused) return;
              setHoveredChoice(null);
              setLockedPreview(null);
            }}
            className="group relative z-10 flex min-h-screen shrink-0 items-center justify-center overflow-hidden border-r border-[rgba(215,222,232,0.55)] hover:bg-[rgba(47,107,255,0.50)]"
            style={{
              backgroundColor: "rgba(47,107,255,0.30)",
              flex: `0 0 ${createBasis}`,
              borderRightWidth: 1,
              transition: "flex-basis 900ms cubic-bezier(0.22,1,0.36,1), background-color 300ms ease",
            }}
          >
            <div className="absolute inset-0 z-20 flex items-center justify-center px-8">
              {!createFormMounted ? (
                <span
                  className="text-center uppercase text-[#000000] transition-all"
                  style={{
                    fontSize: "clamp(26px, 3.2vw, 46px)",
                    lineHeight: 1.02,
                    fontWeight: 600,
                    maxWidth: "92%",
                  }}
                >
                  {createStackedInSplit ? (
                    <span className="flex w-full flex-col items-center justify-center leading-[1.02]">
                      <span>CREATE</span>
                      <span>COMPANY</span>
                    </span>
                  ) : (
                    "CREATE COMPANY"
                  )}
                </span>
              ) : (
                <form
                  ref={createFormRef}
                  onClick={(e) => e.stopPropagation()}
                  onFocusCapture={() => setCreateFormFocused(true)}
                  onBlurCapture={() => {
                    window.setTimeout(() => {
                      const active = document.activeElement as Node | null;
                      setCreateFormFocused(!!(active && createFormRef.current?.contains(active)));
                    }, 0);
                  }}
                  onSubmit={(e) => {
                    e.preventDefault();
                    void onCreateCompany();
                  }}
                  className="max-w-none"
                  style={{ width: "min(550px, calc(100vw - 120px))" }}
                >
                  <p
                    className="mx-auto w-full whitespace-normal text-center uppercase text-[#000000] transition-all"
                    style={{
                      fontSize: "clamp(26px, 3.2vw, 46px)",
                      lineHeight: 1.02,
                      fontWeight: 600,
                      marginBottom: createFieldsVisible ? 16 : 0,
                      transform: createFieldsVisible ? "translateY(-10px)" : "translateY(0)",
                      transition: "transform 380ms ease, margin-bottom 380ms ease, font-size 320ms ease",
                      maxWidth: "100%",
                    }}
                  >
                    {createStackedInSplit ? (
                      <span className="flex w-full flex-col items-center justify-center leading-[1.02]">
                        <span>CREATE</span>
                        <span>COMPANY</span>
                      </span>
                    ) : (
                      "CREATE COMPANY"
                    )}
                  </p>
                  <div
                    className="grid grid-cols-1 gap-3"
                    style={{
                      opacity: createFieldsVisible ? 1 : 0,
                      transform: createFieldsVisible ? "translateX(0)" : "translateX(-28px)",
                      maxHeight: createFieldsVisible ? "420px" : "0px",
                      overflow: "hidden",
                      transition: "opacity 420ms ease, transform 420ms ease, max-height 420ms ease",
                    }}
                  >
                    <input
                      type="text"
                      name="company_name_new"
                      autoComplete="off"
                      value={createName}
                      onChange={(e) => setCreateName(e.target.value)}
                      placeholder="Company Name"
                      className="h-[50px] rounded-[12px] border border-[#D7DEE8] bg-white px-4 text-[14px] text-[#12151A] outline-none focus:border-[#7EB0FF]"
                    />
                    <div className="relative">
                      <input
                        type={showCreateCode ? "text" : "password"}
                        name="company_code_new"
                        autoComplete="new-password"
                        value={createCode}
                        onChange={(e) => setCreateCode(e.target.value)}
                        placeholder="Company Code / Password"
                        className="h-[50px] w-full rounded-[12px] border border-[#D7DEE8] bg-white px-4 pr-14 text-[14px] text-[#12151A] outline-none focus:border-[#7EB0FF]"
                      />
                      <button
                        type="button"
                        onClick={revealCreateCodeFor10s}
                        aria-label="Show company code for 10 seconds"
                        className="absolute right-2 top-1/2 z-30 h-7 min-w-[52px] -translate-y-1/2 cursor-pointer rounded-[8px] border border-[#CBD5E1] bg-white px-2 text-[11px] font-bold uppercase tracking-[0.04em] text-[#6B7280] shadow-sm"
                      >
                        {showCreateCode ? "HIDE" : "SHOW"}
                      </button>
                    </div>
                    <input
                      type="password"
                      name="company_code_confirm_new"
                      autoComplete="new-password"
                      value={createCodeConfirm}
                      onChange={(e) => setCreateCodeConfirm(e.target.value)}
                      placeholder="Confirm Company Code / Password"
                      className="h-[50px] rounded-[12px] border border-[#D7DEE8] bg-white px-4 text-[14px] text-[#12151A] outline-none focus:border-[#7EB0FF]"
                    />
                    {error && <p className="text-[12px] font-semibold text-[#B42318]">{error}</p>}
                    <button
                      type="submit"
                      disabled={isSaving}
                      className="h-[50px] rounded-[12px] border border-[#2F6BFF] bg-[#2F6BFF] text-[14px] font-bold text-white disabled:opacity-60"
                    >
                      {isSaving ? "Creating..." : "Create"}
                    </button>
                    <button
                      type="button"
                      onClick={closeFlow}
                      className="h-[50px] rounded-[12px] border border-[#D7DEE8] bg-white text-[14px] font-bold text-[#334155]"
                    >
                      Back
                    </button>
                  </div>
                </form>
              )}
            </div>
          </div>

          <div
            ref={joinPaneRef}
            onMouseEnter={() => setHoveredChoice("join")}
            onMouseLeave={() => {
              if (showJoinForm && joinFormFocused) return;
              setHoveredChoice(null);
              setLockedPreview(null);
            }}
            className="group relative z-10 flex min-h-screen shrink-0 items-center justify-center overflow-hidden hover:bg-[rgba(255,255,255,0.50)]"
            style={{
              backgroundColor: "rgba(255,255,255,0.42)",
              flex: `0 0 ${joinBasis}`,
              transition: "flex-basis 900ms cubic-bezier(0.22,1,0.36,1), background-color 300ms ease",
            }}
            >
              <div className="absolute inset-0 z-20 flex items-center justify-center px-8">
              {!joinFormMounted ? (
                <span
                    className="text-center uppercase text-[#000000] transition-all"
                  style={{
                    fontSize: "clamp(26px, 3.2vw, 46px)",
                    lineHeight: 1.02,
                    fontWeight: 600,
                    maxWidth: "92%",
                  }}
                >
                  {joinStackedInSplit ? (
                    <span className="flex w-full flex-col items-center justify-center leading-[1.02]">
                      <span>JOIN</span>
                      <span>COMPANY</span>
                    </span>
                  ) : (
                    "JOIN COMPANY"
                  )}
                </span>
              ) : (
                <form
                  ref={joinFormRef}
                  onClick={(e) => e.stopPropagation()}
                  onFocusCapture={() => setJoinFormFocused(true)}
                  onBlurCapture={() => {
                    window.setTimeout(() => {
                      const active = document.activeElement as Node | null;
                      setJoinFormFocused(!!(active && joinFormRef.current?.contains(active)));
                    }, 0);
                  }}
                  onSubmit={(e) => {
                    e.preventDefault();
                    void onJoinCompany();
                  }}
                  className="max-w-none"
                  style={{ width: "min(550px, calc(100vw - 120px))" }}
                >
                  <p
                    className="mx-auto w-full whitespace-normal text-center uppercase text-[#000000] transition-all"
                    style={{
                      fontSize: "clamp(26px, 3.2vw, 46px)",
                      lineHeight: 1.02,
                      fontWeight: 600,
                      marginBottom: joinFieldsVisible ? 16 : 0,
                      transform: joinFieldsVisible ? "translateY(-10px)" : "translateY(0)",
                      transition: "transform 380ms ease, margin-bottom 380ms ease, font-size 320ms ease",
                      maxWidth: "100%",
                    }}
                  >
                    {joinStackedInSplit ? (
                      <span className="flex w-full flex-col items-center justify-center leading-[1.02]">
                        <span>JOIN</span>
                        <span>COMPANY</span>
                      </span>
                    ) : (
                      "JOIN COMPANY"
                    )}
                  </p>
                  <div
                    className="grid grid-cols-1 gap-3"
                    style={{
                      opacity: joinFieldsVisible ? 1 : 0,
                      transform: joinFieldsVisible ? "translateX(0)" : "translateX(28px)",
                      maxHeight: joinFieldsVisible ? "300px" : "0px",
                      overflow: "hidden",
                      transition: "opacity 420ms ease, transform 420ms ease, max-height 420ms ease",
                    }}
                  >
                    {invites.map((invite) => {
                      const isBusy = inviteBusyId === invite.id;
                      const acceptConfirm = inviteConfirmState?.id === invite.id && inviteConfirmState.action === "accept";
                      const declineConfirm = inviteConfirmState?.id === invite.id && inviteConfirmState.action === "decline";
                      return (
                        <div
                          key={`${invite.companyId}:${invite.id}`}
                          className="h-[50px] rounded-[12px] border border-[#D7DEE8] bg-white px-3"
                        >
                          <div className="flex h-full items-center gap-2">
                            <p className="min-w-0 flex-1 truncate text-[13px] font-semibold text-[#1F2937]">
                              {invite.companyName}
                            </p>
                            <button
                              type="button"
                              disabled={isBusy}
                              onClick={() => {
                                if (!declineConfirm) {
                                  setInviteConfirmState({ id: invite.id, action: "decline" });
                                  return;
                                }
                                void onDeclineInvite(invite);
                              }}
                              className="h-8 min-w-[88px] rounded-[9px] border border-[#E5AEB3] bg-[#FDECEC] px-3 text-[12px] font-bold text-[#B42318] disabled:opacity-60"
                            >
                              {declineConfirm ? "Confirm" : "Decline"}
                            </button>
                            <button
                              type="button"
                              disabled={isBusy}
                              onClick={() => {
                                if (!acceptConfirm) {
                                  setInviteConfirmState({ id: invite.id, action: "accept" });
                                  return;
                                }
                                void onAcceptInvite(invite);
                              }}
                              className="h-8 min-w-[88px] rounded-[9px] border border-[#1EA44B] bg-[#1EA44B] px-3 text-[12px] font-bold text-white disabled:opacity-60"
                            >
                              {acceptConfirm ? "Confirm" : "Accept"}
                            </button>
                          </div>
                        </div>
                      );
                    })}
                    {!invites.length && inviteLoadError && (
                      <p className="text-[11px] font-semibold text-[#B42318]">{inviteLoadError}</p>
                    )}
                    <div className="relative">
                      <input
                        type={showJoinCode ? "text" : "password"}
                        value={joinCode}
                        onChange={(e) => setJoinCode(e.target.value)}
                        placeholder="Company Code / Password"
                        className="h-[50px] w-full rounded-[12px] border border-[#D7DEE8] bg-white px-4 pr-14 text-[14px] text-[#12151A] outline-none focus:border-[#7EB0FF]"
                      />
                      <button
                        type="button"
                        onClick={revealJoinCodeFor10s}
                        aria-label="Show company code for 10 seconds"
                        className="absolute right-2 top-1/2 z-30 h-7 min-w-[52px] -translate-y-1/2 cursor-pointer rounded-[8px] border border-[#CBD5E1] bg-white px-2 text-[11px] font-bold uppercase tracking-[0.04em] text-[#6B7280] shadow-sm"
                      >
                        {showJoinCode ? "HIDE" : "SHOW"}
                      </button>
                    </div>
                    {error && <p className="text-[12px] font-semibold text-[#B42318]">{error}</p>}
                    <button
                      type="submit"
                      disabled={isSaving}
                      className="h-[50px] rounded-[12px] border border-[#2F6BFF] bg-[#2F6BFF] text-[14px] font-bold text-white disabled:opacity-60"
                    >
                      {isSaving ? "Joining..." : "Join"}
                    </button>
                    <button
                      type="button"
                      onClick={closeFlow}
                      className="h-[50px] rounded-[12px] border border-[#D7DEE8] bg-white text-[14px] font-bold text-[#334155]"
                    >
                      Back
                    </button>
                  </div>
                </form>
              )}
            </div>
          </div>
        </div>
      </div>
    </ProtectedRoute>
  );
}
