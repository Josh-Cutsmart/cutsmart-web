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
}

const DEMO_STORAGE_KEY = "cutsmart_web_demo_role";
const REMEMBER_DEVICE_STORAGE_KEY = "cutsmart_web_remember_device";

const AuthContext = createContext<AuthContextValue | null>(null);

function fromFirebaseUser(
  user: User,
  role: UserRole,
  companyId?: string,
  membershipDisplayName?: string,
  userColor?: string,
  mobile?: string,
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

    const boot = async () => {
      try {
        const rememberOnDevice =
          typeof window !== "undefined" && window.localStorage.getItem(REMEMBER_DEVICE_STORAGE_KEY) === "1";
        await setPersistence(firebaseAuth, rememberOnDevice ? browserLocalPersistence : browserSessionPersistence);
      } catch {
        // Ignore persistence bootstrap issues and continue with auth observer.
      }

      if (!active) return;
      unsubscribeAuth = onAuthStateChanged(firebaseAuth, (firebaseUser) => {
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

        const [membership, profile] = await Promise.all([
          fetchPrimaryMembership(firebaseUser.uid),
          fetchUserProfileSummary(firebaseUser.uid),
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
              membership?.role ?? "viewer",
              membership?.companyId || profile?.companyId,
              resolvedName,
              profile?.userColor,
              profile?.mobile,
            ),
            permissions: membership?.permissionKeys ?? [],
          },
        );
        setIsLoading(false);
        setIsDemoMode(false);
      };

      void loadMembership();
      });
    };

    void boot();

    return () => {
      active = false;
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



