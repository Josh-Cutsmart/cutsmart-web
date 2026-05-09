"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { createPortal } from "react-dom";
import { Activity, CheckCircle2, FolderKanban, Search, SlidersHorizontal, Users2, X } from "lucide-react";
import { AppShell } from "@/components/app-shell";
import { ProtectedRoute } from "@/components/protected-route";
import { useAuth } from "@/lib/auth-context";
import { fetchCompanyAccess, fetchPrimaryMembership } from "@/lib/membership";
import {
  fetchCompanyDoc,
  fetchCompanyMembers,
  fetchProjects,
  fetchUserColorMapByUids,
  updateProjectPatch,
  updateProjectStatus,
} from "@/lib/firestore-data";
import type { CompanyMemberOption } from "@/lib/firestore-data";
import { projectTabAccess } from "@/lib/permissions";
import { readThemeMode, THEME_MODE_UPDATED_EVENT, type ThemeMode } from "@/lib/theme-mode";
import type { Project } from "@/lib/types";
import { USER_COLOR_UPDATED_EVENT, type UserColorUpdatedDetail } from "@/lib/user-color-sync";
import { retryAsync } from "@/lib/load-retry";
const ACTIVE_COMPANY_STORAGE_KEY = "cutsmart_active_company_id";
type StatusRow = { name: string; color: string };
type RoleRow = { id: string; name: string; color: string };

const statCards = [
  { label: "Projects", key: "total", icon: FolderKanban, iconBg: "#5EA1F7" },
  { label: "Active", key: "active", icon: Activity, iconBg: "#E8BF46" },
  { label: "Completed", key: "completed", icon: CheckCircle2, iconBg: "#50A279" },
  { label: "Staff Members", key: "staff", icon: Users2, iconBg: "#8A72CC" },
] as const;
type QuickFilter = "all" | "active" | "completed";
type DashboardLegendRow = { id: string; name: string; color: string };

function normalizeRoleKey(value: unknown): string {
  return String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "_");
}

function isCompletedStatus(status: string) {
  const token = String(status || "")
    .toLowerCase()
    .replace(/[^a-z]/g, "");
  return token === "done" || token.startsWith("complete");
}

function statusPillColors(status: string) {
  const key = String(status || "").trim().toLowerCase();
  const defaults: Record<string, string> = {
    new: "#3060D0",
    running: "#2A7A3B",
    "in production": "#2A7A3B",
    drafting: "#6B4FB3",
    quoting: "#C77700",
    "ready for cnc": "#3060D0",
    completed: "#2A7A3B",
    paused: "#A05A00",
  };

  const bg = defaults[key] ?? "#64748B";
  return { backgroundColor: bg, color: "#FFFFFF" };
}

function normalizeStatuses(raw: unknown): StatusRow[] {
  if (!Array.isArray(raw)) {
    return [
      { name: "New", color: "#3060D0" },
      { name: "In Production", color: "#2A7A3B" },
      { name: "On Hold", color: "#C77700" },
      { name: "Complete", color: "#2A7A3B" },
    ];
  }
  const rows = raw
    .filter((item) => item && typeof item === "object")
    .map((item) => {
      const row = item as Record<string, unknown>;
      return {
        name: String(row.name ?? "").trim(),
        color: String(row.color ?? "").trim() || "#64748B",
      };
    })
    .filter((row) => row.name);
  return rows.length
    ? rows
    : [
        { name: "New", color: "#3060D0" },
        { name: "In Production", color: "#2A7A3B" },
        { name: "On Hold", color: "#C77700" },
        { name: "Complete", color: "#2A7A3B" },
      ];
}

function normalizeDashboardLegend(raw: unknown): DashboardLegendRow[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((item) => item && typeof item === "object")
    .map((item, idx) => {
      const row = item as Record<string, unknown>;
      return {
        id: String(row.id ?? `legend_${idx + 1}`).trim(),
        name: String(row.name ?? "").trim(),
        color: String(row.color ?? "").trim() || "#2A7A3B",
      };
    })
    .filter((row) => row.name);
}

function completedProjectIso(project: Project): string {
  const raw = project as unknown as Record<string, unknown>;
  const completedAtIso = String(raw.completedAtIso ?? "").trim();
  if (completedAtIso) return completedAtIso;
  const completedAtRaw = raw.completedAt;
  if (completedAtRaw instanceof Date && !Number.isNaN(completedAtRaw.getTime())) {
    return completedAtRaw.toISOString();
  }
  if (
    completedAtRaw &&
    typeof completedAtRaw === "object" &&
    typeof (completedAtRaw as { toDate?: () => Date }).toDate === "function"
  ) {
    const asDate = (completedAtRaw as { toDate: () => Date }).toDate();
    if (asDate instanceof Date && !Number.isNaN(asDate.getTime())) {
      return asDate.toISOString();
    }
  }
  return String(project.createdAt ?? "").trim();
}

function monthKeyFromIso(iso: string): string {
  const d = new Date(String(iso || ""));
  if (Number.isNaN(d.getTime())) return "";
  const year = d.getFullYear();
  const month = `${d.getMonth() + 1}`.padStart(2, "0");
  return `${year}-${month}`;
}

function monthLabelFromKey(monthKey: string): string {
  const [yearRaw, monthRaw] = String(monthKey || "").split("-");
  const year = Number(yearRaw);
  const month = Number(monthRaw);
  if (!Number.isFinite(year) || !Number.isFinite(month) || month < 1 || month > 12) return "Unknown Month";
  return new Intl.DateTimeFormat("en-NZ", { month: "long", year: "numeric" }).format(new Date(year, month - 1, 1));
}

function monthSortValue(monthKey: string): number {
  const [yearRaw, monthRaw] = String(monthKey || "").split("-");
  const year = Number(yearRaw);
  const month = Number(monthRaw);
  if (!Number.isFinite(year) || !Number.isFinite(month)) return -1;
  return year * 100 + month;
}

function rowTextColorForFill(fill: string): string {
  const clean = String(fill || "").trim().replace("#", "");
  if (!/^[0-9a-fA-F]{6}$/.test(clean)) return "#111827";
  const r = Number.parseInt(clean.slice(0, 2), 16);
  const g = Number.parseInt(clean.slice(2, 4), 16);
  const b = Number.parseInt(clean.slice(4, 6), 16);
  const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  return luminance > 0.62 ? "#0F172A" : "#FFFFFF";
}

function normalizeRoleRows(raw: unknown): RoleRow[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((item) => item && typeof item === "object")
    .map((item, idx) => {
      const row = item as Record<string, unknown>;
      const id = normalizeRoleKey(row.id ?? row.name ?? `role_${idx + 1}`);
      return {
        id,
        name: String(row.name ?? row.id ?? "").trim() || id,
        color: String(row.color ?? "").trim() || "#7D99B3",
      };
    })
    .filter((row) => row.id);
}

function roleLabelFromKey(roleKey: string): string {
  const clean = normalizeRoleKey(roleKey);
  if (!clean) return "Staff";
  return clean
    .split("_")
    .filter(Boolean)
    .map((part) => part[0]?.toUpperCase() + part.slice(1))
    .join(" ");
}

function dashboardDate(value: string) {
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) {
    return "-";
  }
  const date = new Intl.DateTimeFormat("en-NZ", {
    day: "2-digit",
    month: "long",
    year: "numeric",
  }).format(d);
  const time = new Intl.DateTimeFormat("en-NZ", {
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  })
    .format(d)
    .toLowerCase()
    .replace(" ", "");
  return `${date} | ${time}`;
}

function dashboardDateOnly(value: string) {
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) {
    return "-";
  }
  return new Intl.DateTimeFormat("en-NZ", {
    day: "2-digit",
    month: "long",
    year: "numeric",
  }).format(d);
}

function isoToDateInputValue(value: string) {
  const d = new Date(String(value || ""));
  if (Number.isNaN(d.getTime())) return "";
  const year = d.getFullYear();
  const month = `${d.getMonth() + 1}`.padStart(2, "0");
  const day = `${d.getDate()}`.padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function dateInputValueToCompletedIso(value: string) {
  const clean = String(value || "").trim();
  if (!clean) return "";
  const next = new Date(`${clean}T12:00:00`);
  if (Number.isNaN(next.getTime())) return "";
  return next.toISOString();
}

function initials(text: string) {
  const cleaned = String(text || "").trim();
  if (!cleaned) return "CU";
  const parts = cleaned.split(/\s+/).filter(Boolean);
  if (parts.length === 1) {
    return parts[0].slice(0, 2).toUpperCase();
  }
  return `${parts[0][0] ?? ""}${parts[1][0] ?? ""}`.toUpperCase();
}

function assignedDisplayName(project: Project) {
  const value = String(project.assignedToName || project.assignedTo || "").trim();
  return value.toLowerCase() === "unassigned" ? "" : value;
}

export default function DashboardPage() {
  const router = useRouter();
  const { user } = useAuth();
  const [themeMode, setThemeMode] = useState<ThemeMode>("light");
  const [search, setSearch] = useState("");
  const [quickFilter, setQuickFilter] = useState<QuickFilter>("all");
  const [allProjects, setAllProjects] = useState<Project[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [statusMenuProjectId, setStatusMenuProjectId] = useState("");
  const [statusMenuPos, setStatusMenuPos] = useState<{ left: number; top: number; width: number } | null>(null);
  const [statusUpdatingProjectId, setStatusUpdatingProjectId] = useState("");
  const [statusRows, setStatusRows] = useState<StatusRow[]>(normalizeStatuses(undefined));
  const [dashboardLegendRows, setDashboardLegendRows] = useState<DashboardLegendRow[]>([]);
  const [companyMembers, setCompanyMembers] = useState<CompanyMemberOption[]>([]);
  const [roleRows, setRoleRows] = useState<RoleRow[]>([]);
  const [creatorColorByUid, setCreatorColorByUid] = useState<Record<string, string>>({});
  const [companyThemeColor, setCompanyThemeColor] = useState("#2F6BFF");
  const [hoveredProjectId, setHoveredProjectId] = useState("");
  const [showCompletedProjectsModal, setShowCompletedProjectsModal] = useState(false);
  const [completedProjectsModalExpanded, setCompletedProjectsModalExpanded] = useState(false);
  const [completedMonthFrom, setCompletedMonthFrom] = useState("");
  const [completedMonthTo, setCompletedMonthTo] = useState("");
  const [completedCardRect, setCompletedCardRect] = useState<{ left: number; top: number; width: number; height: number } | null>(null);
  const [completedDateUpdatingProjectId, setCompletedDateUpdatingProjectId] = useState("");
  const [completedLegendUpdatingProjectId, setCompletedLegendUpdatingProjectId] = useState("");
  const [activeCompletedLegendId, setActiveCompletedLegendId] = useState("");
  const completedCardRef = useRef<HTMLDivElement | null>(null);
  const completedModalTimerRef = useRef<number | null>(null);
  const completedDateInputRefs = useRef<Record<string, HTMLInputElement | null>>({});
  const [showStaffModal, setShowStaffModal] = useState(false);
  const [staffModalExpanded, setStaffModalExpanded] = useState(false);
  const [staffCardRect, setStaffCardRect] = useState<{ left: number; top: number; width: number; height: number } | null>(null);
  const staffCardRef = useRef<HTMLDivElement | null>(null);
  const staffModalTimerRef = useRef<number | null>(null);
  const [effectiveCompanyRole, setEffectiveCompanyRole] = useState("");
  const [effectiveCompanyPermissions, setEffectiveCompanyPermissions] = useState<string[]>([]);
  const [companyAccessResolved, setCompanyAccessResolved] = useState(false);
  const isDarkMode = themeMode === "dark";
  const dashboardPalette = isDarkMode
    ? {
        pageBg: "#0f0f0f",
        sectionBg: "#181818",
        panelBg: "#212121",
        panelMuted: "#272727",
        panelAlt: "#303030",
        border: "#3f3f46",
        text: "#f1f1f1",
        textMuted: "#aaaaaa",
        textSoft: "#c9d1d9",
        inputBg: "#303134",
        inputText: "#f1f1f1",
        rowHover: "#2a2a2a",
        strongShadow: "0 10px 30px rgba(0,0,0,0.38)",
      }
    : {
        pageBg: "#ffffff",
        sectionBg: "#ffffff",
        panelBg: "#ffffff",
        panelMuted: "#F5F7FA",
        panelAlt: "#EEF2F7",
        border: "#D7DEE8",
        text: "#111827",
        textMuted: "#64748B",
        textSoft: "#475467",
        inputBg: "#F3F5F8",
        inputText: "#5B6472",
        rowHover: "#F2F6FC",
        strongShadow: "0 10px 30px rgba(15,23,42,0.08)",
      };
  const dashboardSurfaceBg = isDarkMode ? dashboardPalette.pageBg : "#F5F7FB";
  const canAccessDashboard = useMemo(() => {
    const role = String(effectiveCompanyRole || user?.role || "").trim().toLowerCase();
    if (role === "owner" || role === "admin") {
      return true;
    }
    return (effectiveCompanyPermissions.length ? effectiveCompanyPermissions : user?.permissions ?? []).some(
      (permission) => String(permission || "").trim().toLowerCase() === "company.dashboard.view",
    );
  }, [effectiveCompanyPermissions, effectiveCompanyRole, user?.permissions, user?.role]);

  useEffect(() => {
    setThemeMode(readThemeMode());
    if (typeof window === "undefined") return;
    const onThemeUpdated = (event: Event) => {
      const detail = (event as CustomEvent<{ mode?: ThemeMode }>).detail;
      setThemeMode(detail?.mode === "dark" ? "dark" : "light");
    };
    window.addEventListener(THEME_MODE_UPDATED_EVENT, onThemeUpdated as EventListener);
    return () => {
      window.removeEventListener(THEME_MODE_UPDATED_EVENT, onThemeUpdated as EventListener);
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    const loadCompanyAccess = async () => {
      if (!cancelled) {
        setCompanyAccessResolved(false);
      }
      try {
        const storedCompanyId =
          typeof window !== "undefined"
            ? String(window.localStorage.getItem(ACTIVE_COMPANY_STORAGE_KEY) || "").trim()
            : "";
        const directCompanyId = String(user?.companyId || "").trim();
        const fallbackMembership = !directCompanyId && user?.uid
          ? await retryAsync(() => fetchPrimaryMembership(user.uid!), { attempts: 2, delayMs: 250 })
          : null;
        const companyId = storedCompanyId || directCompanyId || String(fallbackMembership?.companyId || "").trim();
        if (!user?.uid || !companyId) {
          if (!cancelled) {
            setEffectiveCompanyRole(String(user?.role || "").trim().toLowerCase());
            setEffectiveCompanyPermissions(Array.isArray(user?.permissions) ? user.permissions : []);
            setCompanyAccessResolved(true);
          }
          return;
        }
        const companyAccess = await retryAsync(() => fetchCompanyAccess(companyId, user.uid!), {
          attempts: 2,
          delayMs: 250,
        });
        if (cancelled) return;
        setEffectiveCompanyRole(String(companyAccess?.role || user?.role || "").trim().toLowerCase());
        setEffectiveCompanyPermissions(companyAccess?.permissionKeys ?? (Array.isArray(user?.permissions) ? user.permissions : []));
      } catch {
        if (!cancelled) {
          setEffectiveCompanyRole(String(user?.role || "").trim().toLowerCase());
          setEffectiveCompanyPermissions(Array.isArray(user?.permissions) ? user.permissions : []);
          setCompanyAccessResolved(true);
        }
        return;
      }
      if (!cancelled) {
        setCompanyAccessResolved(true);
      }
    };
    void loadCompanyAccess();
    return () => {
      cancelled = true;
    };
  }, [user?.companyId, user?.permissions, user?.role, user?.uid]);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      if (!cancelled) {
        setIsLoading(true);
      }
      try {
        const storedCompanyId =
          typeof window !== "undefined"
            ? String(window.localStorage.getItem(ACTIVE_COMPANY_STORAGE_KEY) || "").trim()
            : "";
        const preferredCompanyIds = [storedCompanyId, String(user?.companyId || "").trim()].filter(Boolean);
        const items = await retryAsync(() => fetchProjects(user?.uid, preferredCompanyIds), {
          attempts: 2,
          delayMs: 350,
          shouldRetryResult: (value, attempt) =>
            attempt === 1 &&
            preferredCompanyIds.length > 0 &&
            Array.isArray(value) &&
            value.length === 0,
        });
        if (cancelled) return;
        setAllProjects(items);
        const fallbackCompanyId = String(items[0]?.companyId || "").trim();
        const companyId = storedCompanyId || fallbackCompanyId;
        const creatorUids = items.map((row) => String(row.createdByUid || "").trim()).filter(Boolean);
        const assignedUids = items.map((row) => String(row.assignedToUid || "").trim()).filter(Boolean);
        const userColorMap = await retryAsync(
          () => fetchUserColorMapByUids([...creatorUids, ...assignedUids], companyId),
          { attempts: 2, delayMs: 250 },
        );
        if (cancelled) return;
        setCreatorColorByUid(userColorMap);
        if (companyId) {
          const [companyDoc, members] = await retryAsync(
            () =>
              Promise.all([
                fetchCompanyDoc(companyId),
                fetchCompanyMembers(companyId),
              ]),
            { attempts: 2, delayMs: 250 },
          );
          if (cancelled) return;
          setStatusRows(normalizeStatuses((companyDoc as Record<string, unknown> | null)?.projectStatuses));
          setDashboardLegendRows(normalizeDashboardLegend((companyDoc as Record<string, unknown> | null)?.dashboardCompleteLegend));
          setCompanyMembers(members);
          setRoleRows(normalizeRoleRows((companyDoc as Record<string, unknown> | null)?.roles));
          const themeColor = String((companyDoc as Record<string, unknown> | null)?.themeColor ?? "").trim();
          if (themeColor) setCompanyThemeColor(themeColor);
        } else {
          setStatusRows(normalizeStatuses(undefined));
          setDashboardLegendRows([]);
          setCompanyMembers([]);
          setRoleRows([]);
        }
      } catch {
        if (cancelled) return;
        setAllProjects([]);
        setCreatorColorByUid({});
        setStatusRows(normalizeStatuses(undefined));
        setDashboardLegendRows([]);
        setCompanyMembers([]);
        setRoleRows([]);
      } finally {
        if (!cancelled) {
          setIsLoading(false);
        }
      }
    };
    void load();
    return () => {
      cancelled = true;
    };
  }, [user?.companyId, user?.uid]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const onUserColorUpdated = (event: Event) => {
      const detail = (event as CustomEvent<UserColorUpdatedDetail>).detail;
      const uid = String(detail?.uid || "").trim();
      const color = String(detail?.color || "").trim();
      if (!uid) return;
      setCreatorColorByUid((prev) => {
        const next = { ...prev };
        if (color) next[uid] = color;
        else delete next[uid];
        return next;
      });
      setCompanyMembers((prev) =>
        prev.map((member) =>
          String(member.uid || "").trim() === uid
            ? { ...member, badgeColor: color || undefined, userColor: color || undefined }
            : member,
        ),
      );
    };
    window.addEventListener(USER_COLOR_UPDATED_EVENT, onUserColorUpdated as EventListener);
    return () => {
      window.removeEventListener(USER_COLOR_UPDATED_EVENT, onUserColorUpdated as EventListener);
    };
  }, []);

  const openNewProjectModal = () => {
    window.dispatchEvent(new Event("cutsmart:new-project"));
  };

  const statusColorByName = useMemo(() => {
    const map = new Map<string, string>();
    for (const row of statusRows) {
      map.set(String(row.name || "").trim().toLowerCase(), String(row.color || "").trim() || "#64748B");
    }
    return map;
  }, [statusRows]);

  const statusOptions = useMemo(() => {
    const options = statusRows.map((row) => row.name).filter(Boolean);
    return options.length ? options : ["New", "In Production", "On Hold", "Complete"];
  }, [statusRows]);

  const projectStatusPillStyle = (statusLabel: string) => {
    const configured = statusColorByName.get(String(statusLabel || "").trim().toLowerCase());
    if (configured) {
      return { backgroundColor: configured, color: "#FFFFFF" };
    }
    return statusPillColors(statusLabel);
  };
  const canEditProjectFromDashboard = (project: Project) =>
    projectTabAccess(
      project,
      String(effectiveCompanyRole || user?.role || "").trim().toLowerCase() || "staff",
      "general",
      user?.uid,
      effectiveCompanyPermissions.length ? effectiveCompanyPermissions : user?.permissions ?? [],
    ).edit;

  const openProjectInDashboard = async (projectId: string) => {
    router.push(`/projects/${projectId}`);
  };

  const onSelectProjectStatus = async (project: Project, nextStatus: string) => {
    if (!nextStatus || statusUpdatingProjectId || !canEditProjectFromDashboard(project)) return;
    setStatusUpdatingProjectId(project.id);
    const ok = await updateProjectStatus(project, nextStatus);
    if (ok) {
      setAllProjects((prev) =>
        prev.map((row) =>
          row.id === project.id ? { ...row, statusLabel: nextStatus, updatedAt: new Date().toISOString() } : row,
        ),
      );
      setStatusMenuProjectId("");
      setStatusMenuPos(null);
    }
    setStatusUpdatingProjectId("");
  };

  const statusMenuProject = useMemo(
    () => allProjects.find((p) => p.id === statusMenuProjectId) ?? null,
    [allProjects, statusMenuProjectId],
  );

  useEffect(() => {
    if (!statusMenuProjectId) return;

    const closeMenu = () => {
      setStatusMenuProjectId("");
      setStatusMenuPos(null);
    };

    const onPointerDown = (event: MouseEvent) => {
      const target = event.target as HTMLElement | null;
      if (!target) return;
      if (target.closest("[data-status-menu='true']")) return;
      if (target.closest("[data-status-trigger='true']")) return;
      closeMenu();
    };

    document.addEventListener("mousedown", onPointerDown);
    window.addEventListener("resize", closeMenu);
    window.addEventListener("scroll", closeMenu, true);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      window.removeEventListener("resize", closeMenu);
      window.removeEventListener("scroll", closeMenu, true);
    };
  }, [statusMenuProjectId]);

  useEffect(() => {
    if (typeof document === "undefined") return;
    if (!showCompletedProjectsModal && !showStaffModal) return;
    const scrollY = window.scrollY;
    const scrollbarGutterWidth = Math.max(0, window.innerWidth - document.documentElement.clientWidth);
    const prevHtmlOverflow = document.documentElement.style.overflow;
    const prevHtmlOverflowY = document.documentElement.style.overflowY;
    const prevBodyOverflow = document.body.style.overflow;
    const prevBodyOverflowY = document.body.style.overflowY;
    const prevBodyPosition = document.body.style.position;
    const prevBodyTop = document.body.style.top;
    const prevBodyLeft = document.body.style.left;
    const prevBodyRight = document.body.style.right;
    const prevBodyWidth = document.body.style.width;
    const prevBodyPaddingRight = document.body.style.paddingRight;
    document.documentElement.style.overflow = "hidden";
    document.documentElement.style.overflowY = "hidden";
    document.body.style.overflow = "hidden";
    document.body.style.overflowY = "hidden";
    document.body.style.position = "fixed";
    document.body.style.top = `-${scrollY}px`;
    document.body.style.left = "0";
    document.body.style.right = "0";
    document.body.style.width = "100%";
    document.body.style.paddingRight =
      scrollbarGutterWidth > 0 ? `${scrollbarGutterWidth}px` : prevBodyPaddingRight;
    return () => {
      document.documentElement.style.overflow = prevHtmlOverflow;
      document.documentElement.style.overflowY = prevHtmlOverflowY;
      document.body.style.overflow = prevBodyOverflow;
      document.body.style.overflowY = prevBodyOverflowY;
      document.body.style.position = prevBodyPosition;
      document.body.style.top = prevBodyTop;
      document.body.style.left = prevBodyLeft;
      document.body.style.right = prevBodyRight;
      document.body.style.width = prevBodyWidth;
      document.body.style.paddingRight = prevBodyPaddingRight;
      window.scrollTo({ top: scrollY, behavior: "auto" });
    };
  }, [showCompletedProjectsModal, showStaffModal]);

  useEffect(() => {
    return () => {
      if (completedModalTimerRef.current != null) {
        window.clearTimeout(completedModalTimerRef.current);
      }
      if (staffModalTimerRef.current != null) {
        window.clearTimeout(staffModalTimerRef.current);
      }
    };
  }, []);

  const filtered = useMemo(() => {
    let rows = allProjects.filter((project) => {
      const statusLabel = String(project.statusLabel || "New");

      if (quickFilter === "active" && isCompletedStatus(statusLabel)) {
        return false;
      }
      if (quickFilter === "completed" && !isCompletedStatus(statusLabel)) {
        return false;
      }

      const tagsText = (project.tags || []).join(" ");
      const haystack = `${project.name} ${assignedDisplayName(project)} ${statusLabel} ${tagsText}`.toLowerCase();
      if (search && !haystack.includes(search.toLowerCase())) {
        return false;
      }

      return true;
    });

    rows = rows.sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)));

    const openRows = rows.filter((r) => !isCompletedStatus(r.statusLabel));
    const completeRows = rows.filter((r) => isCompletedStatus(r.statusLabel));
    return [...openRows, ...completeRows];
  }, [allProjects, quickFilter, search]);
  const showProjectsLoadingState = isLoading && filtered.length === 0;

  const stats = useMemo(() => {
    const total = allProjects.length;
    const active = allProjects.filter((p) => !isCompletedStatus(p.statusLabel)).length;
    const completed = allProjects.filter((p) => isCompletedStatus(p.statusLabel)).length;
    const staff = companyMembers.length;

    const now = new Date();
    const weekStart = new Date(now);
    // Monday-start week for parity with desktop expectations.
    const day = weekStart.getDay();
    const daysFromMonday = (day + 6) % 7;
    weekStart.setDate(weekStart.getDate() - daysFromMonday);
    weekStart.setHours(0, 0, 0, 0);
    const weekStartMs = weekStart.getTime();

    const wasCreatedThisWeek = (value: string) => {
      const ms = new Date(String(value || "")).getTime();
      return Number.isFinite(ms) && ms >= weekStartMs;
    };

    const totalThisWeek = allProjects.filter((p) => wasCreatedThisWeek(p.createdAt)).length;
    const activeThisWeek = allProjects.filter(
      (p) => !isCompletedStatus(p.statusLabel) && wasCreatedThisWeek(p.createdAt),
    ).length;
    const completedThisWeek = allProjects.filter((p) => {
      if (!isCompletedStatus(p.statusLabel)) return false;
      const updatedMs = new Date(String(p.updatedAt || "")).getTime();
      return Number.isFinite(updatedMs) && updatedMs >= weekStartMs;
    }).length;

    const staffThisWeek = companyMembers.filter((member) => {
      const raw = member as unknown as Record<string, unknown>;
      const createdMs = new Date(String(raw.createdAtIso ?? raw.createdAt ?? "")).getTime();
      return Number.isFinite(createdMs) && createdMs >= weekStartMs;
    }).length;

    return {
      total,
      active,
      completed,
      staff,
      weekly: {
        total: totalThisWeek,
        active: activeThisWeek,
        completed: completedThisWeek,
        staff: staffThisWeek,
      },
    };
  }, [allProjects, companyMembers]);

  const completedProjects = useMemo(() => {
    return allProjects
      .filter((project) => isCompletedStatus(project.statusLabel))
      .map((project) => ({
        project,
        completedIso: completedProjectIso(project),
        monthKey: monthKeyFromIso(completedProjectIso(project)),
      }))
      .sort((a, b) => String(b.completedIso).localeCompare(String(a.completedIso)));
  }, [allProjects]);

  const completedMonthOptions = useMemo(() => {
    return Array.from(new Set(completedProjects.map((row) => row.monthKey).filter(Boolean))).sort(
      (a, b) => monthSortValue(b) - monthSortValue(a),
    );
  }, [completedProjects]);

  useEffect(() => {
    if (!completedMonthOptions.length) {
      setCompletedMonthFrom("");
      setCompletedMonthTo("");
      return;
    }
    setCompletedMonthFrom((prev) => (prev && completedMonthOptions.includes(prev) ? prev : completedMonthOptions[completedMonthOptions.length - 1]));
    setCompletedMonthTo((prev) => (prev && completedMonthOptions.includes(prev) ? prev : completedMonthOptions[0]));
  }, [completedMonthOptions]);

  useEffect(() => {
    if (!dashboardLegendRows.length) {
      if (activeCompletedLegendId) {
        setActiveCompletedLegendId("");
      }
      return;
    }
    if (dashboardLegendRows.some((row) => row.id === activeCompletedLegendId)) return;
    setActiveCompletedLegendId(dashboardLegendRows[0]?.id || "");
  }, [activeCompletedLegendId, dashboardLegendRows]);

  const filteredCompletedProjects = useMemo(() => {
    const fromValue = monthSortValue(completedMonthFrom);
    const toValue = monthSortValue(completedMonthTo);
    const lower = fromValue > 0 && toValue > 0 ? Math.min(fromValue, toValue) : null;
    const upper = fromValue > 0 && toValue > 0 ? Math.max(fromValue, toValue) : null;
    return completedProjects.filter((row) => {
      if (!row.monthKey || lower == null || upper == null) return true;
      const value = monthSortValue(row.monthKey);
      return value >= lower && value <= upper;
    });
  }, [completedMonthFrom, completedMonthTo, completedProjects]);

  const completedProjectsByMonth = useMemo(() => {
    const groups = new Map<string, typeof filteredCompletedProjects>();
    filteredCompletedProjects.forEach((row) => {
      const key = row.monthKey || "unknown";
      const existing = groups.get(key);
      if (existing) existing.push(row);
      else groups.set(key, [row]);
    });
    return Array.from(groups.entries()).sort((a, b) => monthSortValue(b[0]) - monthSortValue(a[0]));
  }, [filteredCompletedProjects]);

  const onOpenCompletedProjectsModal = () => {
    if (completedModalTimerRef.current != null) {
      window.clearTimeout(completedModalTimerRef.current);
      completedModalTimerRef.current = null;
    }
    if (typeof window !== "undefined") {
      const rect = completedCardRef.current?.getBoundingClientRect();
      if (rect) {
        setCompletedCardRect({
          left: rect.left,
          top: rect.top,
          width: rect.width,
          height: rect.height,
        });
      } else {
        setCompletedCardRect({
          left: Math.max(16, window.innerWidth / 2 - 140),
          top: Math.max(16, window.innerHeight / 2 - 70),
          width: 280,
          height: 140,
        });
      }
    }
    setShowCompletedProjectsModal(true);
    setCompletedProjectsModalExpanded(false);
    window.requestAnimationFrame(() => {
      window.requestAnimationFrame(() => setCompletedProjectsModalExpanded(true));
    });
  };

  const onCloseCompletedProjectsModal = () => {
    setCompletedProjectsModalExpanded(false);
    completedModalTimerRef.current = window.setTimeout(() => {
      setShowCompletedProjectsModal(false);
      completedModalTimerRef.current = null;
    }, 420);
  };

  const onOpenStaffModal = () => {
    if (staffModalTimerRef.current != null) {
      window.clearTimeout(staffModalTimerRef.current);
      staffModalTimerRef.current = null;
    }
    if (typeof window !== "undefined") {
      const rect = staffCardRef.current?.getBoundingClientRect();
      if (rect) {
        setStaffCardRect({
          left: rect.left,
          top: rect.top,
          width: rect.width,
          height: rect.height,
        });
      } else {
        setStaffCardRect({
          left: Math.max(16, window.innerWidth / 2 - 140),
          top: Math.max(16, window.innerHeight / 2 - 70),
          width: 280,
          height: 140,
        });
      }
    }
    setShowStaffModal(true);
    setStaffModalExpanded(false);
    window.requestAnimationFrame(() => {
      window.requestAnimationFrame(() => setStaffModalExpanded(true));
    });
  };

  const onCloseStaffModal = () => {
    setStaffModalExpanded(false);
    staffModalTimerRef.current = window.setTimeout(() => {
      setShowStaffModal(false);
      staffModalTimerRef.current = null;
    }, 420);
  };

  const onSelectCompletedProjectDate = async (project: Project, nextDateValue: string) => {
    const nextIso = dateInputValueToCompletedIso(nextDateValue);
    if (!nextIso) return;
    setCompletedDateUpdatingProjectId(project.id);
    const ok = await updateProjectPatch(project, { completedAtIso: nextIso });
    if (ok) {
      setAllProjects((prev) =>
        prev.map((row) =>
          row.id === project.id
            ? (Object.assign({}, row, { completedAtIso: nextIso, updatedAt: new Date().toISOString() }) as Project)
            : row,
        ),
      );
    }
    setCompletedDateUpdatingProjectId("");
  };

  const onApplyCompletedProjectLegend = async (project: Project) => {
    const nextLegendId = String(activeCompletedLegendId || "").trim();
    if (!nextLegendId) return;
    const rawProject = project as unknown as Record<string, unknown>;
    const currentLegendId = String(rawProject.dashboardCompleteStatusId ?? "").trim();
    if (currentLegendId === nextLegendId) return;
    const stableCompletedIso = completedProjectIso(project);
    setCompletedLegendUpdatingProjectId(project.id);
    const patch: Record<string, unknown> = { dashboardCompleteStatusId: nextLegendId };
    if (!String(rawProject.completedAtIso ?? "").trim() && stableCompletedIso) {
      patch.completedAtIso = stableCompletedIso;
    }
    const ok = await updateProjectPatch(project, patch);
    if (ok) {
      setAllProjects((prev) =>
        prev.map((row) =>
          row.id === project.id
            ? (Object.assign(
                {},
                row,
                {
                  dashboardCompleteStatusId: nextLegendId,
                  completedAtIso: String((row as unknown as Record<string, unknown>).completedAtIso ?? "").trim() || stableCompletedIso,
                },
              ) as Project)
            : row,
        ),
      );
    }
    setCompletedLegendUpdatingProjectId("");
  };

  const openCompletedDatePicker = (projectId: string) => {
    const input = completedDateInputRefs.current[projectId];
    if (!input) return;
    const picker = input as HTMLInputElement & { showPicker?: () => void };
    try {
      if (typeof picker.showPicker === "function") {
        picker.showPicker();
        return;
      }
    } catch {
      // Fall back to focus/click for browsers that gate showPicker.
    }
    input.focus();
    input.click();
  };

  const completedProjectsModal =
    showCompletedProjectsModal && typeof document !== "undefined"
      ? createPortal(
          <div className="fixed inset-0 z-[1600] flex items-center justify-center px-4 py-4">
            <button
              type="button"
              aria-label="Close completed projects backdrop"
              onClick={onCloseCompletedProjectsModal}
              className="absolute inset-0 bg-[rgba(15,23,42,0.45)] backdrop-blur-[2px] transition-opacity duration-[420ms]"
              style={{ opacity: completedProjectsModalExpanded ? 1 : 0 }}
            />
            {(() => {
              const targetWidth = Math.min(920, window.innerWidth - 32);
              const targetHeight = Math.min(window.innerHeight * 0.86, 760);
              const targetLeft = Math.max(16, (window.innerWidth - targetWidth) / 2);
              const targetTop = Math.max(16, (window.innerHeight - targetHeight) / 2);
              const startRect = completedCardRect ?? {
                left: targetLeft,
                top: targetTop,
                width: targetWidth,
                height: targetHeight,
              };
              const shellRect = completedProjectsModalExpanded
                ? { left: targetLeft, top: targetTop, width: targetWidth, height: targetHeight }
                : startRect;
              return (
                <div
                  className="pointer-events-none fixed z-[1601]"
                  style={{
                    left: shellRect.left,
                    top: shellRect.top,
                    width: shellRect.width,
                    height: shellRect.height,
                    transition: "left 420ms cubic-bezier(0.22, 1, 0.36, 1), top 420ms cubic-bezier(0.22, 1, 0.36, 1), width 420ms cubic-bezier(0.22, 1, 0.36, 1), height 420ms cubic-bezier(0.22, 1, 0.36, 1), transform 420ms cubic-bezier(0.22, 1, 0.36, 1)",
                    transformStyle: "preserve-3d",
                    transform: `perspective(1800px) rotateX(${completedProjectsModalExpanded ? 180 : 0}deg)`,
                  }}
                >
                  <div
                    className="absolute inset-0 rounded-[14px] border border-[#ECECF0] bg-white px-4 py-3 shadow-sm"
                    style={{
                      backfaceVisibility: "hidden",
                      WebkitBackfaceVisibility: "hidden",
                      borderColor: dashboardPalette.border,
                      backgroundColor: dashboardPalette.panelBg,
                      boxShadow: dashboardPalette.strongShadow,
                    }}
                  >
                    <div className="mb-2 flex items-center gap-2">
                      <div
                        className="inline-flex h-[30px] w-[30px] items-center justify-center rounded-full text-white"
                        style={{ backgroundColor: "#50A279" }}
                      >
                        <CheckCircle2 size={16} strokeWidth={2.4} />
                      </div>
                      <p className="text-[14px] font-semibold sm:text-[16px] lg:text-[17px]" style={{ color: dashboardPalette.textSoft }}>Completed</p>
                    </div>
                    <p className="text-[34px] font-medium leading-none sm:text-[40px] lg:text-[46px]" style={{ color: dashboardPalette.text }}>{stats.completed}</p>
                    {stats.weekly.completed > 0 && (
                      <p className="pt-1 text-[13px] font-bold" style={{ color: "#2A7A3B" }}>
                        + {stats.weekly.completed} this week
                      </p>
                    )}
                  </div>
                  <div
                    data-completed-projects-modal="true"
                    className="absolute inset-0 flex flex-col overflow-hidden rounded-[14px] border border-[#D7DEE8] bg-[#F5F6F8] shadow-[0_28px_70px_rgba(2,6,23,0.28)]"
                    style={{
                      backfaceVisibility: "hidden",
                      WebkitBackfaceVisibility: "hidden",
                      transform: "rotateX(180deg)",
                      opacity: completedProjectsModalExpanded ? 1 : 0,
                      pointerEvents: completedProjectsModalExpanded ? "auto" : "none",
                      transition: "opacity 180ms ease",
                      borderColor: dashboardPalette.border,
                      backgroundColor: dashboardPalette.panelMuted,
                    }}
                  >
                    <div className="p-3">
                      <div className="flex min-h-[46px] flex-wrap items-center gap-3 rounded-[14px] border px-3 py-2" style={{ borderColor: dashboardPalette.border, backgroundColor: dashboardPalette.panelBg }}>
                        <p className="text-[13px] font-extrabold uppercase tracking-[1px]" style={{ color: dashboardPalette.text }}>Completed Projects</p>
                        {dashboardLegendRows.length > 0 ? (
                          <div className="flex flex-wrap items-center gap-2">
                            {dashboardLegendRows.map((item) => {
                              const isActive = activeCompletedLegendId === item.id;
                              return (
                                <button
                                  key={item.id}
                                  type="button"
                                  onClick={() => setActiveCompletedLegendId(item.id)}
                                  className="inline-flex h-7 min-w-[28px] items-center justify-center rounded-[999px] border px-2 transition hover:opacity-90"
                                  style={{
                                    borderColor: isActive ? dashboardPalette.text : dashboardPalette.border,
                                    backgroundColor: item.color,
                                    boxShadow: isActive ? `0 0 0 1px ${dashboardPalette.text}` : "none",
                                  }}
                                  title={item.name || "Completed color"}
                                  aria-label={item.name || "Completed color"}
                                >
                                  <span className="sr-only">{item.name || "Completed color"}</span>
                                </button>
                              );
                            })}
                          </div>
                        ) : null}
                        <div className="ml-auto flex flex-wrap items-center gap-2">
                          <span className="text-[11px] font-bold" style={{ color: dashboardPalette.textMuted }}>From</span>
                          <select
                            value={completedMonthFrom}
                            onChange={(e) => setCompletedMonthFrom(e.target.value)}
                            className="h-7 min-w-[140px] rounded-[8px] border border-[#D8DEE8] bg-[#EEF1F5] px-2 text-[12px] font-semibold text-[#334155]"
                            style={{ borderColor: dashboardPalette.border, backgroundColor: dashboardPalette.panelAlt, color: dashboardPalette.textSoft }}
                          >
                            {completedMonthOptions.map((monthKey) => (
                              <option key={`completed_from_${monthKey}`} value={monthKey}>
                                {monthLabelFromKey(monthKey)}
                              </option>
                            ))}
                          </select>
                          <span className="text-[11px] font-bold" style={{ color: dashboardPalette.textMuted }}>To</span>
                          <select
                            value={completedMonthTo}
                            onChange={(e) => setCompletedMonthTo(e.target.value)}
                            className="h-7 min-w-[140px] rounded-[8px] border border-[#D8DEE8] bg-[#EEF1F5] px-2 text-[12px] font-semibold text-[#334155]"
                            style={{ borderColor: dashboardPalette.border, backgroundColor: dashboardPalette.panelAlt, color: dashboardPalette.textSoft }}
                          >
                            {completedMonthOptions.map((monthKey) => (
                              <option key={`completed_to_${monthKey}`} value={monthKey}>
                                {monthLabelFromKey(monthKey)}
                              </option>
                            ))}
                          </select>
                          <button
                            type="button"
                            onClick={onCloseCompletedProjectsModal}
                            className="inline-flex h-8 w-8 items-center justify-center rounded-[8px] border border-[#D8DEE8] bg-white text-[#64748B] hover:bg-[#F8FAFC]"
                            style={{ borderColor: dashboardPalette.border, backgroundColor: dashboardPalette.panelBg, color: dashboardPalette.textMuted }}
                          >
                            <X size={16} />
                          </button>
                        </div>
                      </div>
                    </div>
                    <div className="min-h-0 flex-1 overflow-auto px-3 pb-3">
                      {!completedProjectsByMonth.length ? (
                        <div className="rounded-[14px] border px-4 py-6 text-[13px] font-semibold" style={{ borderColor: dashboardPalette.border, backgroundColor: dashboardPalette.panelBg, color: dashboardPalette.textMuted }}>
                          No completed projects yet.
                        </div>
                      ) : (
                        <div className="grid gap-3 lg:grid-cols-3">
                          {completedProjectsByMonth.map(([monthKey, rows]) => (
                            <section key={`completed_month_${monthKey}`} className="overflow-hidden rounded-[14px] border" style={{ borderColor: dashboardPalette.border, backgroundColor: dashboardPalette.panelAlt }}>
                              <div className="flex h-[42px] items-center justify-between border-b px-3" style={{ borderBottomColor: dashboardPalette.border, backgroundColor: dashboardPalette.panelBg }}>
                                <p className="text-[13px] font-extrabold" style={{ color: dashboardPalette.text }}>{monthLabelFromKey(monthKey)}</p>
                                <span className="inline-flex rounded-[10px] border px-3 py-1 text-[11px] font-bold" style={{ borderColor: dashboardPalette.border, backgroundColor: dashboardPalette.panelMuted, color: dashboardPalette.textSoft }}>
                                  {rows.length} Projects
                                </span>
                              </div>
                              <div className="p-3">
                                {rows.map(({ project, completedIso }, index) => {
                                  const rawProject = project as unknown as Record<string, unknown>;
                                  const legendId = String(rawProject.dashboardCompleteStatusId ?? "").trim();
                                  const legendMatch = dashboardLegendRows.find((row) => row.id === legendId);
                                  const rowFillColor = legendMatch?.color || "";
                                  const rowHasFill = Boolean(rowFillColor);
                                  const rowTextColor = rowHasFill ? rowTextColorForFill(rowFillColor) : dashboardPalette.text;
                                  const rowDateColor = rowHasFill ? rowTextColor : dashboardPalette.textMuted;
                                  const isDateUpdating = completedDateUpdatingProjectId === project.id;
                                  const isLegendUpdating = completedLegendUpdatingProjectId === project.id;
                                  const canApplyLegend = Boolean(activeCompletedLegendId) && !isDateUpdating && !isLegendUpdating;
                                  return (
                                    <div
                                      key={`completed_project_${project.id}`}
                                      className="relative flex items-center justify-between gap-3 px-1 py-2.5"
                                      onClick={() => {
                                        if (!canApplyLegend) return;
                                        void onApplyCompletedProjectLegend(project);
                                      }}
                                      style={{
                                        borderTop: index > 0 ? `1px solid ${dashboardPalette.border}` : "none",
                                        backgroundColor: rowFillColor || "transparent",
                                        cursor: canApplyLegend ? "pointer" : "default",
                                      }}
                                    >
                                      <div className="min-w-0 flex-1">
                                        <button
                                          type="button"
                                          onClick={(event) => {
                                            event.stopPropagation();
                                            onCloseCompletedProjectsModal();
                                            void openProjectInDashboard(project.id);
                                          }}
                                          className="inline-flex max-w-full text-left transition hover:opacity-80"
                                        >
                                          <span className="block truncate pr-3 text-[13px] font-bold" style={{ color: rowTextColor }}>
                                            {project.name || "Untitled"}
                                          </span>
                                        </button>
                                      </div>
                                      <div className="relative shrink-0">
                                        <input
                                          type="date"
                                          ref={(node) => {
                                            completedDateInputRefs.current[project.id] = node;
                                          }}
                                          value={isoToDateInputValue(completedIso)}
                                          onChange={(event) => void onSelectCompletedProjectDate(project, event.currentTarget.value)}
                                          tabIndex={-1}
                                          aria-hidden="true"
                                          className="pointer-events-none absolute h-0 w-0 opacity-0"
                                        />
                                        <button
                                          type="button"
                                          onClick={(event) => {
                                            event.stopPropagation();
                                            openCompletedDatePicker(project.id);
                                          }}
                                          disabled={isDateUpdating}
                                          className="text-[12px] font-bold transition hover:opacity-80 disabled:cursor-wait"
                                          style={{ color: rowDateColor }}
                                        >
                                          {dashboardDateOnly(completedIso)}
                                        </button>
                                      </div>
                                    </div>
                                  );
                                })}
                              </div>
                            </section>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              );
            })()}
          </div>,
          document.body,
        )
      : null;

  const roleNameById = useMemo(() => {
    const map = new Map<string, string>();
    for (const row of roleRows) {
      if (row.id) map.set(row.id, row.name);
    }
    return map;
  }, [roleRows]);

  const roleColorById = useMemo(() => {
    const map = new Map<string, string>();
    for (const row of roleRows) {
      if (row.id) map.set(row.id, row.color);
    }
    return map;
  }, [roleRows]);

  const staffModal =
    showStaffModal && typeof document !== "undefined"
      ? createPortal(
          <div className="fixed inset-0 z-[1600] flex items-center justify-center px-4 py-4">
            <button
              type="button"
              aria-label="Close staff backdrop"
              onClick={onCloseStaffModal}
              className="absolute inset-0 bg-[rgba(15,23,42,0.45)] backdrop-blur-[2px] transition-opacity duration-[420ms]"
              style={{ opacity: staffModalExpanded ? 1 : 0 }}
            />
            {(() => {
              const targetWidth = Math.min(860, window.innerWidth - 32);
              const targetHeight = Math.min(window.innerHeight * 0.82, 720);
              const targetLeft = Math.max(16, (window.innerWidth - targetWidth) / 2);
              const targetTop = Math.max(16, (window.innerHeight - targetHeight) / 2);
              const startRect = staffCardRect ?? {
                left: targetLeft,
                top: targetTop,
                width: targetWidth,
                height: targetHeight,
              };
              const shellRect = staffModalExpanded
                ? { left: targetLeft, top: targetTop, width: targetWidth, height: targetHeight }
                : startRect;
              return (
                <div
                  className="pointer-events-none fixed z-[1601]"
                  style={{
                    left: shellRect.left,
                    top: shellRect.top,
                    width: shellRect.width,
                    height: shellRect.height,
                    transition: "left 420ms cubic-bezier(0.22, 1, 0.36, 1), top 420ms cubic-bezier(0.22, 1, 0.36, 1), width 420ms cubic-bezier(0.22, 1, 0.36, 1), height 420ms cubic-bezier(0.22, 1, 0.36, 1), transform 420ms cubic-bezier(0.22, 1, 0.36, 1)",
                    transformStyle: "preserve-3d",
                    transform: `perspective(1800px) rotateX(${staffModalExpanded ? 180 : 0}deg)`,
                  }}
                >
                  <div
                    className="absolute inset-0 rounded-[14px] border border-[#ECECF0] bg-white px-4 py-3 shadow-sm"
                    style={{
                      backfaceVisibility: "hidden",
                      WebkitBackfaceVisibility: "hidden",
                      borderColor: dashboardPalette.border,
                      backgroundColor: dashboardPalette.panelBg,
                      boxShadow: dashboardPalette.strongShadow,
                    }}
                  >
                    <div className="mb-2 flex items-center gap-2">
                      <div
                        className="inline-flex h-[30px] w-[30px] items-center justify-center rounded-full text-white"
                        style={{ backgroundColor: "#8A72CC" }}
                      >
                        <Users2 size={16} strokeWidth={2.4} />
                      </div>
                      <p className="text-[14px] font-semibold sm:text-[16px] lg:text-[17px]" style={{ color: dashboardPalette.textSoft }}>Staff Members</p>
                    </div>
                    <p className="text-[34px] font-medium leading-none sm:text-[40px] lg:text-[46px]" style={{ color: dashboardPalette.text }}>{stats.staff}</p>
                    {stats.weekly.staff > 0 && (
                      <p className="pt-1 text-[13px] font-bold" style={{ color: "#2A7A3B" }}>
                        + {stats.weekly.staff} this week
                      </p>
                    )}
                  </div>
                  <div
                    data-staff-modal="true"
                    className="absolute inset-0 flex flex-col overflow-hidden rounded-[14px] border border-[#D7DEE8] bg-[#F5F6F8] shadow-[0_28px_70px_rgba(2,6,23,0.28)]"
                    style={{
                      backfaceVisibility: "hidden",
                      WebkitBackfaceVisibility: "hidden",
                      transform: "rotateX(180deg)",
                      opacity: staffModalExpanded ? 1 : 0,
                      pointerEvents: staffModalExpanded ? "auto" : "none",
                      transition: "opacity 180ms ease",
                      borderColor: dashboardPalette.border,
                      backgroundColor: dashboardPalette.panelMuted,
                    }}
                  >
                    <div className="p-3">
                      <div className="flex min-h-[46px] items-center gap-3 rounded-[14px] border px-3 py-2" style={{ borderColor: dashboardPalette.border, backgroundColor: dashboardPalette.panelBg }}>
                        <p className="text-[13px] font-extrabold uppercase tracking-[1px]" style={{ color: dashboardPalette.text }}>Staff Members</p>
                        <span className="inline-flex rounded-[10px] border px-3 py-1 text-[11px] font-bold" style={{ borderColor: dashboardPalette.border, backgroundColor: dashboardPalette.panelMuted, color: dashboardPalette.textSoft }}>
                          {companyMembers.length} Total
                        </span>
                        <div className="ml-auto">
                          <button
                            type="button"
                            onClick={onCloseStaffModal}
                            className="inline-flex h-8 w-8 items-center justify-center rounded-[8px] border border-[#D8DEE8] bg-white text-[#64748B] hover:bg-[#F8FAFC]"
                            style={{ borderColor: dashboardPalette.border, backgroundColor: dashboardPalette.panelBg, color: dashboardPalette.textMuted }}
                          >
                            <X size={16} />
                          </button>
                        </div>
                      </div>
                    </div>
                    <div className="min-h-0 flex-1 overflow-auto px-3 pb-3">
                      {!companyMembers.length ? (
                        <div className="rounded-[14px] border px-4 py-6 text-[13px] font-semibold" style={{ borderColor: dashboardPalette.border, backgroundColor: dashboardPalette.panelBg, color: dashboardPalette.textMuted }}>
                          No staff members found.
                        </div>
                      ) : (
                        <div className="space-y-2">
                          {companyMembers.map((member) => {
                            const roleKey = normalizeRoleKey(member.roleId || member.role);
                            const roleColor = roleColorById.get(roleKey) || "#7D99B3";
                            const roleLabel = roleNameById.get(roleKey) || roleLabelFromKey(roleKey);
                            const avatarColor = String(member.badgeColor || member.userColor || companyThemeColor).trim() || companyThemeColor;
                            return (
                              <div
                                key={`staff_member_${member.uid}`}
                                className="flex items-center gap-3 rounded-[14px] border px-3 py-3"
                                style={{ borderColor: dashboardPalette.border, backgroundColor: dashboardPalette.panelBg }}
                              >
                                <span
                                  className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-[12px] font-bold text-white"
                                  style={{ backgroundColor: avatarColor }}
                                >
                                  {initials(member.displayName || member.email || member.uid)}
                                </span>
                                <div className="min-w-0 flex-1">
                                  <p className="truncate text-[14px] font-bold" style={{ color: dashboardPalette.text }}>
                                    {member.displayName || member.email || member.uid}
                                  </p>
                                  <div className="mt-1 flex flex-wrap items-center gap-2">
                                    <span
                                      className="inline-flex rounded-[999px] border px-2.5 py-1 text-[11px] font-bold"
                                      style={{
                                        backgroundColor: roleColor,
                                        borderColor: roleColor,
                                        color: rowTextColorForFill(roleColor),
                                      }}
                                    >
                                      {roleLabel}
                                    </span>
                                    {member.email ? (
                                      <span className="truncate text-[12px] font-semibold" style={{ color: dashboardPalette.textMuted }}>
                                        {member.email}
                                      </span>
                                    ) : null}
                                  </div>
                                </div>
                                <button
                                  type="button"
                                  disabled
                                  className="inline-flex h-9 shrink-0 items-center justify-center rounded-[10px] border border-[#D8DEE8] bg-[#EEF2F7] px-4 text-[12px] font-bold text-[#94A3B8] opacity-70"
                                  style={{ borderColor: dashboardPalette.border, backgroundColor: dashboardPalette.panelMuted, color: isDarkMode ? "#7c8591" : "#94A3B8" }}
                                  title="Coming soon"
                                >
                                  View
                                </button>
                              </div>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              );
            })()}
          </div>,
          document.body,
        )
      : null;

  return (
    <ProtectedRoute>
      <AppShell>
          {!companyAccessResolved ? (
            <div
              className="rounded-[14px] p-6 text-[13px] font-semibold"
              style={{
                border: `1px solid ${dashboardPalette.border}`,
                backgroundColor: dashboardPalette.panelBg,
                color: dashboardPalette.textSoft,
                boxShadow: dashboardPalette.strongShadow,
              }}
            >
              Checking access...
            </div>
          ) : !canAccessDashboard ? (
            <div
              className="rounded-[14px] p-6 text-[13px] font-semibold"
              style={{
                border: `1px solid ${dashboardPalette.border}`,
                backgroundColor: dashboardPalette.panelBg,
                color: dashboardPalette.textSoft,
                boxShadow: dashboardPalette.strongShadow,
              }}
            >
              You do not have permission to access the company dashboard.
            </div>
          ) : (
          <>
          <div className="space-y-0" style={{ backgroundColor: dashboardSurfaceBg }}>

          <div className="relative z-0" style={{ marginBottom: 20 }}>
            <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
              {statCards.map((card) => {
                const Icon = card.icon;
                const value = stats[card.key];
                const isCompletedCard = card.key === "completed";
                const isStaffCard = card.key === "staff";
                const isInteractiveCard = isCompletedCard || isStaffCard;
                return (
                  <div
                    key={card.label}
                    ref={isCompletedCard ? completedCardRef : isStaffCard ? staffCardRef : null}
                    role={isInteractiveCard ? "button" : undefined}
                    tabIndex={isInteractiveCard ? 0 : undefined}
                    onClick={isCompletedCard ? onOpenCompletedProjectsModal : isStaffCard ? onOpenStaffModal : undefined}
                    onKeyDown={
                      isInteractiveCard
                        ? (e) => {
                            if (e.key === "Enter" || e.key === " ") {
                              e.preventDefault();
                              if (isCompletedCard) onOpenCompletedProjectsModal();
                              if (isStaffCard) onOpenStaffModal();
                            }
                          }
                        : undefined
                    }
                    className={`rounded-[14px] border border-[#ECECF0] bg-white px-4 py-3 shadow-sm transition hover:-translate-y-[1px] hover:border-[#D7DEE8] ${
                      isInteractiveCard ? "cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#93C5FD]" : ""
                    }`}
                    style={{
                      borderColor: dashboardPalette.border,
                      backgroundColor: dashboardPalette.panelBg,
                      boxShadow: dashboardPalette.strongShadow,
                    }}
                  >
                    <div className="mb-2 flex items-center gap-2">
                      <div
                        className="inline-flex h-[30px] w-[30px] items-center justify-center rounded-full text-white"
                        style={{ backgroundColor: card.iconBg }}
                      >
                        <Icon size={16} strokeWidth={2.4} />
                      </div>
                      <p className="text-[14px] font-semibold sm:text-[16px] lg:text-[17px]" style={{ color: dashboardPalette.textSoft }}>{card.label}</p>
                    </div>
                    <p className="text-[34px] font-medium leading-none sm:text-[40px] lg:text-[46px]" style={{ color: dashboardPalette.text }}>{value}</p>
                    {stats.weekly[card.key] > 0 && (
                      <p className="pt-1 text-[13px] font-bold" style={{ color: "#2A7A3B" }}>
                        + {stats.weekly[card.key]} this week
                      </p>
                    )}
                  </div>
                );
              })}
            </div>
          </div>

          <div
            className="-mx-4 relative z-10 mt-[-8px] rounded-none border-t bg-white px-[10px] pb-3 pt-[19px] md:-mx-5"
            style={{
              borderTopColor: dashboardPalette.border,
              backgroundColor: dashboardPalette.sectionBg,
            }}
          >
              <div className="mb-2 flex flex-wrap items-center gap-2 pl-0 sm:pl-[10px]">
                <div className="relative w-full min-w-0 sm:min-w-[280px] sm:max-w-[420px]">
                  <Search
                    size={14}
                    className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2"
                    style={{ color: dashboardPalette.textMuted }}
                  />
                  <input
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    placeholder="Search projects..."
                    className="h-9 w-full rounded-[10px] border border-[#E4E7ED] bg-[#F3F5F8] pl-8 pr-3 text-[12px] font-semibold text-[#5B6472] outline-none placeholder:text-[#9AA3B2]"
                    style={{
                      borderColor: dashboardPalette.border,
                      backgroundColor: dashboardPalette.inputBg,
                      color: dashboardPalette.inputText,
                    }}
                  />
                </div>
                <button
                  type="button"
                  className="inline-flex h-8 w-8 items-center justify-center rounded-[8px] border border-[#D8DEE8] bg-[#F1F4F9] text-[#6B7686]"
                  title="Filters"
                  style={{
                    borderColor: dashboardPalette.border,
                    backgroundColor: dashboardPalette.panelMuted,
                    color: dashboardPalette.textMuted,
                  }}
                >
                  <SlidersHorizontal size={13} />
                </button>
              </div>

              <div className="mb-0 flex gap-2 pt-2 pl-0 sm:pl-[10px]">
                {[
                  { key: "all", label: "All" },
                  { key: "active", label: "Active" },
                  { key: "completed", label: "Completed" },
                ].map((option) => (
                  <button
                    key={option.key}
                    onClick={() => setQuickFilter(option.key as QuickFilter)}
                    className="h-8 rounded-[8px] border px-4 text-[12px] font-bold"
                    style={{
                      backgroundColor: quickFilter === option.key ? "#5EA1F7" : dashboardPalette.inputBg,
                      borderColor: quickFilter === option.key ? "#5EA1F7" : dashboardPalette.border,
                      color: quickFilter === option.key ? "#FFFFFF" : dashboardPalette.text,
                    }}
                  >
                    {option.label}
                  </button>
                ))}
              </div>

          </div>

          <div className="-mx-4 md:-mx-5 lg:hidden" style={{ backgroundColor: dashboardPalette.sectionBg }}>
                {showProjectsLoadingState && (
                  <div className="px-3 py-6 text-[13px] font-semibold" style={{ color: dashboardPalette.textMuted }}>Loading projects...</div>
                )}
                {!showProjectsLoadingState && filtered.length === 0 && (
                  <div className="px-3 py-10">
                    <div className="flex flex-col items-center gap-3">
                      <p className="text-[14px] font-bold" style={{ color: dashboardPalette.textSoft }}>No Projects Yet</p>
                      <button
                        type="button"
                        onClick={openNewProjectModal}
                        className="rounded-[10px] border border-[#86EFAC] bg-[#22C55E] px-4 py-2 text-[12px] font-bold text-white hover:bg-[#16A34A]"
                      >
                        Create First Project
                      </button>
                    </div>
                  </div>
                )}
                {!isLoading && filtered.length > 0 && (
                  <div className="grid grid-cols-1 gap-2 px-2 pb-2 md:grid-cols-2">
                    {filtered.map((project) => (
                      <div
                        key={project.id}
                        role="button"
                        tabIndex={0}
                        className="w-full cursor-pointer rounded-[12px] border border-[#DCE3EC] bg-white px-3 py-3 text-left hover:bg-[#F8FAFD] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#93C5FD]"
                        style={{
                          borderColor: dashboardPalette.border,
                          backgroundColor: hoveredProjectId === project.id ? dashboardPalette.rowHover : dashboardPalette.panelBg,
                        }}
                        onMouseEnter={() => setHoveredProjectId(project.id)}
                        onMouseLeave={() => setHoveredProjectId((prev) => (prev === project.id ? "" : prev))}
                        onClick={() => void openProjectInDashboard(project.id)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter" || e.key === " ") {
                            e.preventDefault();
                            void openProjectInDashboard(project.id);
                          }
                        }}
                      >
                        <div className="flex items-start justify-between gap-2">
                          <p className="line-clamp-2 text-[13px] font-bold" style={{ color: dashboardPalette.text }}>{project.name}</p>
                          <button
                            data-status-trigger="true"
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              if (statusUpdatingProjectId === project.id || !canEditProjectFromDashboard(project)) {
                                return;
                              }
                              if (statusMenuProjectId === project.id) {
                                setStatusMenuProjectId("");
                                setStatusMenuPos(null);
                                return;
                              }
                              const trigger = e.currentTarget as HTMLButtonElement;
                              const rect = trigger.getBoundingClientRect();
                              const estimatedMenuHeight = 156;
                              const hasRoomBelow = rect.bottom + estimatedMenuHeight <= window.innerHeight - 8;
                              const hasRoomAbove = rect.top - estimatedMenuHeight >= 8;
                              const shouldOpenUp = !hasRoomBelow && hasRoomAbove;
                              const menuWidth = Math.max(120, Math.round(rect.width));
                              const clampedLeft = Math.min(
                                Math.max(8, rect.left),
                                window.innerWidth - menuWidth - 8,
                              );
                              setStatusMenuPos({
                                left: clampedLeft,
                                top: shouldOpenUp ? Math.max(8, rect.top - estimatedMenuHeight - 4) : rect.bottom + 4,
                                width: menuWidth,
                              });
                              setStatusMenuProjectId(project.id);
                            }}
                            className="inline-flex h-7 w-[118px] shrink-0 items-center justify-center rounded-[10px] px-3 text-[11px] font-bold"
                            style={projectStatusPillStyle(project.statusLabel || "New")}
                            aria-disabled={statusUpdatingProjectId === project.id || !canEditProjectFromDashboard(project)}
                            aria-label="Project status"
                            title={canEditProjectFromDashboard(project) ? "Change project status" : "You can view this project but not change its status"}
                          >
                            {statusUpdatingProjectId === project.id ? "Saving..." : project.statusLabel || "New"}
                          </button>
                        </div>

                        <div className="mt-2 flex flex-wrap gap-1">
                          {project.tags.slice(0, 2).map((tag) => (
                            <span
                              key={tag}
                              className="rounded-[8px] border border-[#D6DEE9] bg-[#EEF2F7] px-2 py-[1px] text-[11px] font-bold text-[#475569]"
                            >
                              {tag}
                            </span>
                          ))}
                          {project.tags.length > 2 && <span className="font-bold text-[#64748B]">...</span>}
                        </div>

                        <div className="mt-2 flex items-center gap-2 text-[12px]">
                          {assignedDisplayName(project) ? (
                            <>
                              <span
                                className="inline-flex h-5 w-5 items-center justify-center rounded-full text-[10px] font-bold text-white"
                                style={{
                                  backgroundColor:
                                    creatorColorByUid[String(project.assignedToUid || "").trim()] || companyThemeColor,
                                }}
                              >
                                {initials(assignedDisplayName(project))}
                              </span>
                              <span style={{ color: dashboardPalette.text }}>{assignedDisplayName(project)}</span>
                            </>
                          ) : null}
                        </div>

                        <div className="mt-2 grid grid-cols-1 gap-1 text-[11px] sm:grid-cols-2" style={{ color: dashboardPalette.textSoft }}>
                          <p>
                            <span className="font-bold" style={{ color: dashboardPalette.textMuted }}>Created:</span> {dashboardDate(project.createdAt)}
                          </p>
                          <p>
                            <span className="font-bold" style={{ color: dashboardPalette.textMuted }}>Modified:</span> {dashboardDate(project.updatedAt)}
                          </p>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>

          <div className="-mx-4 hidden overflow-auto md:-mx-5 lg:block" style={{ backgroundColor: dashboardPalette.sectionBg }}>
                <table className="w-full min-w-[980px] table-fixed text-[12px]" style={{ backgroundColor: dashboardPalette.sectionBg }}>
                  <colgroup>
                    <col style={{ width: "220px" }} />
                    <col style={{ width: "180px" }} />
                    <col style={{ width: "180px" }} />
                    <col style={{ width: "220px" }} />
                    <col style={{ width: "220px" }} />
                    <col style={{ width: "200px" }} />
                  </colgroup>
                  <thead>
                    <tr className="border-b" style={{ borderBottomColor: dashboardPalette.border, backgroundColor: dashboardPalette.panelBg }}>
                      <th className="pb-2 pl-[10px] text-left text-[11px] font-bold" style={{ color: dashboardPalette.textMuted }}>Project Name</th>
                      <th className="pb-2 text-left text-[11px] font-bold" style={{ color: dashboardPalette.textMuted }}>Tags</th>
                      <th className="pb-2 text-left text-[11px] font-bold" style={{ color: dashboardPalette.textMuted }}>Assigned</th>
                      <th className="pb-2 text-center text-[11px] font-bold" style={{ color: dashboardPalette.textMuted }}>Created</th>
                      <th className="pb-2 text-center text-[11px] font-bold" style={{ color: dashboardPalette.textMuted }}>Modified</th>
                      <th className="w-[200px] pb-2 text-right text-[11px] font-bold" style={{ color: dashboardPalette.textMuted }}>
                        <span className="inline-block w-[120px] text-center" style={{ marginRight: 10 }}>
                          Status
                        </span>
                      </th>
                    </tr>
                  </thead>
                  <tbody>

                  {showProjectsLoadingState && (
                    <tr>
                      <td className="py-3" style={{ color: dashboardPalette.textMuted }} colSpan={6}>Loading projects...</td>
                    </tr>
                  )}
                  {!showProjectsLoadingState && filtered.length === 0 && (
                    <tr>
                      <td className="py-10 text-center" colSpan={6}>
                        <div className="flex flex-col items-center gap-3">
                          <p className="text-[14px] font-bold" style={{ color: dashboardPalette.textSoft }}>No Projects Yet</p>
                          <button
                            type="button"
                            onClick={openNewProjectModal}
                            className="rounded-[10px] border border-[#86EFAC] bg-[#22C55E] px-4 py-2 text-[12px] font-bold text-white hover:bg-[#16A34A]"
                          >
                            Create First Project
                          </button>
                        </div>
                      </td>
                    </tr>
                  )}

                  {filtered.map((project) => {
                    const rowBg = hoveredProjectId === project.id ? dashboardPalette.rowHover : dashboardPalette.panelBg;
                    return (
                    <tr
                      key={project.id}
                      className="cursor-pointer border-b"
                      style={{ borderBottomColor: dashboardPalette.border }}
                      onMouseEnter={() => setHoveredProjectId(project.id)}
                      onMouseLeave={() => setHoveredProjectId((prev) => (prev === project.id ? "" : prev))}
                      onClick={() => void openProjectInDashboard(project.id)}
                    >
                      <td className="py-[7px] pl-[10px] font-bold" style={{ color: dashboardPalette.text, backgroundColor: rowBg }}>{project.name}</td>
                      <td className="py-[7px]" style={{ backgroundColor: rowBg }}>
                        <div className="flex flex-wrap gap-1">
                          {project.tags.slice(0, 2).map((tag) => (
                            <span
                              key={tag}
                              className="rounded-[8px] border px-2 py-[1px] text-[11px] font-bold"
                              style={{
                                borderColor: dashboardPalette.border,
                                backgroundColor: dashboardPalette.panelMuted,
                                color: dashboardPalette.textSoft,
                              }}
                            >
                              {tag}
                            </span>
                          ))}
                          {project.tags.length > 2 && <span className="font-bold" style={{ color: dashboardPalette.textMuted }}>...</span>}
                        </div>
                      </td>
                      <td className="py-[7px]" style={{ backgroundColor: rowBg }}>
                        <div className="flex items-center gap-2 text-[12px]">
                          {assignedDisplayName(project) ? (
                            <>
                              <span
                                className="inline-flex h-5 w-5 items-center justify-center rounded-full text-[10px] font-bold text-white"
                                style={{
                                  backgroundColor:
                                    creatorColorByUid[String(project.assignedToUid || "").trim()] || companyThemeColor,
                                }}
                              >
                                {initials(assignedDisplayName(project))}
                              </span>
                              <span style={{ color: dashboardPalette.text }}>{assignedDisplayName(project)}</span>
                            </>
                          ) : null}
                        </div>
                      </td>
                      <td className="py-[7px] text-center text-[12px]" style={{ color: dashboardPalette.textSoft, backgroundColor: rowBg }}>{dashboardDate(project.createdAt)}</td>
                      <td className="py-[7px] text-center text-[12px]" style={{ color: dashboardPalette.textSoft, backgroundColor: rowBg }}>{dashboardDate(project.updatedAt)}</td>
                      <td className="relative w-[200px] py-[7px] text-right" style={{ backgroundColor: rowBg }}>
                          <button
                            data-status-trigger="true"
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              if (statusUpdatingProjectId === project.id || !canEditProjectFromDashboard(project)) {
                                return;
                              }
                              if (statusMenuProjectId === project.id) {
                                setStatusMenuProjectId("");
                                setStatusMenuPos(null);
                                return;
                              }
                              const trigger = e.currentTarget as HTMLButtonElement;
                              const rect = trigger.getBoundingClientRect();
                              const estimatedMenuHeight = 156;
                              const hasRoomBelow = rect.bottom + estimatedMenuHeight <= window.innerHeight - 8;
                              const hasRoomAbove = rect.top - estimatedMenuHeight >= 8;
                              const shouldOpenUp = !hasRoomBelow && hasRoomAbove;
                              const menuWidth = Math.max(120, Math.round(rect.width));
                              const clampedLeft = Math.min(
                                Math.max(8, rect.left),
                                window.innerWidth - menuWidth - 8,
                              );
                              setStatusMenuPos({
                                left: clampedLeft,
                                top: shouldOpenUp
                                  ? Math.max(8, rect.top - estimatedMenuHeight - 4)
                                  : rect.bottom + 4,
                                width: menuWidth,
                              });
                              setStatusMenuProjectId(project.id);
                            }}
                            className="inline-flex w-[120px] items-center justify-center rounded-[10px] px-3 py-[3px] text-[12px] font-bold"
                            style={{ ...projectStatusPillStyle(project.statusLabel || "New"), marginRight: 10 }}
                            aria-disabled={statusUpdatingProjectId === project.id || !canEditProjectFromDashboard(project)}
                            aria-label="Project status"
                            title={canEditProjectFromDashboard(project) ? "Change project status" : "You can view this project but not change its status"}
                          >
                            {statusUpdatingProjectId === project.id ? "Saving..." : project.statusLabel || "New"}
                          </button>
                      </td>
                    </tr>
                  );
                  })}
                  </tbody>
                </table>
              </div>

              {statusMenuProject &&
                statusMenuPos &&
                createPortal(
                  <div
                    data-status-menu="true"
                    className="fixed overflow-hidden rounded-[10px] border border-[#D7DEE8] bg-white shadow-[0_20px_44px_rgba(15,23,42,0.30),0_6px_14px_rgba(15,23,42,0.18)]"
                    style={{
                      left: statusMenuPos.left,
                      top: statusMenuPos.top,
                      width: statusMenuPos.width,
                      zIndex: 2147483647,
                      borderColor: dashboardPalette.border,
                      backgroundColor: dashboardPalette.panelBg,
                    }}
                    onClick={(e) => e.stopPropagation()}
                  >
                    {statusOptions.map((option) => {
                      const active =
                        String(statusMenuProject.statusLabel || "").trim().toLowerCase() === option.toLowerCase();
                      const rowColor = statusColorByName.get(String(option || "").trim().toLowerCase()) || "#64748B";
                      return (
                        <button
                          key={`${statusMenuProject.id}_${option}`}
                          type="button"
                          disabled={statusUpdatingProjectId === statusMenuProject.id}
                          onClick={() => void onSelectProjectStatus(statusMenuProject, option)}
                          className="block w-full border-b px-3 py-2 text-center text-[12px] font-semibold text-white disabled:opacity-55"
                          style={{
                            backgroundColor: rowColor,
                            filter: active ? "brightness(0.96)" : "brightness(1)",
                            borderBottomColor: isDarkMode ? "#232323" : "#EEF2F7",
                          }}
                        >
                          {option}
                        </button>
                      );
                    })}
                  </div>,
                  document.body,
                )}

            </div>
            {completedProjectsModal}
            {staffModal}
          </>
          )}
      </AppShell>
    </ProtectedRoute>
  );
}
