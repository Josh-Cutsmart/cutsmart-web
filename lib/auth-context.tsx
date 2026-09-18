"use client";

import {
  createContext,
  useContext,
  useEffect,
  useMemo,
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
import { fetchPrimaryMembership, fetchUserProfileSummary } from "@/lib/membership";
import type { AppUser, UserRole } from "@/lib/types";

interface AuthContextValue {
  user: AppUser | null;
  isLoading: boolean;
  isDemoMode: boolean;
  signIn: (email: string, password: string, rememberOnDevice?: boolean) => Promise<void>;
  signInDemo: (role: UserRole) => void;
  logout: () => Promise<void>;
  setUserColorLocal: (color: string) => void;
  setUserProfileLocal: (patch: Partial<Pick<AppUser, "displayName" | "mobile" | "userColor">>) => void;
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
// slower and more failure-prone than a warm reload — bound how long the membership/profile fetch
// is allowed to hang so a stalled network call can never leave the loading screen stuck forever.
const MEMBERSHIP_LOAD_TIMEOUT_MS = 12000;
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

function timeoutAfter<T>(ms: number): Promise<T> {
  return new Promise((_resolve, reject) => {
    window.setTimeout(() => reject(new Error("Membership load timed out")), ms);
  });
}

function fromFirebaseUser(
  user: User,
  role: UserRole,
  companyId?: string,
  membershipDisplayName?: string,
  userColor?: string,
  mobile?: string,
  verified?: boolean,
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

  useEffect(() => {
    if (!hasFirebaseConfig || !auth) {
      return;
    }

    const firebaseAuth = auth;
    let active = true;
    let unsubscribeAuth: (() => void) | null = null;
    let authCallbackFired = false;
    const fallbackTimer = window.setTimeout(() => {
      if (!active || authCallbackFired) return;
      setUser(null);
      setIsLoading(false);
      setIsDemoMode(false);
    }, AUTH_CALLBACK_TIMEOUT_MS);

    const boot = async () => {
      try {
        const rememberOnDevice =
          typeof window !== "undefined" && window.localStorage.getItem(REMEMBER_DEVICE_STORAGE_KEY) === "1";
        await setPersistence(firebaseAuth, rememberOnDevice ? browserLocalPersistence : browserSessionPersistence);
      } catch {
        // Ignore persistence bootstrap issues and continue with auth observer.
      }

      if (!active) return;
      try {
      unsubscribeAuth = onAuthStateChanged(firebaseAuth, (firebaseUser) => {
      authCallbackFired = true;
      window.clearTimeout(fallbackTimer);
      const loadMembership = async () => {
        if (!firebaseUser) {
          if (!active) {
            return;
          }
          setUser(null);
          setIsLoading(false);
          setIsDemoMode(false);
          return;
        }

        try {
          const [membership, profile] = await Promise.race([
            Promise.all([
              fetchPrimaryMembership(firebaseUser.uid),
              fetchUserProfileSummary(firebaseUser.uid),
            ]),
            timeoutAfter<[Awaited<ReturnType<typeof fetchPrimaryMembership>>, Awaited<ReturnType<typeof fetchUserProfileSummary>>]>(MEMBERSHIP_LOAD_TIMEOUT_MS),
          ]);
          if (!active) {
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
              ),
              permissions: membership?.permissionKeys ?? [],
            },
          );
        } catch {
          if (!active) return;
          // A slow/failed membership or profile fetch (most likely on a cold, first-time
          // connection with no cached Firestore state) should never leave the loading screen
          // stuck forever — fall back to a basic signed-in user built straight from the Firebase
          // user object so the app is still usable; the user can retry whatever needed the
          // missing membership/profile data once it's actually reachable.
          setUser({
            ...fromFirebaseUser(firebaseUser, "staff", undefined, undefined, undefined, undefined, false),
            permissions: [],
          });
        } finally {
          if (active) {
            setIsLoading(false);
            setIsDemoMode(false);
          }
        }
      };

      void loadMembership();
      });
      } catch {
        // onAuthStateChanged threw synchronously (corrupted IndexedDB, restricted storage state,
        // etc.) — same treat-as-signed-out fallback as the timeout above, just immediate since
        // there's no callback left to ever wait on.
        window.clearTimeout(fallbackTimer);
        if (active) {
          setUser(null);
          setIsLoading(false);
          setIsDemoMode(false);
        }
      }
    };

    void boot();

    return () => {
      active = false;
      window.clearTimeout(fallbackTimer);
      if (unsubscribeAuth) unsubscribeAuth();
    };
  }, []);

  const value = useMemo<AuthContextValue>(
    () => ({
      user,
      isLoading,
      isDemoMode,
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
          return next;
        });
      },
      setUserVerifiedLocal: (verified) => {
        setUser((prev) => (prev ? { ...prev, verified } : prev));
      },
    }),
    [isDemoMode, isLoading, user],
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



