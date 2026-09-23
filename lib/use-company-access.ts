"use client";

import { useCallback, useEffect, useState } from "react";
import { useAuth } from "@/lib/auth-context";
import { retryAsync, withTimeout } from "@/lib/load-retry";
import { fetchCompanyAccess, fetchPrimaryMembership } from "@/lib/membership";

// Same key app-shell/dashboard/etc use to resolve "which company is active" (see
// lib/auth-context.tsx's own copy of this same literal for the full history/reasoning).
const ACTIVE_COMPANY_STORAGE_KEY = "cutsmart_active_company_id";
const ACCESS_LOAD_ATTEMPT_TIMEOUT_MS = 6000;
const ACCESS_LOAD_ATTEMPTS = 2;

export type CompanyAccessStatus = "loading" | "ready" | "error";

export interface CompanyAccessState {
  status: CompanyAccessStatus;
  companyId: string;
  // Only trustworthy once status === "ready" — while "loading" or "error", treat as unknown, not
  // as "no role"/"no permissions". Every page consuming this must gate its own access checks on
  // status === "ready" before trusting a denial (see hasPermissionKey/isOwnerOrAdmin below).
  role: string;
  permissionKeys: string[];
  error: unknown;
  retry: () => void;
}

interface CachedAccess {
  companyId: string;
  role: string;
  permissionKeys: string[];
}

// Success-only cache, keyed by uid — a transient failure or an in-flight "loading" state is never
// cached, so it can never poison a later attempt or a different page's own use of this hook.
// Survives client-side navigation between the pages that call this hook (that's the point — no
// more re-paying the fetch on every page mount) but not a full reload, same as any other
// module-level state. Invalidate explicitly (e.g. after a role/permission change is saved) via
// invalidateCompanyAccessCache — never assumed to expire on its own.
const accessCache = new Map<string, CachedAccess>();

export function invalidateCompanyAccessCache(params?: { uid?: string; companyId?: string }): void {
  if (!params || (!params.uid && !params.companyId)) {
    accessCache.clear();
    return;
  }
  for (const [uid, cached] of accessCache) {
    if (params.uid && uid === params.uid) {
      accessCache.delete(uid);
      continue;
    }
    if (params.companyId && cached.companyId === params.companyId) {
      accessCache.delete(uid);
    }
  }
}

export function isOwnerOrAdmin(role: string | undefined): boolean {
  const normalized = String(role || "").trim().toLowerCase();
  return normalized === "owner" || normalized === "admin";
}

// "company.*" is the super-wildcard — every feature this checks is itself company-scoped, so it
// grants any permission check (matching how clients.tsx/leads.tsx already treated it before this
// hook existed). Any other "foo.*" key generalizes the same way for its own "foo.bar" permissions
// (previously leads.tsx was the only page with an equivalent, hardcoded to "leads.*" specifically —
// this makes that a general rule instead of a one-off).
export function hasPermissionKey(permissionKeys: string[] | undefined, key: string): boolean {
  const target = String(key || "").trim().toLowerCase();
  if (!target) return false;
  const normalizedKeys = (permissionKeys ?? []).map((item) => String(item || "").trim().toLowerCase());
  if (normalizedKeys.includes(target)) return true;
  if (normalizedKeys.includes("company.*")) return true;
  const prefix = target.split(".")[0];
  if (prefix && normalizedKeys.includes(`${prefix}.*`)) return true;
  return false;
}

// Resolves the current user's effective role/permissions for the active company — the single
// shared replacement for what used to be six near-identical, independently-drifted copies of this
// same effect (dashboard/company-settings/clients/leads/recently-deleted/user-settings pages).
//
// Companion principle to lib/auth-context.tsx's own membershipStatus: a fetch that's still in
// flight, or that failed/timed out even after retrying, must never be treated the same as "this
// user has no role/permissions" — that's exactly what turned transient cold-start slowness into a
// permanent, reload-persistent "you do not have permission" across the app. status === "error"
// is a distinct, retryable outcome a page must render differently from a real denial.
export function useCompanyAccess(): CompanyAccessState {
  const { user, membershipStatus, isDemoMode } = useAuth();
  const [state, setState] = useState<Omit<CompanyAccessState, "retry">>({
    status: "loading",
    companyId: "",
    role: "",
    permissionKeys: [],
    error: null,
  });
  const [retryTick, setRetryTick] = useState(0);

  useEffect(() => {
    let cancelled = false;

    const run = async () => {
      if (isDemoMode) {
        if (!cancelled) {
          setState({
            status: "ready",
            companyId: String(user?.companyId || ""),
            role: String(user?.role || "").trim().toLowerCase(),
            permissionKeys: Array.isArray(user?.permissions) ? user.permissions : [],
            error: null,
          });
        }
        return;
      }
      if (!user?.uid) {
        // No signed-in user yet — ProtectedRoute normally keeps this hook's callers from even
        // mounting in that case, but stay in "loading" defensively rather than ever reporting a
        // denial for a user we don't have.
        if (!cancelled) {
          setState((prev) => (prev.status === "loading" ? prev : { status: "loading", companyId: "", role: "", permissionKeys: [], error: null }));
        }
        return;
      }

      const cached = accessCache.get(user.uid);
      if (cached && retryTick === 0) {
        if (!cancelled) {
          setState({ status: "ready", ...cached, error: null });
        }
        return;
      }

      if (!cancelled) {
        setState((prev) => ({ ...prev, status: "loading", error: null }));
      }

      try {
        const storedCompanyId =
          typeof window !== "undefined"
            ? String(window.localStorage.getItem(ACTIVE_COMPANY_STORAGE_KEY) || "").trim()
            : "";
        const directCompanyId = String(user.companyId || "").trim();
        let companyId = storedCompanyId || directCompanyId;

        if (!companyId) {
          const membership = await retryAsync(
            () => withTimeout(fetchPrimaryMembership(user.uid), ACCESS_LOAD_ATTEMPT_TIMEOUT_MS, "Membership lookup timed out"),
            { attempts: ACCESS_LOAD_ATTEMPTS, delayMs: 250 },
          );
          companyId = String(membership?.companyId || "").trim();
        }

        if (!companyId) {
          if (cancelled) return;
          // Genuinely no company to resolve — if auth-context itself is still degraded
          // (membershipStatus "error"), we can't tell whether that's real or just fallout from
          // the same underlying failure, so surface it as an error too rather than a denial.
          if (membershipStatus === "error") {
            setState({ status: "error", companyId: "", role: "", permissionKeys: [], error: new Error("Could not resolve a company for this account") });
          } else {
            const result: CachedAccess = {
              companyId: "",
              role: String(user.role || "").trim().toLowerCase(),
              permissionKeys: Array.isArray(user.permissions) ? user.permissions : [],
            };
            accessCache.set(user.uid, result);
            setState({ status: "ready", ...result, error: null });
          }
          return;
        }

        const access = await retryAsync(
          () => withTimeout(fetchCompanyAccess(companyId, user.uid), ACCESS_LOAD_ATTEMPT_TIMEOUT_MS, "Company access lookup timed out"),
          { attempts: ACCESS_LOAD_ATTEMPTS, delayMs: 250 },
        );
        if (cancelled) return;
        const result: CachedAccess = {
          companyId,
          role: String(access?.role || user.role || "").trim().toLowerCase(),
          permissionKeys: access?.permissionKeys ?? (Array.isArray(user.permissions) ? user.permissions : []),
        };
        accessCache.set(user.uid, result);
        setState({ status: "ready", ...result, error: null });
      } catch (error) {
        if (cancelled) return;
        setState({ status: "error", companyId: "", role: "", permissionKeys: [], error });
      }
    };

    void run();
    return () => {
      cancelled = true;
    };
  }, [user?.uid, user?.companyId, user?.role, user?.permissions, membershipStatus, isDemoMode, retryTick]);

  const retry = useCallback(() => {
    if (user?.uid) {
      accessCache.delete(user.uid);
    }
    setRetryTick((tick) => tick + 1);
  }, [user]);

  return { ...state, retry };
}
