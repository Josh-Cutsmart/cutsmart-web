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
import { hedgedAsync } from "@/lib/load-retry";
import { clearLastKnown, readLastKnown, saveLastKnown } from "@/lib/last-known";
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
// The account lookup after sign-in. A slow attempt isn't thrown away: after MEMBERSHIP_LOAD_HEDGE_MS a
// second one starts alongside it and whichever answers first wins (see hedgedAsync), and the whole
// thing gives up after MEMBERSHIP_LOAD_TIMEOUT_MS so a call that never answers can't leave the loading
// screen stuck. It used to allow 6s per attempt, then throw the attempt away and start again from
// scratch — a load needing 7s took 13s. When this device has the account from a previous visit (see
// LAST_ACCOUNT_KEY below), none of this holds the app up at all: that's shown straight away and this
// lookup refreshes it in the background.
const MEMBERSHIP_LOAD_HEDGE_MS = 6000;
const MEMBERSHIP_LOAD_TIMEOUT_MS = 20000;
const MEMBERSHIP_LOAD_ATTEMPTS = 2;
// lib/last-known.ts entry for the signed-in account as last loaded on this device.
const LAST_ACCOUNT_KEY = "account";
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

// What's saved on the device for the account (everything else comes from the Firebase user itself).
type SavedAccount = {
  role: UserRole;
  companyId?: string;
  displayName: string;
  userColor?: string;
  mobile?: string;
  verified?: boolean;
  notifyAsCreator?: boolean;
  permissions: string[];
};

function userFromAccount(user: User, account: SavedAccount): AppUser {
  return {
    ...fromFirebaseUser(
      user,
      account.role,
      account.companyId,
      account.displayName,
      account.userColor,
      account.mobile,
      account.verified,
      account.notifyAsCreator,
    ),
    permissions: Array.isArray(account.permissions) ? account.permissions : [],
  };
}

// Keeps the saved account in step with a change made in the app (colour, name…), so the next visit
// doesn't briefly show the old value.
function patchSavedAccount(uid: string | undefined, patch: Partial<SavedAccount>) {
  const userId = String(uid || "").trim();
  const saved = readLastKnown<SavedAccount>(LAST_ACCOUNT_KEY, userId);
  if (saved) saveLastKnown(LAST_ACCOUNT_KEY, userId, { ...saved, ...patch });
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
  // The account currently shown (uid + its saved details), so an identical refresh doesn't hand every
  // page a new user object — that re-ran their loads.
  const shownAccountRef = useRef("");

  const loadMembership = useCallback(async (firebaseUser: User | null) => {
    if (!firebaseUser) {
      if (!activeRef.current) return;
      shownAccountRef.current = "";
      setUser(null);
      setIsLoading(false);
      setIsDemoMode(false);
      setMembershipStatus("ready");
      return;
    }

    const showAccount = (account: SavedAccount) => {
      const key = `${firebaseUser.uid}|${JSON.stringify(account)}`;
      if (shownAccountRef.current === key) return;
      shownAccountRef.current = key;
      setUser(userFromAccount(firebaseUser, account));
    };
    // The account as last loaded on this device: shown straight away instead of waiting on the lookup
    // below, which then refreshes it (re-rendering only if something actually changed).
    const saved = readLastKnown<SavedAccount>(LAST_ACCOUNT_KEY, firebaseUser.uid);
    if (saved) {
      showAccount(saved);
      setMembershipStatus("ready");
      setIsLoading(false);
      setIsDemoMode(false);
    } else {
      setMembershipStatus("loading");
    }

    try {
      const [membership, profile] = await hedgedAsync(
        () =>
          Promise.all([
            fetchPrimaryMembership(firebaseUser.uid),
            fetchUserProfileSummary(firebaseUser.uid),
          ]),
        {
          attempts: MEMBERSHIP_LOAD_ATTEMPTS,
          hedgeAfterMs: MEMBERSHIP_LOAD_HEDGE_MS,
          timeoutMs: MEMBERSHIP_LOAD_TIMEOUT_MS,
          delayMs: 300,
          message: "Membership load timed out",
        },
      );
      if (!activeRef.current) {
        return;
      }
      const resolvedName =
        membership?.displayName ||
        profile?.displayName ||
        firebaseUser.displayName ||
        fallbackNameFromEmail(firebaseUser.email ?? profile?.email ?? "");

      const account: SavedAccount = {
        role: membership?.role ?? "staff",
        companyId: membership?.companyId || profile?.companyId,
        displayName: resolvedName,
        userColor: profile?.userColor,
        mobile: profile?.mobile,
        verified: Boolean(profile?.verified),
        notifyAsCreator: Boolean(profile?.notifyAsCreator),
        permissions: membership?.permissionKeys ?? [],
      };
      saveLastKnown(LAST_ACCOUNT_KEY, firebaseUser.uid, account);
      showAccount(account);
      setMembershipStatus("ready");
    } catch {
      if (!activeRef.current) return;
      // Already showing the last-known account: keep it (it's refreshed again on the next load)
      // rather than dropping to the bare fallback below.
      if (saved) return;
      // A genuine, repeated failure (not just one slow attempt — see the retry above) must never
      // be treated as "this account has no company/permissions" or "confirmed unverified." Build
      // the minimal identity the Firebase user alone can support — companyId undefined,
      // permissions [], verified UNDEFINED (never false: false must only ever mean "confirmed
      // unverified") — and mark membershipStatus "error" so every consumer (dashboard, project
      // page, verification gate) can render a distinct "couldn't load your account — retry" state
      // instead of silently treating this as a real, final, empty-permissions user.
      shownAccountRef.current = "";
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
      // Deliberately no setPersistence() call here. signIn() below already sets the right
      // persistence at the moment of login, and that choice persists across reloads on its own —
      // getAuth() resolves an already-stored session from whichever persistence layer holds it
      // without needing to be told again. Re-calling setPersistence on every mount (i.e. every
      // reload of any staff page) forces Firebase to re-migrate the current user across persistence
      // layers, clearing it from the ones it doesn't migrate to — since IndexedDB/localStorage are
      // shared across every tab of the origin (unlike sessionStorage), that migration running on
      // one tab's reload was wiping the shared credential a second tab of the same account depends
      // on to restore its own session, logging it out.
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
          clearLastKnown();
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
          // Nothing of this account's is left saved on the device.
          clearLastKnown();
        }
        if (auth && hasFirebaseConfig) {
          // This device stops getting their phone/desktop notifications.
          await Promise.race([
            import("@/lib/push-client").then(({ disablePushOnThisDevice }) => disablePushOnThisDevice()).catch(() => undefined),
            new Promise((resolve) => setTimeout(resolve, 2500)),
          ]);
          await signOut(auth);
          return;
        }
        if (typeof window !== "undefined") {
          window.localStorage.removeItem(DEMO_STORAGE_KEY);
        }
        setUser(createDemoUser("owner"));
      },
      setUserColorLocal: (color) => {
        patchSavedAccount(user?.uid, { userColor: String(color || "").trim() || undefined });
        setUser((prev) => {
          if (!prev) return prev;
          return { ...prev, userColor: String(color || "").trim() || undefined };
        });
      },
      setUserProfileLocal: (patch) => {
        const savedPatch: Partial<SavedAccount> = {};
        if (Object.prototype.hasOwnProperty.call(patch, "displayName") && String(patch.displayName ?? "").trim()) {
          savedPatch.displayName = String(patch.displayName ?? "").trim();
        }
        if (Object.prototype.hasOwnProperty.call(patch, "mobile")) {
          savedPatch.mobile = String(patch.mobile ?? "").trim() || undefined;
        }
        if (Object.prototype.hasOwnProperty.call(patch, "userColor")) {
          savedPatch.userColor = String(patch.userColor ?? "").trim() || undefined;
        }
        if (Object.prototype.hasOwnProperty.call(patch, "notifyAsCreator")) {
          savedPatch.notifyAsCreator = Boolean(patch.notifyAsCreator);
        }
        patchSavedAccount(user?.uid, savedPatch);
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
        patchSavedAccount(user?.uid, { verified });
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



