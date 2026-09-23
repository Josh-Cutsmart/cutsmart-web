"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import {
  browserLocalPersistence,
  browserSessionPersistence,
  onAuthStateChanged,
  setPersistence,
  signInWithEmailAndPassword,
  signOut,
  type User,
} from "firebase/auth";
import { auth, hasFirebaseConfig } from "@/lib/firebase";
import { retryAsync, withTimeout } from "@/lib/load-retry";
import { fetchPrimaryMembership, fetchUserProfileSummary } from "@/lib/membership";
import type { AppUser, UserRole } from "@/lib/types";

// "loading": the initial membership/profile fetch for the current sign-in hasn't settled yet.
// "ready": it succeeded — user.role/companyId/permissions/verified reflect the real data.
// "error": it failed after retries — user is a bare, minimal fallback (companyId undefined,
// permissions [], verified undefined) that must NEVER be treated as "this account genuinely has
// no company/permissions" or "confirmed unverified." Every downstream access/verification check
// must gate on this being "ready" before trusting a denial — an "error" status calls for a
// distinct "couldn't load your account, retry" state instead.
export type MembershipStatus = "loading" | "ready" | "error";

interface AuthContextValue {
  user: AppUser | null;
  isLoading: boolean;
  isDemoMode: boolean;
  membershipStatus: MembershipStatus;
  retryMembershipLoad: () => void;
  signIn: (email: string, password: string, rememberOnDevice?: boolean) => Promise<void>;
  signInDemo: (role: UserRole) => void;
  logout: () => Promise<void>;
  setUserColorLocal: (color: string) => void;
  setUserProfileLocal: (patch: Partial<Pick<AppUser, "displayName" | "mobile" | "userColor" | "notifyAsCreator">>) => void;
  setUserVerifiedLocal: (verified: boolean) => void;
}

const DEMO_STORAGE_KEY = "cutsmart_web_demo_role";
const REMEMBER_DEVICE_STORAGE_KEY = "cutsmart_web_remember_device";
// Same key app-shell/dashboard/etc use to resolve "which company is active" — a manual override
// that, once set, is never overwritten automatically (see app-shell.tsx's branding-load effect).
// Left in place across a logout, it makes the NEXT account signed in on this browser inherit the
// PREVIOUS account's company: its cached project tabs, branding, and active-company resolution
// all key off this value rather than the freshly signed-in user's own companyId. Clearing it on
// logout is what stops one account's state from bleeding into a different account/company signed
// in afterward on the same browser.
const ACTIVE_COMPANY_STORAGE_KEY = "cutsmart_active_company_id";
// A cold, first-time connection (fresh browser, no cached Firestore/Auth state) is measurably
// slower and more failure-prone than a warm reload — bound how long a single membership/profile
// fetch attempt is allowed to hang, and retry a bounded number of times, so a stalled network call
// can never leave the loading screen stuck forever AND a merely-slow-but-fine connection gets a
// real second chance instead of one shot before permanently degrading to an "error" status. Total
// worst case (~12s) matches the old single-timeout budget, but a real success on a well-formed
// account now typically lands in well under a second — membership resolution is a single indexed
// query these days, not up to 4 sequential ones (see lib/membership.ts's own comments).
const MEMBERSHIP_LOAD_ATTEMPT_TIMEOUT_MS = 6000;
const MEMBERSHIP_LOAD_ATTEMPTS = 2;
// Same "cold connection can hang forever" concern as MEMBERSHIP_LOAD_TIMEOUT_MS above, but for the
// auth *subscription* itself — onAuthStateChanged does its own internal IndexedDB-backed
// auth-state restore before ever invoking its callback, and on a cold tab/flaky first connection
// that restore can stall or never resolve at all, leaving isLoading stuck true forever (every
// downstream screen — ProtectedRoute, "/"'s "Checking saved sign-in..." gate, the whole (app)
// layout — hangs with it, since only the fetch AFTER this callback fires is time-boxed). This is
// the "sometimes nothing loads until I refresh" bug: a refresh benefits from an already-warm
// connection/IndexedDB, a cold tab doesn't always get one. If the callback hasn't fired within
// this window, fall back to treating the tab as signed-out so the app is at least usable — if the
// real callback was just slow (not actually stuck) and fires a moment later, it still runs
// normally and corrects this fallback with the real signed-in state.
const AUTH_CALLBACK_TIMEOUT_MS = 10000;

const AuthContext = createContext<AuthContextValue | null>(null);

function fromFirebaseUser(
  user: User,
  role: UserRole,
  companyId?: string,
  membershipDisplayName?: string,
  userColor?: string,
  mobile?: string,
  verified?: boolean,
  notifyAsCreator?: boolean,
): AppUser {
  return {
    uid: user.uid,
    email: user.email ?? "unknown@cutsmart.test",
    displayName: membershipDisplayName ?? user.displayName ?? "CutSmart User",
    mobile,
    userColor,
    role,
    companyId,
    permissions: [],
    verified,
    notifyAsCreator,
  };
}

function fallbackNameFromEmail(email: string): string {
  const local = String(email || "").split("@")[0]?.trim();
  if (!local) {
    return "CutSmart User";
  }
  const words = local
    .replace(/[._-]+/g, " ")
    .split(/\s+/)
    .filter(Boolean)
    .map((part) => part[0].toUpperCase() + part.slice(1));
  return words.join(" ") || "CutSmart User";
}

function createDemoUser(role: UserRole): AppUser {
  return {
    uid: `demo_${role}`,
    email: `${role}@cutsmart.test`,
    displayName: `Demo ${role[0].toUpperCase()}${role.slice(1)}`,
    role,
    // Demo mode has no registration/company-creation flow to ever complete verification through —
    // it shouldn't be locked out of a feature it structurally can't finish.
    verified: true,
  };
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const initialDemoRole =
    typeof window !== "undefined"
      ? ((window.localStorage.getItem(DEMO_STORAGE_KEY) as UserRole | null) ?? "owner")
      : "owner";

  const [user, setUser] = useState<AppUser | null>(() =>
    hasFirebaseConfig ? null : createDemoUser(initialDemoRole),
  );
  const [isLoading, setIsLoading] = useState(hasFirebaseConfig);
  const [isDemoMode, setIsDemoMode] = useState(!hasFirebaseConfig);
  const [membershipStatus, setMembershipStatus] = useState<MembershipStatus>(
    hasFirebaseConfig ? "loading" : "ready",
  );
  // Mirrors `active` (the effect's own cleanup flag) but as a ref, so loadMembership — hoisted out
  // of the effect below so retryMembershipLoad can call it again later, from outside that effect's
  // own closure — can still tell whether its caller has since unmounted.
  const activeRef = useRef(true);
  // The most recent Firebase user handed to us by onAuthStateChanged, kept for retryMembershipLoad
  // to re-run against without needing its own subscription.
  const currentFirebaseUserRef = useRef<User | null>(null);

  const loadMembership = useCallback(async (firebaseUser: User | null) => {
    if (!firebaseUser) {
      if (!activeRef.current) return;
      setUser(null);
      setIsLoading(false);
      setIsDemoMode(false);
      setMembershipStatus("ready");
      return;
    }

    setMembershipStatus("loading");
    try {
      // Retries a bounded number of times before giving up — see MEMBERSHIP_LOAD_ATTEMPT_TIMEOUT_MS's
      // own comment for why this replaces a single Promise.race: a merely-slow (not broken)
      // connection now gets a real second attempt instead of one shot before permanently degrading.
      const [membership, profile] = await retryAsync(
        () =>
          withTimeout(
            Promise.all([
              fetchPrimaryMembership(firebaseUser.uid),
              fetchUserProfileSummary(firebaseUser.uid),
            ]),
            MEMBERSHIP_LOAD_ATTEMPT_TIMEOUT_MS,
            "Membership load timed out",
          ),
        { attempts: MEMBERSHIP_LOAD_ATTEMPTS, delayMs: 300 },
      );
      if (!activeRef.current) {
        return;
      }
      const resolvedName =
        membership?.displayName ||
        profile?.displayName ||
        firebaseUser.displayName ||
        fallbackNameFromEmail(firebaseUser.email ?? profile?.email ?? "");

      setUser(
        {
          ...fromFirebaseUser(
            firebaseUser,
            membership?.role ?? "staff",
            membership?.companyId || profile?.companyId,
            resolvedName,
            profile?.userColor,
            profile?.mobile,
            Boolean(profile?.verified),
            Boolean(profile?.notifyAsCreator),
          ),
          permissions: membership?.permissionKeys ?? [],
        },
      );
      setMembershipStatus("ready");
    } catch {
      if (!activeRef.current) return;
      // A genuine, repeated failure (not just one slow attempt — see the retry above) must never
      // be treated as "this account has no company/permissions" or "confirmed unverified." Build
      // the minimal identity the Firebase user alone can support — companyId undefined,
      // permissions [], verified UNDEFINED (never false: false must only ever mean "confirmed
      // unverified") — and mark membershipStatus "error" so every consumer (dashboard, project
      // page, verification gate) can render a distinct "couldn't load your account — retry" state
      // instead of silently treating this as a real, final, empty-permissions user.
      setUser({
        ...fromFirebaseUser(firebaseUser, "staff", undefined, undefined, undefined, undefined, undefined),
        permissions: [],
      });
      setMembershipStatus("error");
    } finally {
      if (activeRef.current) {
        setIsLoading(false);
        setIsDemoMode(false);
      }
    }
  }, []);

  const retryMembershipLoad = useCallback(() => {
    void loadMembership(currentFirebaseUserRef.current);
  }, [loadMembership]);

  useEffect(() => {
    if (!hasFirebaseConfig || !auth) {
      return;
    }

    const firebaseAuth = auth;
    activeRef.current = true;
    let unsubscribeAuth: (() => void) | null = null;
    let authCallbackFired = false;
    const fallbackTimer = window.setTimeout(() => {
      if (!activeRef.current || authCallbackFired) return;
      setUser(null);
      setIsLoading(false);
      setIsDemoMode(false);
      setMembershipStatus("ready");
    }, AUTH_CALLBACK_TIMEOUT_MS);

    const boot = async () => {
      try {
        const rememberOnDevice =
          typeof window !== "undefined" && window.localStorage.getItem(REMEMBER_DEVICE_STORAGE_KEY) === "1";
        await setPersistence(firebaseAuth, rememberOnDevice ? browserLocalPersistence : browserSessionPersistence);
      } catch {
        // Ignore persistence bootstrap issues and continue with auth observer.
      }

      if (!activeRef.current) return;
      try {
        unsubscribeAuth = onAuthStateChanged(firebaseAuth, (firebaseUser) => {
          authCallbackFired = true;
          window.clearTimeout(fallbackTimer);
          currentFirebaseUserRef.current = firebaseUser;
          void loadMembership(firebaseUser);
        });
      } catch {
        // onAuthStateChanged threw synchronously (corrupted IndexedDB, restricted storage state,
        // etc.) — same treat-as-signed-out fallback as the timeout above, just immediate since
        // there's no callback left to ever wait on.
        window.clearTimeout(fallbackTimer);
        if (activeRef.current) {
          setUser(null);
          setIsLoading(false);
          setIsDemoMode(false);
          setMembershipStatus("ready");
        }
      }
    };

    void boot();

    return () => {
      activeRef.current = false;
      window.clearTimeout(fallbackTimer);
      if (unsubscribeAuth) unsubscribeAuth();
    };
  }, [loadMembership]);

  const value = useMemo<AuthContextValue>(
    () => ({
      user,
      isLoading,
      isDemoMode,
      membershipStatus,
      retryMembershipLoad,
      signIn: async (email, password, rememberOnDevice = false) => {
        if (!auth) {
          throw new Error("Firebase is not configured.");
        }
        if (typeof window !== "undefined") {
          window.localStorage.setItem(REMEMBER_DEVICE_STORAGE_KEY, rememberOnDevice ? "1" : "0");
          // Defensive twin of the logout-time clear above, for a session that ended without an
          // explicit logout (browser closed, session expired) — a fresh sign-in should never
          // inherit whichever company was last active on this browser.
          window.localStorage.removeItem(ACTIVE_COMPANY_STORAGE_KEY);
        }
        await setPersistence(auth, rememberOnDevice ? browserLocalPersistence : browserSessionPersistence);
        await signInWithEmailAndPassword(auth, email, password);
      },
      signInDemo: (role) => {
        if (typeof window !== "undefined") {
          window.localStorage.setItem(DEMO_STORAGE_KEY, role);
        }
        setIsDemoMode(true);
        setUser(createDemoUser(role));
        setMembershipStatus("ready");
      },
      logout: async () => {
        if (typeof window !== "undefined") {
          window.localStorage.removeItem(ACTIVE_COMPANY_STORAGE_KEY);
        }
        if (auth && hasFirebaseConfig) {
          await signOut(auth);
          return;
        }
        if (typeof window !== "undefined") {
          window.localStorage.removeItem(DEMO_STORAGE_KEY);
        }
        setUser(createDemoUser("owner"));
      },
      setUserColorLocal: (color) => {
        setUser((prev) => {
          if (!prev) return prev;
          return { ...prev, userColor: String(color || "").trim() || undefined };
        });
      },
      setUserProfileLocal: (patch) => {
        setUser((prev) => {
          if (!prev) return prev;
          const next = { ...prev };
          if (Object.prototype.hasOwnProperty.call(patch, "displayName")) {
            next.displayName = String(patch.displayName ?? "").trim() || prev.displayName;
          }
          if (Object.prototype.hasOwnProperty.call(patch, "mobile")) {
            next.mobile = String(patch.mobile ?? "").trim() || undefined;
          }
          if (Object.prototype.hasOwnProperty.call(patch, "userColor")) {
            next.userColor = String(patch.userColor ?? "").trim() || undefined;
          }
          if (Object.prototype.hasOwnProperty.call(patch, "notifyAsCreator")) {
            next.notifyAsCreator = Boolean(patch.notifyAsCreator);
          }
          return next;
        });
      },
      setUserVerifiedLocal: (verified) => {
        setUser((prev) => (prev ? { ...prev, verified } : prev));
      },
    }),
    [isDemoMode, isLoading, user, membershipStatus, retryMembershipLoad],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) {
    throw new Error("useAuth must be used inside AuthProvider.");
  }
  return ctx;
}



