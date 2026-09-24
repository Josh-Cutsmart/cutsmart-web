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
  // The company's own custom role id (distinct from the coarse owner/admin/staff `role` above) —
  // e.g. used to check a record's own `editableByRoleIds` list. Undefined when the company has no
  // custom roles configured, same as CompanyAccessInfo.roleId upstream.
  roleId?: string;
  permissionKeys: string[];
  error: unknown;
  retry: () => void;
}

interface CachedAccess {
  uid: string;
  companyId: string;
  role: string;
  roleId?: string;
  permissionKeys: string[];
}

// Success-only cache — a transient failure or an in-flight "loading" state is never cached, so it
// can never poison a later attempt or a different page's own use of this hook. Survives
// client-side navigation between the pages that call this hook (that's the point — no more
// re-paying the fetch on every page mount) but not a full reload, same as any other module-level
// state. Invalidate explicitly (e.g. after a role/permission change is saved) via
// invalidateCompanyAccessCache — never assumed to expire on its own.
//
// Keyed by uid alone for the default "active company" mode (unchanged from before company-scoped
// mode existed), or by `${uid}::${companyId}` when a caller passes an explicit companyId (see
// useCompanyAccess below) — a project can belong to a company other than the user's currently
// "active" one, so scoped lookups must not share a cache entry with the active-company one, and a
// user viewing projects from two different companies in the same session must not have the second
// one silently reuse the first's cached role.
const accessCache = new Map<string, CachedAccess>();

export function invalidateCompanyAccessCache(params?: { uid?: string; companyId?: string }): void {
  if (!params || (!params.uid && !params.companyId)) {
    accessCache.clear();
    return;
  }
  for (const [key, cached] of accessCache) {
    if (params.uid && cached.uid === params.uid) {
      accessCache.delete(key);
      continue;
    }
    if (params.companyId && cached.companyId === params.companyId) {
      accessCache.delete(key);
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
//
// Pass an explicit companyId to resolve access for THAT company instead of the user's "active"
// one — e.g. the project page, whose open project may belong to a company other than whichever
// one is currently active in the app shell. Distinguishing "no arg" (auto-resolve mode, the
// original six pages) from "arg passed but not known yet" (e.g. `project?.companyId` before the
// project has loaded) matters: falling back to the active-company resolution in the latter case
// would risk briefly showing role/permissions for the wrong company, so pass `null` (not leave the
// argument out) while the real companyId isn't known yet.
export function useCompanyAccess(...scopedCompanyIdArg: [string | null | undefined] | []): CompanyAccessState {
  const { user, membershipStatus, isDemoMode } = useAuth();
  const hasScopedCompanyId = scopedCompanyIdArg.length > 0;
  const scopedCompanyId = hasScopedCompanyId ? String(scopedCompanyIdArg[0] || "").trim() : "";
  const [state, setState] = useState<Omit<CompanyAccessState, "retry">>({
    status: "loading",
    companyId: "",
    role: "",
    roleId: undefined,
    permissionKeys: [],
    error: null,
  });
  const [retryTick, setRetryTick] = useState(0);

  useEffect(() => {
    let cancelled = false;

    const run = async () => {
      if (hasScopedCompanyId && !scopedCompanyId) {
        // Scoped mode requested but the caller's companyId isn't known yet — stay loading rather
        // than resolving (even transiently) against the wrong, "active" company.
        if (!cancelled) {
          setState((prev) => (prev.status === "loading" ? prev : { status: "loading", companyId: "", role: "", roleId: undefined, permissionKeys: [], error: null }));
        }
        return;
      }

      if (isDemoMode) {
        if (!cancelled) {
          setState({
            status: "ready",
            companyId: scopedCompanyId || String(user?.companyId || ""),
            role: String(user?.role || "").trim().toLowerCase(),
            roleId: undefined,
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
          setState((prev) => (prev.status === "loading" ? prev : { status: "loading", companyId: "", role: "", roleId: undefined, permissionKeys: [], error: null }));
        }
        return;
      }

      const cacheKey = scopedCompanyId ? `${user.uid}::${scopedCompanyId}` : user.uid;
      const cached = accessCache.get(cacheKey);
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
        let companyId = scopedCompanyId;

        if (!companyId) {
          const storedCompanyId =
            typeof window !== "undefined"
              ? String(window.localStorage.getItem(ACTIVE_COMPANY_STORAGE_KEY) || "").trim()
              : "";
          const directCompanyId = String(user.companyId || "").trim();
          companyId = storedCompanyId || directCompanyId;

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
              setState({ status: "error", companyId: "", role: "", roleId: undefined, permissionKeys: [], error: new Error("Could not resolve a company for this account") });
            } else {
              const result: CachedAccess = {
                uid: user.uid,
                companyId: "",
                role: String(user.role || "").trim().toLowerCase(),
                roleId: undefined,
                permissionKeys: Array.isArray(user.permissions) ? user.permissions : [],
              };
              accessCache.set(cacheKey, result);
              setState({ status: "ready", ...result, error: null });
            }
            return;
          }
        }

        const access = await retryAsync(
          () => withTimeout(fetchCompanyAccess(companyId, user.uid), ACCESS_LOAD_ATTEMPT_TIMEOUT_MS, "Company access lookup timed out"),
          { attempts: ACCESS_LOAD_ATTEMPTS, delayMs: 250 },
        );
        if (cancelled) return;
        const result: CachedAccess = {
          uid: user.uid,
          companyId,
          role: String(access?.role || user.role || "").trim().toLowerCase(),
          roleId: access?.roleId || undefined,
          permissionKeys: access?.permissionKeys ?? (Array.isArray(user.permissions) ? user.permissions : []),
        };
        accessCache.set(cacheKey, result);
        setState({ status: "ready", ...result, error: null });
      } catch (error) {
        if (cancelled) return;
        setState({ status: "error", companyId: "", role: "", roleId: undefined, permissionKeys: [], error });
      }
    };

    void run();
    return () => {
      cancelled = true;
    };
  }, [user?.uid, user?.companyId, user?.role, user?.permissions, membershipStatus, isDemoMode, retryTick, hasScopedCompanyId, scopedCompanyId]);

  const retry = useCallback(() => {
    if (user?.uid) {
      const cacheKey = scopedCompanyId ? `${user.uid}::${scopedCompanyId}` : user.uid;
      accessCache.delete(cacheKey);
    }
    setRetryTick((tick) => tick + 1);
  }, [user, scopedCompanyId]);

  return { ...state, retry };
}
