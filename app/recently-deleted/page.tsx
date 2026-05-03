"use client";

import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Check, ChevronDown, ChevronRight, RotateCcw, Search, Trash2 } from "lucide-react";
import { AppShell } from "@/components/app-shell";
import { ProtectedRoute } from "@/components/protected-route";
import { useAuth } from "@/lib/auth-context";
import { fetchCompanyAccess } from "@/lib/membership";
import {
  fetchCompanyDoc,
  fetchDeletedProjects,
  fetchUserColorMapByUids,
  permanentlyDeleteProject,
  purgeExpiredDeletedProjects,
  restoreDeletedProject,
} from "@/lib/firestore-data";
import type { CompanyLeadRow } from "@/lib/firestore-data";
import type { Project } from "@/lib/types";
import { USER_COLOR_UPDATED_EVENT, type UserColorUpdatedDetail } from "@/lib/user-color-sync";

const RESERVED_LEAD_FIELD_KEYS = new Set(["companyid", "source", "status"]);
const LEAD_ARCHIVE_UPDATED_EVENT = "cutsmart_lead_archive_updated";

type LeadProjectFieldTarget = "" | "clientName" | "clientPhone" | "clientEmail" | "projectAddress" | "projectNotes";
type LeadFieldLayoutRow = {
  key: string;
  label: string;
  showInRow: boolean;
  showInDetail: boolean;
  order: number;
  projectFieldTarget: LeadProjectFieldTarget;
};

type StatusRow = { name: string; color: string };

function formatDeletedDate(value: string) {
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return "-";
  const day = d.toLocaleDateString(undefined, { day: "2-digit" });
  const month = d.toLocaleDateString(undefined, { month: "long" });
  const year = d.toLocaleDateString(undefined, { year: "numeric" });
  const time = d
    .toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit", hour12: true })
    .replace(" ", "")
    .toLowerCase();
  return `${day} ${month} ${year}  |  ${time}`;
}

function formatDateOnly(value: string) {
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return "-";
  const day = d.toLocaleDateString(undefined, { day: "2-digit" });
  const month = d.toLocaleDateString(undefined, { month: "long" });
  const year = d.toLocaleDateString(undefined, { year: "numeric" });
  return `${day} ${month} ${year}`;
}

function toSafeInt(value: unknown) {
  const num = Number.parseInt(String(value ?? "0"), 10);
  return Number.isFinite(num) ? num : 0;
}

function getProjectProductSummary(project: Project) {
  const settings = (project.projectSettings ?? {}) as Record<string, unknown>;
  const rowsSources: unknown[] = [
    (settings.cutlist as Record<string, unknown> | undefined)?.rows,
    settings.cutlistRows,
    settings.productionCutlistRows,
    (settings.production as Record<string, unknown> | undefined)?.rows,
  ];
  const rows = rowsSources.find((src) => Array.isArray(src)) as unknown[] | undefined;
  const piecesFromRows = Array.isArray(rows)
    ? rows.reduce<number>((sum, row) => {
        const item = (row ?? {}) as Record<string, unknown>;
        const qty = toSafeInt(item.Quantity ?? item.quantity ?? item.qty ?? 1);
        return sum + (qty > 0 ? qty : 1);
      }, 0)
    : 0;

  const piecesHints = [
    settings.totalPieces,
    settings.piecesCount,
    (settings.cutlistSummary as Record<string, unknown> | undefined)?.totalPieces,
  ];
  const hintedPieces = piecesHints.map(toSafeInt).find((v) => v > 0) ?? 0;
  const pieces = piecesFromRows > 0 ? piecesFromRows : hintedPieces;

  const sheetHints = [
    project.estimatedSheets,
    settings.totalSheets,
    settings.sheetsCount,
    (settings.nestingSummary as Record<string, unknown> | undefined)?.sheets,
  ];
  const sheets = sheetHints.map(toSafeInt).find((v) => v > 0) ?? 0;

  return { pieces, sheets };
}

function formatRemaining(ms: number) {
  if (ms <= 0) return "Deleting...";
  const totalMinutes = Math.floor(ms / (1000 * 60));
  const totalHours = Math.floor(totalMinutes / 60);
  const totalDays = Math.floor(totalHours / 24);

  if (totalDays >= 30) {
    const months = Math.floor(totalDays / 30);
    const remDaysAfterMonths = totalDays % 30;
    const weeks = Math.floor(remDaysAfterMonths / 7);
    const days = remDaysAfterMonths % 7;
    return `${months}m ${weeks}w ${days}d`;
  }

  if (totalDays >= 7) {
    const weeks = Math.floor(totalDays / 7);
    const days = totalDays % 7;
    return `${weeks}w ${days}d`;
  }

  if (totalDays >= 1) {
    const days = totalDays;
    const hours = totalHours % 24;
    return `${days}d ${hours}hr`;
  }

  if (totalHours >= 1) {
    return `${totalHours}hr`;
  }

  const rounded10 = Math.floor(totalMinutes / 10) * 10;
  return `${Math.max(0, rounded10)}m`;
}

function getRemainingRefreshMs(ms: number) {
  if (ms <= 0) return 10 * 60 * 1000;
  const oneHour = 60 * 60 * 1000;
  const oneDay = 24 * oneHour;
  const oneWeek = 7 * oneDay;
  if (ms < oneHour) return 10 * 60 * 1000;
  if (ms < oneWeek) return oneHour;
  return oneDay;
}

function initialsFromName(name: string) {
  const cleaned = String(name || "").trim();
  if (!cleaned) return "CU";
  const parts = cleaned.split(/\s+/).filter(Boolean);
  if (parts.length === 1) {
    return parts[0].slice(0, 2).toUpperCase();
  }
  return `${parts[0][0] ?? ""}${parts[1][0] ?? ""}`.toUpperCase();
}

function formatLeadFieldLabel(key: string) {
  const raw = String(key || "").trim();
  if (!raw) return "Field";
  return raw
    .replace(/[_-]+/g, " ")
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/\b\w/g, (match) => match.toUpperCase());
}

function normalizeLeadFieldKey(key: string) {
  return String(key || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "");
}

function normalizeLeadFieldLayout(raw: unknown): LeadFieldLayoutRow[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((item, idx) => {
      const row = (item ?? {}) as Record<string, unknown>;
      const key = String(row.key || "").trim();
      if (!key) return null;
      const label = String(row.label || "").trim() || formatLeadFieldLabel(key);
      return {
        key,
        label,
        showInRow: Boolean(row.showInRow),
        showInDetail: row.showInDetail == null ? true : Boolean(row.showInDetail),
        order: Number.isFinite(Number(row.order)) ? Number(row.order) : idx,
        projectFieldTarget: ([ 
          "",
          "clientName",
          "clientPhone",
          "clientEmail",
          "projectAddress",
          "projectNotes",
        ] as LeadProjectFieldTarget[]).includes(String(row.projectFieldTarget || "").trim() as LeadProjectFieldTarget)
          ? (String(row.projectFieldTarget || "").trim() as LeadProjectFieldTarget)
          : "",
      } satisfies LeadFieldLayoutRow;
    })
    .filter((row): row is LeadFieldLayoutRow => Boolean(row));
}

type LeadDynamicField = {
  key: string;
  label: string;
  value: string;
};

function mergeLeadFieldLayout(
  availableFields: Array<{ key: string; label: string }>,
  savedLayout: LeadFieldLayoutRow[],
): LeadFieldLayoutRow[] {
  const byKey = new Map(savedLayout.map((row) => [normalizeLeadFieldKey(row.key), row] as const));
  return availableFields
    .map((field, idx) => {
      const existing = byKey.get(normalizeLeadFieldKey(field.key));
      return {
        key: existing?.key || field.key,
        label: existing?.label || field.label,
        showInRow: existing?.showInRow ?? idx < 3,
        showInDetail: existing?.showInDetail ?? true,
        order: Number.isFinite(Number(existing?.order)) ? Number(existing?.order) : idx,
        projectFieldTarget: existing?.projectFieldTarget ?? "",
      } satisfies LeadFieldLayoutRow;
    })
    .sort((a, b) => {
      const orderDiff = Number(a.order) - Number(b.order);
      if (orderDiff !== 0) return orderDiff;
      return a.label.localeCompare(b.label);
    });
}

function leadValueToText(value: unknown): string {
  if (value == null) return "";
  if (Array.isArray(value)) {
    return value.map((item) => leadValueToText(item)).filter(Boolean).join(", ");
  }
  if (typeof value === "object") {
    return Object.entries(value as Record<string, unknown>)
      .map(([key, item]) => `${formatLeadFieldLabel(key)}: ${leadValueToText(item)}`)
      .filter((item) => item.endsWith(": ") === false)
      .join(" | ");
  }
  return String(value).trim();
}

async function fetchArchivedLeadsFromApi(companyId: string): Promise<CompanyLeadRow[]> {
  const cid = String(companyId || "").trim();
  if (!cid) return [];
  try {
    const response = await fetch(`/api/leads?companyId=${encodeURIComponent(cid)}`, {
      method: "GET",
      cache: "no-store",
    });
    const detail = (await response.json().catch(() => null)) as { leads?: CompanyLeadRow[] } | null;
    const fetchedLeads = response.ok && Array.isArray(detail?.leads) ? detail.leads : [];
    return fetchedLeads.filter((lead) => String(lead.status || "").trim().toLowerCase() === "archived");
  } catch {
    return [];
  }
}

function getLeadDynamicFields(lead: CompanyLeadRow): LeadDynamicField[] {
  const raw = lead.rawFields ?? {};
  return Object.entries(raw)
    .filter(([key]) => {
      const normalized = normalizeLeadFieldKey(key);
      return !RESERVED_LEAD_FIELD_KEYS.has(normalized) && !String(key || "").startsWith("__");
    })
    .map(([key, value]) => ({
      key,
      label: formatLeadFieldLabel(key),
      value: leadValueToText(value),
    }))
    .filter((field) => field.value);
}

function statusPillColors(status: string) {
  const key = String(status || "").trim().toLowerCase();
  const defaults: Record<string, string> = {
    new: "#3060D0",
    contacted: "#C77700",
    qualified: "#6B4FB3",
    converted: "#2A7A3B",
    archived: "#7F1D1D",
  };
  const bg = defaults[key] ?? "#64748B";
  return { backgroundColor: bg, color: "#FFFFFF" };
}

function normalizeLeadStatuses(raw: unknown): StatusRow[] {
  if (!Array.isArray(raw)) {
    return [
      { name: "New", color: "#3060D0" },
      { name: "Contacted", color: "#C77700" },
      { name: "Qualified", color: "#6B4FB3" },
      { name: "Converted", color: "#2A7A3B" },
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
        { name: "Contacted", color: "#C77700" },
        { name: "Qualified", color: "#6B4FB3" },
        { name: "Converted", color: "#2A7A3B" },
      ];
}

function measureStatusPillWidth(options: string[]) {
  const labels = options.map((option) => String(option || "").trim()).filter(Boolean);
  if (!labels.length) return 60;
  if (typeof document === "undefined") {
    const longest = labels.reduce((max, label) => Math.max(max, label.length), 0);
    return Math.max(60, Math.ceil(longest * 6.6 + 10));
  }
  const canvas = document.createElement("canvas");
  const context = canvas.getContext("2d");
  if (!context) {
    const longest = labels.reduce((max, label) => Math.max(max, label.length), 0);
    return Math.max(60, Math.ceil(longest * 6.6 + 10));
  }
  context.font = '700 11px "Segoe UI", Arial, sans-serif';
  const widest = labels.reduce((max, label) => Math.max(max, context.measureText(label).width), 0);
  return Math.max(60, Math.ceil(widest + 10));
}

export default function RecentlyDeletedPage() {
  const ACTIVE_COMPANY_STORAGE_KEY = "cutsmart_active_company_id";
  const { user } = useAuth();
  const [search, setSearch] = useState("");
  const [deletedProjects, setDeletedProjects] = useState<Project[]>([]);
  const [deletedLeads, setDeletedLeads] = useState<CompanyLeadRow[]>([]);
  const [retentionDaysByCompany, setRetentionDaysByCompany] = useState<Record<string, number>>({});
  const [creatorColorByUid, setCreatorColorByUid] = useState<Record<string, string>>({});
  const [companyThemeColor, setCompanyThemeColor] = useState("#2F6BFF");
  const [companyName, setCompanyName] = useState("Company");
  const [isLoading, setIsLoading] = useState(true);
  const [restoringId, setRestoringId] = useState("");
  const [deletingId, setDeletingId] = useState("");
  const [confirmRestoreId, setConfirmRestoreId] = useState("");
  const [confirmDeleteId, setConfirmDeleteId] = useState("");
  const [hoveredRestoreId, setHoveredRestoreId] = useState("");
  const [hoveredDeleteId, setHoveredDeleteId] = useState("");
  const [hoveredRowId, setHoveredRowId] = useState("");
  const [nowMs, setNowMs] = useState(Date.now());
  const [expandedProjectId, setExpandedProjectId] = useState("");
  const [expandedLeadId, setExpandedLeadId] = useState("");
  const [leadFieldLayout, setLeadFieldLayout] = useState<LeadFieldLayoutRow[]>([]);
  const [leadStatusRows, setLeadStatusRows] = useState<StatusRow[]>(normalizeLeadStatuses(undefined));
  const [activeTab, setActiveTab] = useState<"leads" | "projects">("projects");
  const [canAccessDeletedLeads, setCanAccessDeletedLeads] = useState(false);
  const confirmResetTimeoutRef = useRef<number | null>(null);
  const confirmDeleteTimeoutRef = useRef<number | null>(null);

  const clearConfirmRestoreTimeout = () => {
    if (confirmResetTimeoutRef.current !== null) {
      window.clearTimeout(confirmResetTimeoutRef.current);
      confirmResetTimeoutRef.current = null;
    }
  };

  const clearConfirmDeleteTimeout = () => {
    if (confirmDeleteTimeoutRef.current !== null) {
      window.clearTimeout(confirmDeleteTimeoutRef.current);
      confirmDeleteTimeoutRef.current = null;
    }
  };

  const load = useCallback(async () => {
    setIsLoading(true);
    const storedCompanyId =
      typeof window !== "undefined" ? String(window.localStorage.getItem(ACTIVE_COMPANY_STORAGE_KEY) || "").trim() : "";
    const directCompanyId = String(user?.companyId || "").trim();
    const preferredCompanyIds = Array.from(new Set([storedCompanyId, directCompanyId].filter(Boolean)));
    await purgeExpiredDeletedProjects(user?.uid, preferredCompanyIds);
    const rows = await fetchDeletedProjects(user?.uid, preferredCompanyIds);
    setDeletedProjects(rows);
    const companyIds = Array.from(new Set(rows.map((row) => String(row.companyId || "").trim()).filter(Boolean)));
    const selectedCompanyId = storedCompanyId || companyIds[0] || "";
    const creatorUids = rows.map((row) => String(row.createdByUid || "").trim()).filter(Boolean);
    const userColorMap = await fetchUserColorMapByUids(creatorUids, selectedCompanyId);
    setCreatorColorByUid(userColorMap);
    if (selectedCompanyId && user?.uid) {
      const access = await fetchCompanyAccess(selectedCompanyId, user.uid);
      const role = String(access?.role || "").trim().toLowerCase();
      const permitted =
        role === "owner" ||
        role === "admin" ||
        (access?.permissionKeys ?? []).some((item) => {
          const normalized = String(item || "").trim().toLowerCase();
          return normalized === "company.*" || normalized === "leads.*";
        });
      setCanAccessDeletedLeads(permitted);
    } else {
      setCanAccessDeletedLeads(false);
    }
    if (selectedCompanyId) {
      const leads = await fetchArchivedLeadsFromApi(selectedCompanyId);
      setDeletedLeads(leads);
    } else {
      setDeletedLeads([]);
    }
    if (selectedCompanyId) {
      const selectedCompanyDoc = await fetchCompanyDoc(selectedCompanyId);
      const selectedDoc = (selectedCompanyDoc as Record<string, unknown> | null) ?? null;
      const integrations =
        selectedDoc && typeof selectedDoc.integrations === "object" && selectedDoc.integrations !== null
          ? (selectedDoc.integrations as Record<string, unknown>)
          : null;
      const zapierLeads =
        integrations && typeof integrations.zapierLeads === "object" && integrations.zapierLeads !== null
          ? (integrations.zapierLeads as Record<string, unknown>)
          : null;
      const appPrefs =
        selectedDoc && typeof selectedDoc.applicationPreferences === "object" && selectedDoc.applicationPreferences !== null
          ? (selectedDoc.applicationPreferences as Record<string, unknown>)
          : null;
      const selectedName = String(
        selectedDoc?.name ??
          selectedDoc?.companyName ??
          appPrefs?.companyName ??
          "",
      ).trim();
      if (selectedName) setCompanyName(selectedName);
      const selectedThemeColor = String(selectedDoc?.themeColor ?? "").trim();
      if (selectedThemeColor) setCompanyThemeColor(selectedThemeColor);
      setLeadFieldLayout(normalizeLeadFieldLayout(zapierLeads?.fieldLayout));
      setLeadStatusRows(normalizeLeadStatuses(selectedDoc?.leadStatuses));
    } else {
      setLeadFieldLayout([]);
      setLeadStatusRows(normalizeLeadStatuses(undefined));
    }

    if (!companyIds.length) {
      setRetentionDaysByCompany({});
      setIsLoading(false);
      return;
    }

    const entries = await Promise.all(
      companyIds.map(async (companyId) => {
        const doc = await fetchCompanyDoc(companyId);
        const themeColor = String((doc as Record<string, unknown> | null)?.themeColor ?? "").trim();
        if (themeColor) setCompanyThemeColor(themeColor);
        const raw = Number((doc as Record<string, unknown> | null)?.deletedRetentionDays ?? 90);
        const days = Number.isFinite(raw) && raw > 0 ? raw : 90;
        return [companyId, days] as const;
      }),
    );
    setRetentionDaysByCompany(Object.fromEntries(entries));
    setIsLoading(false);
  }, [user?.uid]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    const onLeadArchiveUpdated = (event: Event) => {
      const detail =
        event instanceof CustomEvent && event.detail && typeof event.detail === "object"
          ? (event.detail as { companyId?: string })
          : null;
      const storedCompanyId =
        typeof window !== "undefined" ? String(window.localStorage.getItem(ACTIVE_COMPANY_STORAGE_KEY) || "").trim() : "";
      const targetCompanyId = String(detail?.companyId || storedCompanyId).trim();
      if (!targetCompanyId) return;
      void fetchArchivedLeadsFromApi(targetCompanyId).then((rows) => {
        setDeletedLeads(rows);
      });
    };
    window.addEventListener(LEAD_ARCHIVE_UPDATED_EVENT, onLeadArchiveUpdated as EventListener);
    return () => {
      window.removeEventListener(LEAD_ARCHIVE_UPDATED_EVENT, onLeadArchiveUpdated as EventListener);
    };
  }, []);

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
    };
    window.addEventListener(USER_COLOR_UPDATED_EVENT, onUserColorUpdated as EventListener);
    return () => {
      window.removeEventListener(USER_COLOR_UPDATED_EVENT, onUserColorUpdated as EventListener);
    };
  }, []);

  const nextRefreshMs = useMemo(() => {
    const oneDay = 24 * 60 * 60 * 1000;
    let refreshMs = oneDay;

    for (const project of deletedProjects) {
      const deletedAt = String(project.deletedAt || project.updatedAt || project.createdAt || "").trim();
      const deletedAtMs = new Date(deletedAt).getTime();
      if (!Number.isFinite(deletedAtMs)) continue;
      const retentionDays = retentionDaysByCompany[String(project.companyId || "").trim()] ?? 90;
      const remainingMs = deletedAtMs + retentionDays * oneDay - nowMs;
      refreshMs = Math.min(refreshMs, getRemainingRefreshMs(remainingMs));
    }
    return refreshMs;
  }, [deletedProjects, retentionDaysByCompany, nowMs]);

  useEffect(() => {
    const id = window.setTimeout(() => setNowMs(Date.now()), nextRefreshMs);
    return () => window.clearTimeout(id);
  }, [nextRefreshMs]);

  const filtered = useMemo(() => {
    const q = String(search || "").trim().toLowerCase();
    if (!q) return deletedProjects;
    return deletedProjects.filter((project) => `${project.name} ${project.createdByName}`.toLowerCase().includes(q));
  }, [deletedProjects, search]);

  const filteredDeletedLeads = useMemo(() => {
    const q = String(search || "").trim().toLowerCase();
    if (!q) return deletedLeads;
    return deletedLeads.filter((lead) => {
      const raw = lead.rawFields ?? {};
      const searchable = [
        lead.name,
        lead.email,
        lead.phone,
        lead.message,
        lead.formName,
        ...Object.entries(raw).map(([key, value]) => `${key} ${String(value ?? "")}`),
      ].join(" ").toLowerCase();
      return searchable.includes(q);
    });
  }, [deletedLeads, search]);

  useEffect(() => {
    if (activeTab === "leads" && !canAccessDeletedLeads) {
      setActiveTab("projects");
    }
  }, [activeTab, canAccessDeletedLeads]);

  const availableLeadFields = useMemo(() => {
    const map = new Map<string, { key: string; label: string }>();
    for (const lead of deletedLeads) {
      for (const field of getLeadDynamicFields(lead)) {
        const normalized = normalizeLeadFieldKey(field.key);
        if (!normalized || map.has(normalized)) continue;
        map.set(normalized, { key: field.key, label: field.label });
  }
}

function measureStatusPillWidth(options: string[]) {
  const labels = options.map((option) => String(option || "").trim()).filter(Boolean);
  if (!labels.length) return 60;
  if (typeof document === "undefined") {
    const longest = labels.reduce((max, label) => Math.max(max, label.length), 0);
    return Math.max(60, Math.ceil(longest * 6.6 + 10));
  }
  const canvas = document.createElement("canvas");
  const context = canvas.getContext("2d");
  if (!context) {
    const longest = labels.reduce((max, label) => Math.max(max, label.length), 0);
    return Math.max(60, Math.ceil(longest * 6.6 + 10));
  }
  context.font = '700 11px "Segoe UI", Arial, sans-serif';
  const widest = labels.reduce((max, label) => Math.max(max, context.measureText(label).width), 0);
  return Math.max(60, Math.ceil(widest + 10));
}
    return Array.from(map.values());
  }, [deletedLeads]);

  const mergedLeadFieldLayout = useMemo(
    () => mergeLeadFieldLayout(availableLeadFields, leadFieldLayout),
    [availableLeadFields, leadFieldLayout],
  );

  const leadRowFields = useMemo(() => {
    const configured = mergedLeadFieldLayout.filter((field) => field.showInRow);
    return configured.length > 0 ? configured : mergedLeadFieldLayout.slice(0, 3);
  }, [mergedLeadFieldLayout]);

  const leadDetailFields = useMemo(() => {
    const configured = mergedLeadFieldLayout.filter((field) => field.showInDetail);
    return configured.length > 0 ? configured : mergedLeadFieldLayout;
  }, [mergedLeadFieldLayout]);

  const leadStatusColorByName = useMemo(() => {
    const map = new Map<string, string>();
    for (const row of leadStatusRows) {
      map.set(String(row.name || "").trim().toLowerCase(), String(row.color || "").trim() || "#64748B");
    }
    return map;
  }, [leadStatusRows]);
  const leadStatusOptions = useMemo(() => {
    const options = leadStatusRows.map((row) => row.name).filter(Boolean);
    return options.length ? options : ["New", "Contacted", "Qualified", "Converted"];
  }, [leadStatusRows]);
  const leadStatusPillWidth = useMemo(() => {
    return measureStatusPillWidth(leadStatusOptions);
  }, [leadStatusOptions]);

  const deletedLeadStatusPillStyle = (statusLabel: string) => {
    const configured = leadStatusColorByName.get(String(statusLabel || "").trim().toLowerCase());
    if (configured) {
      return { backgroundColor: configured, color: "#FFFFFF" };
    }
    return statusPillColors(statusLabel);
  };

  const deletedLeadGridTemplate = useMemo(() => {
    const parts = ["118px", "40px", `${leadStatusPillWidth}px`];
    for (const _ of leadRowFields) parts.push("minmax(150px,1fr)");
    parts.push("132px");
    return parts.join(" ");
  }, [leadRowFields, leadStatusPillWidth]);

  const onRestore = async (project: Project) => {
    if (restoringId || deletingId) return;
    clearConfirmRestoreTimeout();
    clearConfirmDeleteTimeout();
    setRestoringId(project.id);
    const ok = await restoreDeletedProject(project);
    if (ok) {
      setDeletedProjects((prev) => prev.filter((row) => row.id !== project.id));
      setConfirmRestoreId((prev) => (prev === project.id ? "" : prev));
      setExpandedProjectId((prev) => (prev === project.id ? "" : prev));
    }
    setRestoringId("");
  };

  const onRestoreClick = async (project: Project) => {
    if (restoringId || deletingId) return;
    if (confirmRestoreId !== project.id) {
      setConfirmRestoreId(project.id);
      setConfirmDeleteId((prev) => (prev === project.id ? "" : prev));
      clearConfirmRestoreTimeout();
      confirmResetTimeoutRef.current = window.setTimeout(() => {
        setConfirmRestoreId((prev) => (prev === project.id ? "" : prev));
        confirmResetTimeoutRef.current = null;
      }, 5000);
      return;
    }
    await onRestore(project);
  };

  const onPermanentDelete = async (project: Project) => {
    if (restoringId || deletingId) return;
    clearConfirmRestoreTimeout();
    clearConfirmDeleteTimeout();
    setDeletingId(project.id);
    const ok = await permanentlyDeleteProject(project);
    if (ok) {
      setDeletedProjects((prev) => prev.filter((row) => row.id !== project.id));
      setConfirmDeleteId((prev) => (prev === project.id ? "" : prev));
      setExpandedProjectId((prev) => (prev === project.id ? "" : prev));
    }
    setDeletingId("");
  };

  const onPermanentDeleteClick = async (project: Project) => {
    if (restoringId || deletingId) return;
    if (confirmDeleteId !== project.id) {
      setConfirmDeleteId(project.id);
      setConfirmRestoreId((prev) => (prev === project.id ? "" : prev));
      clearConfirmDeleteTimeout();
      confirmDeleteTimeoutRef.current = window.setTimeout(() => {
        setConfirmDeleteId((prev) => (prev === project.id ? "" : prev));
        confirmDeleteTimeoutRef.current = null;
      }, 5000);
      return;
    }
    await onPermanentDelete(project);
  };

  const toggleProjectExpand = (project: Project) => {
    setExpandedProjectId((prev) => (prev === project.id ? "" : project.id));
  };

  const toggleLeadExpand = (lead: CompanyLeadRow) => {
    setExpandedLeadId((prev) => (prev === lead.id ? "" : lead.id));
  };

  useEffect(() => {
    return () => {
      clearConfirmRestoreTimeout();
      clearConfirmDeleteTimeout();
    };
  }, []);

  return (
    <ProtectedRoute>
      <AppShell>
        <section className="-mx-4 -mb-4 -mt-4 min-h-screen bg-white pb-4 pt-0 md:-mx-5">
          <div className="flex h-[56px] flex-wrap items-center justify-between gap-3 border-b border-[#D7DEE8] bg-white px-4 md:px-5">
            <div className="inline-flex min-w-0 items-center gap-2">
              <Trash2 size={16} color="#12345B" strokeWidth={2.1} />
              <p className="text-[14px] font-medium uppercase tracking-[1px]" style={{ color: "#12345B" }}>
                <span style={{ color: "#12345B" }}>Recently Deleted</span>
                <span className="px-2" style={{ color: "#6B7280" }}>|</span>
                <span style={{ color: "#334155" }}>{companyName}</span>
              </p>
            </div>
            <div className="inline-flex items-center gap-3">
              <div className="inline-flex items-center gap-2">
                {canAccessDeletedLeads ? (
                  <button
                    type="button"
                    onClick={() => setActiveTab("leads")}
                    className="inline-flex h-8 items-center justify-center rounded-[10px] px-3 text-[11px] font-bold uppercase tracking-[0.7px] transition-colors"
                    style={
                      activeTab === "leads"
                        ? { backgroundColor: "#EAF1FF", color: "#12345B" }
                        : { backgroundColor: "transparent", color: "#7F93AE" }
                    }
                  >
                    Leads
                  </button>
                ) : null}
                <button
                  type="button"
                  onClick={() => setActiveTab("projects")}
                  className="inline-flex h-8 items-center justify-center rounded-[10px] px-3 text-[11px] font-bold uppercase tracking-[0.7px] transition-colors"
                  style={
                    activeTab === "projects"
                      ? { backgroundColor: "#EAF1FF", color: "#12345B" }
                      : { backgroundColor: "transparent", color: "#7F93AE" }
                  }
                >
                  Projects
                </button>
              </div>
              <div
                className="inline-flex h-9 items-center gap-2 rounded-[10px] border border-[#D8DEE8] bg-[#F7F9FC] px-2"
                style={{ width: 340, minWidth: 340 }}
              >
                <Search size={14} className="text-[#6B7280]" />
                <input
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder={activeTab === "projects" ? "Search deleted projects..." : "Search deleted leads..."}
                  className="h-8 w-full bg-transparent text-[12px] outline-none"
                />
              </div>
            </div>
          </div>

          <div className="overflow-auto">
            {activeTab === "projects" ? (
            <table className="w-full min-w-[920px] text-[12px]">
              <thead>
                <tr>
                  <th className="h-[38px] border-b py-[7px] pl-[10px] text-left align-middle text-[11px] font-bold text-[#7F93AE]" style={{ borderColor: "#D7E1EE" }}>Project Name</th>
                  <th className="h-[38px] border-b py-[7px] pl-[10px] text-left align-middle text-[11px] font-bold text-[#7F93AE]" style={{ borderColor: "#D7E1EE" }}>Creator</th>
                  <th className="h-[38px] border-b py-[7px] text-center align-middle text-[11px] font-bold text-[#7F93AE]" style={{ borderColor: "#D7E1EE" }}>Deleted</th>
                  <th className="h-[38px] border-b py-[7px] text-center align-middle text-[11px] font-bold text-[#7F93AE]" style={{ borderColor: "#D7E1EE" }}>Permanent Delete</th>
                  <th className="h-[38px] w-[180px] border-b py-[7px] text-center align-middle text-[11px] font-bold text-[#7F93AE]" style={{ borderColor: "#D7E1EE" }}>Action</th>
                </tr>
              </thead>
              <tbody>
                {isLoading && (
                  <tr>
                    <td className="py-3 pl-[10px] pr-[10px] text-[#6B7280]" colSpan={5}>Loading deleted projects...</td>
                  </tr>
                )}

                {!isLoading && filtered.length === 0 && (
                  <tr>
                    <td className="py-4 pl-[10px] pr-[10px] text-[#6B7280]" colSpan={5}>No deleted projects.</td>
                  </tr>
                )}

                {filtered.map((project, idx) => {
                  const deletedAt = String(project.deletedAt || project.updatedAt || project.createdAt || "").trim();
                  const deletedAtMs = new Date(deletedAt).getTime();
                  const retentionDays = retentionDaysByCompany[String(project.companyId || "").trim()] ?? 90;
                  const remainingMs =
                    Number.isFinite(deletedAtMs)
                      ? deletedAtMs + retentionDays * 24 * 60 * 60 * 1000 - nowMs
                      : Number.POSITIVE_INFINITY;
                  const isConfirming = confirmRestoreId === project.id;
                  const isDeleteConfirming = confirmDeleteId === project.id;
                  const isExpanded = expandedProjectId === project.id;
                  const productSummary = getProjectProductSummary(project);
                  const clientAddressCombined = [String(project.clientAddress || "").trim(), String(project.region || "").trim()]
                    .filter(Boolean)
                    .join(", ");
                  return (
                    <Fragment key={`recently_deleted_${project.id}`}>
                      <tr
                        onMouseEnter={() => setHoveredRowId(project.id)}
                        onMouseLeave={() => setHoveredRowId((prev) => (prev === project.id ? "" : prev))}
                        onClick={() => toggleProjectExpand(project)}
                        className="cursor-pointer [&>td]:transition-colors"
                      >
                        <td
                          className="border-b py-[7px] pl-[10px] font-bold text-[#111827]"
                          style={{
                            backgroundColor: hoveredRowId === project.id ? "#EEF4FF" : idx % 2 === 0 ? "#FFFFFF" : "#F8FBFF",
                            borderColor: "#D7E1EE",
                          }}
                        >
                          {project.name}
                        </td>
                        <td
                          className="border-b py-[7px] pl-[10px] text-[#344054]"
                          style={{
                            backgroundColor: hoveredRowId === project.id ? "#EEF4FF" : idx % 2 === 0 ? "#FFFFFF" : "#F8FBFF",
                            borderColor: "#D7E1EE",
                          }}
                        >
                          <div className="inline-flex items-center gap-2">
                            <span
                              className="inline-flex h-5 w-5 items-center justify-center rounded-full text-[10px] font-bold text-white"
                              style={{
                                backgroundColor:
                                  creatorColorByUid[String(project.createdByUid || "").trim()] || companyThemeColor,
                              }}
                            >
                              {initialsFromName(project.createdByName || "")}
                            </span>
                            <span>{project.createdByName || "-"}</span>
                          </div>
                        </td>
                        <td
                          className="border-b py-[7px] text-center text-[#344054]"
                          style={{
                            backgroundColor: hoveredRowId === project.id ? "#EEF4FF" : idx % 2 === 0 ? "#FFFFFF" : "#F8FBFF",
                            borderColor: "#D7E1EE",
                          }}
                        >
                          {formatDeletedDate(deletedAt)}
                        </td>
                        <td
                          className="border-b py-[7px] text-center"
                          style={{
                            backgroundColor: hoveredRowId === project.id ? "#EEF4FF" : idx % 2 === 0 ? "#FFFFFF" : "#F8FBFF",
                            borderColor: "#D7E1EE",
                          }}
                        >
                          <span
                            className="inline-flex min-w-[94px] items-center justify-center rounded-[999px] border border-[#F3B8BF] bg-[#FDECEC] px-2 py-[3px] text-[11px] font-bold"
                            style={{ color: "#7F1D1D" }}
                          >
                            {formatRemaining(remainingMs)}
                          </span>
                        </td>
                        <td
                          className="w-[180px] border-b py-[7px]"
                          style={{
                            backgroundColor: hoveredRowId === project.id ? "#EEF4FF" : idx % 2 === 0 ? "#FFFFFF" : "#F8FBFF",
                            borderColor: "#D7E1EE",
                          }}
                        >
                          <div className="flex w-full justify-center">
                            <button
                              type="button"
                              disabled={restoringId === project.id || deletingId === project.id}
                              onMouseEnter={() => setHoveredRestoreId(project.id)}
                              onMouseLeave={() => setHoveredRestoreId((prev) => (prev === project.id ? "" : prev))}
                              onClick={(e) => {
                                e.stopPropagation();
                                void onRestoreClick(project);
                              }}
                              className="inline-flex w-[132px] items-center justify-center gap-1 rounded-[8px] px-2 py-1 text-[11px] font-bold transition-all duration-150 disabled:opacity-55"
                              style={{
                                width: 132,
                                minWidth: 132,
                                maxWidth: 132,
                                color: isConfirming ? "#14532D" : "#1E3A8A",
                                border: `1px solid ${
                                  isConfirming
                                    ? hoveredRestoreId === project.id
                                      ? "#86EFAC"
                                      : "#BBF7D0"
                                    : hoveredRestoreId === project.id
                                      ? "#94B8F0"
                                      : "#BFD4F6"
                                }`,
                                background: isConfirming
                                  ? hoveredRestoreId === project.id
                                    ? "#DCFCE7"
                                    : "#ECFDF3"
                                  : hoveredRestoreId === project.id
                                    ? "#CFE0FF"
                                    : "#EAF2FF",
                                boxShadow:
                                  hoveredRestoreId === project.id ? "0 1px 0 rgba(30,58,138,0.15)" : "none",
                              }}
                            >
                              {isConfirming ? <Check size={12} /> : <RotateCcw size={12} />}
                              {restoringId === project.id ? "Restoring..." : isConfirming ? "Confirm" : "Restore"}
                            </button>
                          </div>
                        </td>
                      </tr>
                      {isExpanded && (
                        <tr>
                          <td
                            colSpan={5}
                            className="relative border-b px-[10px] py-[8px]"
                            style={{
                              borderColor: "#D7E1EE",
                              backgroundColor: idx % 2 === 0 ? "#F8FBFF" : "#FFFFFF",
                            }}
                          >
                              <div className="grid grid-cols-4 text-[12px]">
                              <div className="px-3 py-2">
                                <p className="mb-2 text-[11px] font-extrabold uppercase tracking-[0.6px] text-[#6B7D94]">Client</p>
                                <div className="space-y-1.5">
                                  <div><span className="text-[#64748B]">Client Name: </span><span className="font-semibold text-[#1F2937]">{project.customer || "-"}</span></div>
                                  <div><span className="text-[#64748B]">Phone: </span><span className="font-semibold text-[#1F2937]">{project.clientPhone || "-"}</span></div>
                                  <div><span className="text-[#64748B]">Email: </span><span className="font-semibold text-[#1F2937]">{project.clientEmail || "-"}</span></div>
                                  <div><span className="text-[#64748B]">Address: </span><span className="font-semibold text-[#1F2937]">{clientAddressCombined || "-"}</span></div>
                                </div>
                              </div>
                              <div className="border-l px-3 py-2" style={{ borderLeftColor: "#D7E1EE" }}>
                                <p className="mb-2 text-[11px] font-extrabold uppercase tracking-[0.6px] text-[#6B7D94]">Overview</p>
                                <div className="space-y-1.5">
                                  <div><span className="text-[#64748B]">Status: </span><span className="font-semibold text-[#1F2937]">{project.statusLabel || "-"}</span></div>
                                  <div><span className="text-[#64748B]">Creator: </span><span className="font-semibold text-[#1F2937]">{project.createdByName || "-"}</span></div>
                                  <div><span className="text-[#64748B]">Assigned To: </span><span className="font-semibold text-[#1F2937]">{project.assignedTo || "-"}</span></div>
                                </div>
                              </div>
                              <div className="border-l px-3 py-2" style={{ borderLeftColor: "#D7E1EE" }}>
                                <p className="mb-2 text-[11px] font-extrabold uppercase tracking-[0.6px] text-[#6B7D94]">Dates</p>
                                <div className="space-y-1.5">
                                  <div><span className="text-[#64748B]">Created: </span><span className="font-semibold text-[#1F2937]">{formatDateOnly(project.createdAt || "")}</span></div>
                                  <div><span className="text-[#64748B]">Modified: </span><span className="font-semibold text-[#1F2937]">{formatDateOnly(project.updatedAt || "")}</span></div>
                                  <div><span className="text-[#64748B]">Deleted: </span><span className="font-semibold text-[#1F2937]">{formatDateOnly(project.deletedAt || "")}</span></div>
                                </div>
                              </div>
                              <div className="border-l px-3 py-2" style={{ borderLeftColor: "#D7E1EE" }}>
                                <p className="mb-2 text-[11px] font-extrabold uppercase tracking-[0.6px] text-[#6B7D94]">Product</p>
                                <div className="space-y-1.5">
                                  <div><span className="text-[#64748B]">Pieces in job: </span><span className="font-semibold text-[#1F2937]">{productSummary.pieces}</span></div>
                                  <div><span className="text-[#64748B]">Sheets: </span><span className="font-semibold text-[#1F2937]">{productSummary.sheets}</span></div>
                                </div>
                              </div>
                              </div>
                              <div className="absolute inset-0 z-20 flex items-end justify-end pr-[20px] pb-[10px]">
                                <button
                                  type="button"
                                  disabled={deletingId === project.id || restoringId === project.id}
                                  onMouseEnter={() => setHoveredDeleteId(project.id)}
                                  onMouseLeave={() => setHoveredDeleteId((prev) => (prev === project.id ? "" : prev))}
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    void onPermanentDeleteClick(project);
                                  }}
                                  className="inline-flex w-[132px] items-center justify-center gap-1 rounded-[8px] px-2 py-1 text-[11px] font-bold transition-all duration-150 disabled:opacity-55"
                                  style={{
                                    width: 132,
                                    minWidth: 132,
                                    maxWidth: 132,
                                    transform: "translateX(-10px)",
                                    color: isDeleteConfirming ? "#14532D" : "#991B1B",
                                    border: `1px solid ${
                                      isDeleteConfirming
                                        ? hoveredDeleteId === project.id
                                          ? "#86EFAC"
                                          : "#BBF7D0"
                                        : hoveredDeleteId === project.id
                                          ? "#F5B4BC"
                                          : "#F8CDD2"
                                    }`,
                                    background: isDeleteConfirming
                                      ? hoveredDeleteId === project.id
                                        ? "#DCFCE7"
                                        : "#ECFDF3"
                                      : hoveredDeleteId === project.id
                                        ? "#FDECEC"
                                        : "#FFF5F6",
                                  }}
                                >
                                  {isDeleteConfirming ? <Check size={12} /> : <Trash2 size={12} />}
                                  {deletingId === project.id ? "Deleting..." : isDeleteConfirming ? "Confirm" : "Permanent Delete"}
                                </button>
                              </div>
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  );
                })}
              </tbody>
            </table>
            ) : (
              <div className="overflow-x-auto">
                {isLoading ? (
                  <div className="px-4 py-8 text-[13px] font-semibold text-[#6B7280]">
                    Loading deleted leads...
                  </div>
                ) : filteredDeletedLeads.length === 0 ? (
                  <div className="px-4 py-10 text-center text-[13px] font-semibold text-[#6B7280]">
                    No deleted leads.
                  </div>
                ) : (
                  <>
                    <div
                      className="grid min-w-full h-[38px] items-center gap-3 border-b px-4 py-[7px] text-[11px] font-bold uppercase tracking-[0.8px]"
                      style={{
                        gridTemplateColumns: deletedLeadGridTemplate,
                        borderColor: "#D7E1EE",
                        backgroundColor: "#F8FBFF",
                        color: "#7F93AE",
                      }}
                    >
                      <p>Permanent Delete</p>
                      <p></p>
                      <p>Status</p>
                      {leadRowFields.length === 0 ? <p>No visible lead fields</p> : leadRowFields.map((column) => <p key={column.key}>{column.label}</p>)}
                      <p className="text-right">Received</p>
                    </div>
                    {filteredDeletedLeads.map((lead, idx) => {
                      const leadFields = getLeadDynamicFields(lead);
                      const isExpanded = expandedLeadId === lead.id;
                      const archivedAt = String(lead.updatedAtIso || lead.createdAtIso || lead.submittedAtIso || "").trim();
                      const archivedAtMs = new Date(archivedAt).getTime();
                      const retentionDays = retentionDaysByCompany[String(lead.companyId || "").trim()] ?? 90;
                      const remainingMs =
                        Number.isFinite(archivedAtMs)
                          ? archivedAtMs + retentionDays * 24 * 60 * 60 * 1000 - nowMs
                          : Number.POSITIVE_INFINITY;
                      return (
                        <Fragment key={`recently_deleted_lead_${lead.id}`}>
                          <button
                            type="button"
                            onClick={() => toggleLeadExpand(lead)}
                            className="grid min-w-full items-center gap-3 border-b px-4 py-[7px] text-left text-[12px] transition-colors"
                            style={{
                              gridTemplateColumns: deletedLeadGridTemplate,
                              borderColor: "#D7E1EE",
                              backgroundColor: idx % 2 === 0 ? "#FFFFFF" : "#F8FBFF",
                            }}
                          >
                            <div className="text-left">
                              <span
                                className="inline-flex min-w-[94px] items-center justify-center rounded-[999px] border border-[#F3B8BF] bg-[#FDECEC] px-2 py-[3px] text-[11px] font-bold"
                                style={{ color: "#7F1D1D" }}
                              >
                                {formatRemaining(remainingMs)}
                              </span>
                            </div>
                            <span
                              className="flex h-6 w-6 items-center justify-center rounded-full"
                              style={{ backgroundColor: isExpanded ? "#FFFFFF" : "transparent", color: "#334155" }}
                              aria-hidden="true"
                            >
                              {isExpanded ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
                            </span>
                            <div className="-ml-1 flex justify-center">
                              <span
                                className="inline-flex h-7 shrink-0 items-center justify-center rounded-[10px] px-3 text-[11px] font-bold whitespace-nowrap"
                                style={{ ...deletedLeadStatusPillStyle(lead.status || "Archived"), width: leadStatusPillWidth }}
                              >
                                {lead.status || "Archived"}
                              </span>
                            </div>
                            {leadRowFields.length === 0 ? (
                              <span className="min-w-0 text-left text-[12px] font-semibold text-[#334155]">
                                No preview fields configured yet.
                              </span>
                            ) : (
                              leadRowFields.map((column) => {
                                const match = leadFields.find(
                                  (field) => normalizeLeadFieldKey(field.key) === normalizeLeadFieldKey(column.key),
                                );
                                return (
                                  <span key={`${lead.id}:${column.key}`} className="min-w-0 overflow-hidden text-left">
                                    <p className="truncate whitespace-nowrap text-[12px] font-semibold text-[#334155]">
                                      {match?.value || "-"}
                                    </p>
                                  </span>
                                );
                              })
                            )}
                            <div className="text-right">
                              <p className="whitespace-nowrap text-[11px] font-semibold text-[#6B7280]">
                                {formatDeletedDate(archivedAt)}
                              </p>
                            </div>
                          </button>
                          {isExpanded ? (
                            <div
                              className="border-b px-4 pb-4 pt-3"
                              style={{
                                borderColor: "#D7E1EE",
                                backgroundColor: idx % 2 === 0 ? "#F8FBFF" : "#FFFFFF",
                              }}
                            >
                              <div className="mb-3 flex items-center justify-between gap-3">
                                <div className="flex items-center gap-2">
                                  <span
                                    className="inline-flex min-w-[94px] items-center justify-center rounded-[999px] border border-[#F3B8BF] bg-[#FDECEC] px-2 py-[3px] text-[11px] font-bold"
                                    style={{ color: "#7F1D1D" }}
                                  >
                                    {formatRemaining(remainingMs)}
                                  </span>
                                </div>
                                <p className="text-[10px] font-extrabold uppercase tracking-[0.7px] text-[#7F93AE]">
                                  Lead Details
                                </p>
                              </div>
                              {leadDetailFields.length === 0 ? (
                                <p className="text-[12px] font-semibold text-[#6B7280]">
                                  No detail fields configured yet.
                                </p>
                              ) : (
                                <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
                                  {leadDetailFields.map((column) => {
                                    const match = leadFields.find(
                                      (field) => normalizeLeadFieldKey(field.key) === normalizeLeadFieldKey(column.key),
                                    );
                                    return (
                                      <div
                                        key={`${lead.id}:detail:${column.key}`}
                                        className="rounded-[12px] border px-3 py-2"
                                        style={{ borderColor: "#D7E1EE", backgroundColor: "#FFFFFF" }}
                                      >
                                        <p className="text-[10px] font-extrabold uppercase tracking-[0.7px] text-[#7F93AE]">
                                          {column.label}
                                        </p>
                                        <p className="mt-2 whitespace-pre-wrap text-[12px] font-semibold text-[#334155]">
                                          {match?.value || "-"}
                                        </p>
                                      </div>
                                    );
                                  })}
                                </div>
                              )}
                            </div>
                          ) : null}
                        </Fragment>
                      );
                    })}
                  </>
                )}
              </div>
            )}
          </div>
        </section>
      </AppShell>
    </ProtectedRoute>
  );
}
