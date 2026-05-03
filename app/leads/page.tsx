"use client";

import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { ChevronDown, ChevronRight, Inbox, Plus, Search } from "lucide-react";
import { AppShell } from "@/components/app-shell";
import { ProtectedRoute } from "@/components/protected-route";
import { useAuth } from "@/lib/auth-context";
import { fetchCompanyAccess, fetchPrimaryMembership } from "@/lib/membership";
import { fetchCompanyDoc, type CompanyLeadRow } from "@/lib/firestore-data";
import { readThemeMode, THEME_MODE_UPDATED_EVENT, type ThemeMode } from "@/lib/theme-mode";
import { OPEN_NEW_PROJECT_EVENT, type NewProjectPrefillPayload } from "@/lib/new-project-bridge";

const ACTIVE_COMPANY_STORAGE_KEY = "cutsmart_active_company_id";
const SAMPLE_LEADS_STORAGE_KEY_PREFIX = "cutsmart_sample_leads:";
const LEAD_ARCHIVE_UPDATED_EVENT = "cutsmart_lead_archive_updated";
const RESERVED_LEAD_FIELD_KEYS = new Set([
  "companyid",
  "source",
  "status",
]);

type LeadProjectFieldTarget = "" | "clientName" | "clientPhone" | "clientEmail" | "projectAddress" | "projectNotes";
type LeadFieldLayoutRow = {
  key: string;
  label: string;
  showInRow: boolean;
  showInDetail: boolean;
  order: number;
  projectFieldTarget: LeadProjectFieldTarget;
};

type LeadDynamicField = {
  key: string;
  label: string;
  value: string;
};

type StatusRow = { name: string; color: string };

function buildTemporarySampleLeads(_companyId: string): CompanyLeadRow[] {
  return [];
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

function sampleLeadsStorageKey(companyId: string) {
  return `${SAMPLE_LEADS_STORAGE_KEY_PREFIX}${String(companyId || "").trim()}`;
}

function readPersistedSampleLeads(companyId: string): CompanyLeadRow[] | null {
  if (typeof window === "undefined") return null;
  const cid = String(companyId || "").trim();
  if (!cid) return null;
  try {
    const raw = window.localStorage.getItem(sampleLeadsStorageKey(cid));
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return null;
    return parsed as CompanyLeadRow[];
  } catch {
    return null;
  }
}

function persistSampleLeads(companyId: string, rows: CompanyLeadRow[]) {
  if (typeof window === "undefined") return;
  const cid = String(companyId || "").trim();
  if (!cid) return;
  try {
    window.localStorage.setItem(sampleLeadsStorageKey(cid), JSON.stringify(rows));
  } catch {
    // ignore local storage persistence failure
  }
}

function hasPermissionKey(permissionKeys: string[] | undefined, key: string): boolean {
  const target = String(key || "").trim().toLowerCase();
  if (!target) return false;
  return (permissionKeys ?? []).some((item) => {
    const normalized = String(item || "").trim().toLowerCase();
    return normalized === "company.*" || normalized === target;
  });
}

function formatLeadDate(value: string) {
  const d = new Date(String(value || ""));
  if (Number.isNaN(d.getTime())) return "-";
  return new Intl.DateTimeFormat("en-NZ", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  })
    .format(d)
    .replace(",", " |");
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

function mergeLeadFieldLayout(
  availableFields: Array<{ key: string; label: string }>,
  savedLayout: LeadFieldLayoutRow[],
): LeadFieldLayoutRow[] {
  const byKey = new Map(
    savedLayout.map((row) => [normalizeLeadFieldKey(row.key), row] as const),
  );
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

function isInternalTestLead(lead: CompanyLeadRow) {
  const raw = lead.rawFields ?? {};
  return (
    raw.__cutsmartTest === true ||
    String(raw.__cutsmartTest || "").trim().toLowerCase() === "true" ||
    String(raw.FullName || "").trim() === "CutSmart Test Lead" ||
    String(raw.Source || "").trim() === "CutSmart Integration Test"
  );
}

function isTemporarySampleLead(lead: CompanyLeadRow) {
  return String(lead.id || "").startsWith("temporary-sample-lead-") || String(lead.source || "").trim() === "local-sample";
}

function leadValueToText(value: unknown): string {
  if (value == null) return "";
  if (Array.isArray(value)) {
    return value
      .map((item) => leadValueToText(item))
      .filter(Boolean)
      .join(", ");
  }
  if (typeof value === "object") {
    return Object.entries(value as Record<string, unknown>)
      .map(([key, item]) => `${formatLeadFieldLabel(key)}: ${leadValueToText(item)}`)
      .filter((item) => item.endsWith(": ") === false)
      .join(" | ");
  }
  return String(value).trim();
}

function getLeadDynamicFields(lead: CompanyLeadRow): LeadDynamicField[] {
  if (isInternalTestLead(lead)) return [];
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

function scoreLeadFieldKey(field: LeadDynamicField, patterns: RegExp[]) {
  const haystack = `${field.key} ${field.label}`.toLowerCase();
  return patterns.reduce((best, pattern) => (pattern.test(haystack) ? best + 1 : best), 0);
}

function findBestLeadField(
  fields: LeadDynamicField[],
  patterns: RegExp[],
  predicate?: (field: LeadDynamicField) => boolean,
) {
  let bestField: LeadDynamicField | null = null;
  let bestScore = -1;
  for (const field of fields) {
    if (predicate && !predicate(field)) continue;
    const score = scoreLeadFieldKey(field, patterns);
    if (score > bestScore) {
      bestField = field;
      bestScore = score;
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
  return bestScore > 0 ? bestField : null;
}

function isLikelyEmailValue(value: string) {
  return /\S+@\S+\.\S+/.test(String(value || "").trim());
}

function isLikelyPhoneValue(value: string) {
  const raw = String(value || "").trim();
  const digits = raw.replace(/\D/g, "");
  if (digits.length < 7 || digits.length > 15) return false;
  return /^[+\d()\s-]+$/.test(raw) || /^\d+$/.test(raw);
}

function buildLeadAddress(fields: LeadDynamicField[]) {
  const directAddress = findBestLeadField(fields, [/address/, /street/, /location/]);
  if (directAddress?.value) return directAddress.value;
  const parts = fields
    .filter((field) =>
      [/(^|[^a-z])suburb([^a-z]|$)/, /city/, /region/, /postcode/, /zip/, /state/, /country/].some((pattern) =>
        pattern.test(`${field.key} ${field.label}`.toLowerCase()),
      ),
    )
    .map((field) => field.value.trim())
    .filter(Boolean);
  return Array.from(new Set(parts)).join(", ");
}

function suggestProjectName(clientName: string) {
  const parts = String(clientName || "")
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  if (parts.length === 0) return "";
  return parts[parts.length - 1] || parts[0] || "";
}

function buildLeadProjectPrefill(lead: CompanyLeadRow, fieldLayout: LeadFieldLayoutRow[]): NewProjectPrefillPayload {
  const fields = getLeadDynamicFields(lead);
  const findMappedField = (target: LeadProjectFieldTarget) => {
    const mapped = fieldLayout.find((row) => row.projectFieldTarget === target);
    if (!mapped) return null;
    return (
      fields.find((field) => normalizeLeadFieldKey(field.key) === normalizeLeadFieldKey(mapped.key)) || null
    );
  };
  const nameField =
    findMappedField("clientName") ||
    findBestLeadField(fields, [/client\s*name/, /full\s*name/, /(^|[^a-z])name([^a-z]|$)/], (field) => {
      const haystack = `${field.key} ${field.label}`.toLowerCase();
      return !/company|business|organisation|organization/.test(haystack);
    }) ||
    fields.find((field) => {
      const words = field.value.trim().split(/\s+/).filter(Boolean);
      return words.length >= 2 && /^[a-z ,.'-]+$/i.test(field.value.trim());
    }) ||
    null;
  const emailField =
    findMappedField("clientEmail") ||
    findBestLeadField(fields, [/email/, /e-mail/], (field) => isLikelyEmailValue(field.value)) ||
    fields.find((field) => isLikelyEmailValue(field.value)) ||
    null;
  const phoneField =
    findMappedField("clientPhone") ||
    findBestLeadField(fields, [/phone/, /mobile/, /cell/, /contact/], (field) => isLikelyPhoneValue(field.value)) ||
    fields.find((field) => isLikelyPhoneValue(field.value)) ||
    null;
  const clientName = String(nameField?.value || "").trim();
  const notesField = findMappedField("projectNotes");
  return {
    projectName: suggestProjectName(clientName),
    clientName,
    clientPhone: String(phoneField?.value || "").trim(),
    clientEmail: String(emailField?.value || "").trim(),
    projectAddress: String(findMappedField("projectAddress")?.value || buildLeadAddress(fields)).trim(),
    projectNotes: String(notesField?.value || "").trim(),
  };
}

export default function LeadsPage() {
  const { user } = useAuth();
  const [themeMode, setThemeMode] = useState<ThemeMode>("light");
  const [companyAccessResolved, setCompanyAccessResolved] = useState(false);
  const [canAccessLeads, setCanAccessLeads] = useState(false);
  const [activeCompanyId, setActiveCompanyId] = useState("");
  const [leads, setLeads] = useState<CompanyLeadRow[]>([]);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [listOrder, setListOrder] = useState<"status" | "az" | "za" | "newest" | "oldest">("newest");
  const [isLoading, setIsLoading] = useState(true);
  const [companyName, setCompanyName] = useState("");
  const [companyThemeColor, setCompanyThemeColor] = useState("#2F6BFF");
  const [leadStatusRows, setLeadStatusRows] = useState<StatusRow[]>(normalizeLeadStatuses(undefined));
  const [fieldLayout, setFieldLayout] = useState<LeadFieldLayoutRow[]>([]);
  const [openLeadId, setOpenLeadId] = useState("");
  const [confirmDeleteLeadId, setConfirmDeleteLeadId] = useState("");
  const [deletingLeadId, setDeletingLeadId] = useState("");
  const [statusMenuLeadId, setStatusMenuLeadId] = useState("");
  const [statusMenuPos, setStatusMenuPos] = useState<{ left: number; top: number; width: number } | null>(null);
  const [statusFilterMenuOpen, setStatusFilterMenuOpen] = useState(false);
  const [statusFilterMenuPos, setStatusFilterMenuPos] = useState<{ left: number; top: number; width: number } | null>(null);
  const [statusUpdatingLeadId, setStatusUpdatingLeadId] = useState("");
  const [leadFormUrl, setLeadFormUrl] = useState("");
  const [hoveredLeadId, setHoveredLeadId] = useState("");
  const deleteConfirmTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const sampleLeadsRef = useRef<Record<string, CompanyLeadRow[]>>({});

  const isDarkMode = themeMode === "dark";
  const palette = isDarkMode
    ? {
        pageBg: "#0f0f0f",
        panelBg: "#212121",
        panelMuted: "#272727",
        border: "#3f3f46",
        text: "#f1f1f1",
        textSoft: "#d1d5db",
        textMuted: "#aaaaaa",
        inputBg: "#303134",
        inputText: "#f1f1f1",
        rowHover: "#2a2a2a",
        shadow: "0 10px 30px rgba(0,0,0,0.38)",
      }
    : {
        pageBg: "#ffffff",
        panelBg: "#ffffff",
        panelMuted: "#F8FAFC",
        border: "#D7DEE8",
        text: "#1A1D23",
        textSoft: "#334155",
        textMuted: "#8A97A8",
        inputBg: "#ffffff",
        inputText: "#334155",
        rowHover: "#EEF4FF",
        shadow: "0 10px 24px rgba(15,23,42,0.09),0 2px 6px rgba(15,23,42,0.05)",
      };

  useEffect(() => {
    setThemeMode(readThemeMode());
    if (typeof window === "undefined") return;
    const onThemeUpdated = (event: Event) => {
      const detail = (event as CustomEvent<{ mode?: ThemeMode }>).detail;
      setThemeMode(detail?.mode === "dark" ? "dark" : "light");
    };
    window.addEventListener(THEME_MODE_UPDATED_EVENT, onThemeUpdated as EventListener);
    return () => window.removeEventListener(THEME_MODE_UPDATED_EVENT, onThemeUpdated as EventListener);
  }, []);

  useEffect(() => {
    return () => {
      if (deleteConfirmTimeoutRef.current) {
        clearTimeout(deleteConfirmTimeoutRef.current);
      }
    };
  }, []);

  const loadLeads = useCallback(async (companyId: string) => {
    const cid = String(companyId || "").trim();
    if (!cid) {
      setLeads([]);
      return;
    }
    const currentSampleLeads =
      sampleLeadsRef.current[cid] ??
      (sampleLeadsRef.current[cid] = readPersistedSampleLeads(cid) ?? buildTemporarySampleLeads(cid));
    persistSampleLeads(cid, currentSampleLeads);
    try {
      const response = await fetch(`/api/leads?companyId=${encodeURIComponent(cid)}`, {
        method: "GET",
        cache: "no-store",
      });
        const detail = (await response.json().catch(() => null)) as
          | { ok?: boolean; leads?: CompanyLeadRow[] }
          | null;
        const fetchedLeads = response.ok && Array.isArray(detail?.leads) ? detail.leads.filter((lead) => !lead.isDeleted) : [];
      setLeads([...currentSampleLeads, ...fetchedLeads]);
    } catch {
      setLeads(currentSampleLeads);
    }
  }, []);

  useEffect(() => {
    const run = async () => {
      if (!user?.uid) {
        setCompanyAccessResolved(true);
        setCanAccessLeads(false);
        setIsLoading(false);
        return;
      }
      const storedCompanyId =
        typeof window !== "undefined" ? String(window.localStorage.getItem(ACTIVE_COMPANY_STORAGE_KEY) || "").trim() : "";
      const directCompanyId = String(user.companyId || "").trim();
      const fallbackMembership = !directCompanyId ? await fetchPrimaryMembership(user.uid) : null;
      const companyId = storedCompanyId || directCompanyId || String(fallbackMembership?.companyId || "").trim();
      setActiveCompanyId(companyId);
      if (companyId && !sampleLeadsRef.current[companyId]) {
        sampleLeadsRef.current[companyId] = readPersistedSampleLeads(companyId) ?? buildTemporarySampleLeads(companyId);
        persistSampleLeads(companyId, sampleLeadsRef.current[companyId]);
      }
      if (!companyId) {
        setCompanyAccessResolved(true);
        setCanAccessLeads(false);
        setIsLoading(false);
        return;
      }
      const [access, companyDoc] = await Promise.all([
        fetchCompanyAccess(companyId, user.uid),
        fetchCompanyDoc(companyId),
      ]);
      const role = String(access?.role || "").trim().toLowerCase();
      const permitted = role === "owner" || role === "admin" || hasPermissionKey(access?.permissionKeys, "leads.*");
      setCompanyName(String(companyDoc?.name || "").trim());
      setCompanyThemeColor(String(companyDoc?.themeColor || "").trim() || "#2F6BFF");
      setLeadFormUrl(String(companyDoc?.salesLeadFormUrl || "").trim());
      setLeadStatusRows(normalizeLeadStatuses((companyDoc as Record<string, unknown> | null)?.leadStatuses));
      setFieldLayout(
        normalizeLeadFieldLayout(
          ((companyDoc?.integrations as Record<string, unknown> | undefined)?.zapierLeads as Record<string, unknown> | undefined)?.fieldLayout,
        ),
      );
      setCompanyAccessResolved(true);
      setCanAccessLeads(permitted);
      if (!permitted) {
        setLeads([]);
        setIsLoading(false);
        return;
      }
      await loadLeads(companyId);
      setIsLoading(false);
    };
    void run();
  }, [loadLeads, user?.uid, user?.companyId]);

  useEffect(() => {
    if (!companyAccessResolved || !canAccessLeads || !activeCompanyId) return;
    const intervalId = window.setInterval(() => {
      void loadLeads(activeCompanyId);
    }, 4000);
    return () => window.clearInterval(intervalId);
  }, [activeCompanyId, canAccessLeads, companyAccessResolved, loadLeads]);

  const filteredLeads = useMemo(() => {
    const query = String(search || "").trim().toLowerCase();
    const filtered = leads.filter((lead) => {
      if (statusFilter !== "all" && String(lead.status || "").trim().toLowerCase() !== statusFilter) {
        return false;
      }
      if (!query) {
        return true;
      }
      const searchable = [
        lead.formName,
        lead.status,
        ...getLeadDynamicFields(lead).map((field) => field.value),
      ];
      return searchable.some((value) => String(value || "").toLowerCase().includes(query));
    });
    const sorted = [...filtered];
    const leadLabel = (lead: CompanyLeadRow) => {
      const firstVisible = getLeadDynamicFields(lead)[0]?.value || "";
      return String(firstVisible || lead.name || lead.email || lead.phone || "").trim().toLowerCase();
    };
    const leadTimestamp = (lead: CompanyLeadRow) => {
      const raw = String(lead.createdAtIso || lead.submittedAtIso || lead.updatedAtIso || "").trim();
      const parsed = raw ? new Date(raw).getTime() : 0;
      return Number.isFinite(parsed) ? parsed : 0;
    };
    if (listOrder === "az") {
      sorted.sort((a, b) => leadLabel(a).localeCompare(leadLabel(b)));
    } else if (listOrder === "za") {
      sorted.sort((a, b) => leadLabel(b).localeCompare(leadLabel(a)));
    } else if (listOrder === "newest") {
      sorted.sort((a, b) => leadTimestamp(b) - leadTimestamp(a));
    } else if (listOrder === "oldest") {
      sorted.sort((a, b) => leadTimestamp(a) - leadTimestamp(b));
    } else {
      sorted.sort((a, b) => {
        const statusDiff = String(a.status || "").trim().toLowerCase().localeCompare(String(b.status || "").trim().toLowerCase());
        if (statusDiff !== 0) return statusDiff;
        return leadLabel(a).localeCompare(leadLabel(b));
      });
    }
    return sorted;
  }, [leads, listOrder, search, statusFilter]);

  const newCount = filteredLeads.filter((lead) => String(lead.status || "").trim().toLowerCase() === "new").length;
  const availableFields = useMemo(() => {
    const seen = new Set<string>();
    const columns: Array<{ key: string; label: string }> = [];
    for (const lead of leads) {
      for (const field of getLeadDynamicFields(lead)) {
        const normalized = normalizeLeadFieldKey(field.key);
        if (!normalized || seen.has(normalized)) continue;
        seen.add(normalized);
        columns.push({ key: field.key, label: field.label });
      }
    }
    return columns;
  }, [leads]);
  const mergedFieldLayout = useMemo(
    () => mergeLeadFieldLayout(availableFields, fieldLayout),
    [availableFields, fieldLayout],
  );
  const rowFields = useMemo(() => {
    const configured = mergedFieldLayout.filter((field) => field.showInRow);
    return configured.length > 0 ? configured : mergedFieldLayout.slice(0, 3);
  }, [mergedFieldLayout]);
  const detailFields = useMemo(() => {
    const configured = mergedFieldLayout.filter((field) => field.showInDetail);
    return configured.length > 0 ? configured : mergedFieldLayout;
  }, [mergedFieldLayout]);
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
  const statusFilterPillWidth = useMemo(() => {
    return measureStatusPillWidth(["All Statuses", ...leadStatusOptions]);
  }, [leadStatusOptions]);

  const leadStatusPillStyle = (statusLabel: string) => {
    const configured = leadStatusColorByName.get(String(statusLabel || "").trim().toLowerCase());
    if (configured) {
      return { backgroundColor: configured, color: "#FFFFFF" };
    }
    return statusPillColors(statusLabel);
  };
  const currentStatusFilterLabel = statusFilter === "all"
    ? "All Statuses"
    : leadStatusOptions.find((status) => String(status).trim().toLowerCase() === statusFilter) || "All Statuses";

  const armLeadDelete = (leadId: string) => {
    setConfirmDeleteLeadId(leadId);
    if (deleteConfirmTimeoutRef.current) {
      clearTimeout(deleteConfirmTimeoutRef.current);
    }
    deleteConfirmTimeoutRef.current = setTimeout(() => {
      setConfirmDeleteLeadId((current) => (current === leadId ? "" : current));
    }, 10000);
  };

  const handleDeleteLead = async (lead: CompanyLeadRow) => {
    const leadId = String(lead.id || "").trim();
    if (!leadId || deletingLeadId) return;
    if (confirmDeleteLeadId !== leadId) {
      armLeadDelete(leadId);
      return;
    }
    if (deleteConfirmTimeoutRef.current) {
      clearTimeout(deleteConfirmTimeoutRef.current);
      deleteConfirmTimeoutRef.current = null;
    }
    setDeletingLeadId(leadId);
    let didArchive = false;
    if (isTemporarySampleLead(lead)) {
      didArchive = true;
    } else {
      const response = await fetch("/api/leads", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          companyId: lead.companyId,
          leadId,
          isDeleted: true,
        }),
      }).catch(() => null);
      didArchive = Boolean(response?.ok);
    }
    if (didArchive) {
      if (isTemporarySampleLead(lead)) {
        sampleLeadsRef.current[lead.companyId] = (sampleLeadsRef.current[lead.companyId] || []).filter((item) => item.id !== leadId);
        persistSampleLeads(lead.companyId, sampleLeadsRef.current[lead.companyId]);
      }
      setLeads((current) => current.filter((item) => item.id !== leadId));
      setOpenLeadId((current) => (current === leadId ? "" : current));
      setConfirmDeleteLeadId("");
      if (!isTemporarySampleLead(lead)) {
        void loadLeads(lead.companyId);
        if (typeof window !== "undefined") {
          window.dispatchEvent(
            new CustomEvent(LEAD_ARCHIVE_UPDATED_EVENT, {
              detail: {
                companyId: String(lead.companyId || "").trim(),
                leadId,
                isDeleted: true,
              },
            }),
          );
        }
      }
    }
    setDeletingLeadId("");
  };
  const previewGridTemplate = useMemo(() => {
    const parts = ["40px", `${leadStatusPillWidth}px`];
    for (const _ of rowFields) parts.push("minmax(150px,1fr)");
    parts.push("132px");
    return parts.join(" ");
  }, [leadStatusPillWidth, rowFields]);

  const onSelectLeadStatus = async (lead: CompanyLeadRow, nextStatus: string) => {
    if (!nextStatus || statusUpdatingLeadId) return;
    if (isTemporarySampleLead(lead)) {
      sampleLeadsRef.current[lead.companyId] = (sampleLeadsRef.current[lead.companyId] || []).map((row) =>
        row.id === lead.id ? { ...row, status: nextStatus, updatedAtIso: new Date().toISOString() } : row,
      );
      persistSampleLeads(lead.companyId, sampleLeadsRef.current[lead.companyId]);
      setLeads((prev) => prev.map((row) => (row.id === lead.id ? { ...row, status: nextStatus, updatedAtIso: new Date().toISOString() } : row)));
      setStatusMenuLeadId("");
      setStatusMenuPos(null);
      return;
    }
    setStatusUpdatingLeadId(lead.id);
    const response = await fetch("/api/leads", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        companyId: lead.companyId,
        leadId: lead.id,
        status: nextStatus,
      }),
    }).catch(() => null);
    if (response?.ok) {
      setLeads((prev) => prev.map((row) => (row.id === lead.id ? { ...row, status: nextStatus, updatedAtIso: new Date().toISOString() } : row)));
      setStatusMenuLeadId("");
      setStatusMenuPos(null);
      void loadLeads(lead.companyId);
    }
    setStatusUpdatingLeadId("");
  };

  const statusMenuLead = useMemo(() => leads.find((lead) => lead.id === statusMenuLeadId) ?? null, [leads, statusMenuLeadId]);

  useEffect(() => {
    if (!statusMenuLeadId) return;
    const closeMenu = () => {
      setStatusMenuLeadId("");
      setStatusMenuPos(null);
    };
    const onPointerDown = (event: MouseEvent) => {
      const target = event.target as HTMLElement | null;
      if (!target) return;
      if (target.closest("[data-lead-status-menu='true']")) return;
      if (target.closest("[data-lead-status-trigger='true']")) return;
      closeMenu();
    };
    window.addEventListener("mousedown", onPointerDown);
    window.addEventListener("scroll", closeMenu, true);
    window.addEventListener("resize", closeMenu);
    return () => {
      window.removeEventListener("mousedown", onPointerDown);
      window.removeEventListener("scroll", closeMenu, true);
      window.removeEventListener("resize", closeMenu);
    };
  }, [statusMenuLeadId]);

  useEffect(() => {
    if (!statusFilterMenuOpen) return;
    const closeMenu = () => {
      setStatusFilterMenuOpen(false);
      setStatusFilterMenuPos(null);
    };
    const onPointerDown = (event: MouseEvent) => {
      const target = event.target as HTMLElement | null;
      if (!target) return;
      if (target.closest("[data-status-filter-menu='true']")) return;
      if (target.closest("[data-status-filter-trigger='true']")) return;
      closeMenu();
    };
    window.addEventListener("mousedown", onPointerDown);
    window.addEventListener("scroll", closeMenu, true);
    window.addEventListener("resize", closeMenu);
    return () => {
      window.removeEventListener("mousedown", onPointerDown);
      window.removeEventListener("scroll", closeMenu, true);
      window.removeEventListener("resize", closeMenu);
    };
  }, [statusFilterMenuOpen]);

  const handleCreateProjectFromLead = (lead: CompanyLeadRow) => {
    if (typeof window === "undefined") return;
    window.dispatchEvent(
      new CustomEvent<NewProjectPrefillPayload>(OPEN_NEW_PROJECT_EVENT, {
        detail: buildLeadProjectPrefill(lead, mergedFieldLayout),
      }),
    );
  };

  const openLeadForm = () => {
    const url = String(leadFormUrl || "").trim();
    if (!url || typeof window === "undefined") return;
    window.open(url, "_blank", "noopener,noreferrer");
  };

  return (
    <ProtectedRoute>
      <AppShell>
        {!companyAccessResolved ? (
          <div className="rounded-[14px] border p-6 text-[13px] font-semibold" style={{ borderColor: palette.border, backgroundColor: palette.panelBg, color: palette.textSoft, boxShadow: palette.shadow }}>
            Checking access...
          </div>
        ) : !canAccessLeads ? (
          <div className="rounded-[14px] border p-6 text-[13px] font-semibold" style={{ borderColor: palette.border, backgroundColor: palette.panelBg, color: palette.textSoft, boxShadow: palette.shadow }}>
            You do not have permission to access Leads.
          </div>
        ) : (
          <div className="space-y-4" style={{ color: palette.text }}>
            <section className="-mx-4 -mb-4 -mt-4 pb-4 pt-0 md:-mx-5" style={{ backgroundColor: palette.pageBg }}>
              <div className="flex h-[56px] flex-wrap items-center justify-between gap-2 border-b px-4 md:px-5" style={{ borderColor: palette.border, backgroundColor: palette.panelBg }}>
                <div className="flex min-w-0 items-center gap-2">
                  <Inbox size={16} color="#12345B" strokeWidth={2.1} />
                  <p className="truncate text-[14px] font-medium uppercase tracking-[1px]" style={{ color: "#12345B" }}>
                    Leads
                  </p>
                  <span className="text-[14px] font-medium" style={{ color: "#6B7280" }}>
                    |
                  </span>
                  <p className="truncate text-[14px] font-medium" style={{ color: "#334155" }}>
                    {companyName || activeCompanyId || "Company"}
                  </p>
                </div>
                <div className="flex items-center gap-2 text-[12px] font-semibold" style={{ color: palette.textSoft }}>
                  <button
                    type="button"
                    onClick={openLeadForm}
                    disabled={!leadFormUrl}
                    className="inline-flex h-9 items-center gap-2 rounded-[10px] border px-3 text-[12px] font-bold"
                    style={{
                      borderColor: "#C8DAFF",
                      backgroundColor: "#EAF1FF",
                      color: "#24589A",
                      opacity: leadFormUrl ? 1 : 0.55,
                    }}
                  >
                    <Plus size={14} />
                    Create Lead
                  </button>
                  <button
                    type="button"
                    data-status-filter-trigger="true"
                    onClick={(e) => {
                      if (statusFilterMenuOpen) {
                        setStatusFilterMenuOpen(false);
                        setStatusFilterMenuPos(null);
                        return;
                      }
                      const trigger = e.currentTarget as HTMLButtonElement;
                      const rect = trigger.getBoundingClientRect();
                      const menuWidth = rect.width;
                      const estimatedMenuHeight = Math.max(92, (leadStatusOptions.length + 1) * 34);
                      const hasRoomBelow = rect.bottom + estimatedMenuHeight <= window.innerHeight - 8;
                      const hasRoomAbove = rect.top - estimatedMenuHeight >= 8;
                      const shouldOpenUp = !hasRoomBelow && hasRoomAbove;
                      const clampedLeft = Math.min(Math.max(8, rect.left), window.innerWidth - menuWidth - 8);
                      setStatusFilterMenuPos({
                        left: clampedLeft,
                        top: shouldOpenUp ? Math.max(8, rect.top - estimatedMenuHeight - 4) : rect.bottom + 4,
                        width: menuWidth,
                      });
                      setStatusFilterMenuOpen(true);
                    }}
                    className="inline-flex h-9 items-center justify-center rounded-[10px] border px-[5px] outline-none"
                    style={{
                      width: statusFilterPillWidth + 10,
                      borderColor: palette.border,
                      backgroundColor: palette.panelMuted,
                    }}
                    aria-label="Filter by status"
                  >
                    <span
                      className="inline-flex h-7 items-center justify-center rounded-[10px] px-[5px] text-[11px] font-bold whitespace-nowrap"
                      style={{
                        width: statusFilterPillWidth,
                        ...(statusFilter === "all"
                          ? { backgroundColor: palette.panelBg, color: palette.textSoft, border: `1px solid ${palette.border}` }
                          : leadStatusPillStyle(currentStatusFilterLabel)),
                      }}
                    >
                      {currentStatusFilterLabel}
                    </span>
                  </button>
                  <select
                    value={listOrder}
                    onChange={(e) => setListOrder((e.target.value as "status" | "az" | "za" | "newest" | "oldest") || "status")}
                    className="h-9 rounded-[10px] border px-3 text-[12px] outline-none"
                    style={{ borderColor: palette.border, backgroundColor: palette.panelMuted, color: palette.inputText }}
                  >
                    <option value="status">Sort: Status</option>
                    <option value="newest">Newest</option>
                    <option value="oldest">Oldest</option>
                    <option value="az">A &gt; Z</option>
                    <option value="za">Z &gt; A</option>
                  </select>
                  <div
                    className="inline-flex h-9 items-center gap-2 rounded-[10px] border px-2"
                    style={{ width: 340, minWidth: 340, borderColor: palette.border, backgroundColor: palette.panelMuted }}
                  >
                    <Search size={14} className="shrink-0" style={{ color: palette.textMuted }} />
                    <input
                      value={search}
                      onChange={(e) => setSearch(e.target.value)}
                      placeholder="Search leads..."
                      className="h-8 w-full bg-transparent text-[12px] outline-none"
                      style={{ color: palette.inputText }}
                    />
                  </div>
                  <span className="rounded-full px-3 py-1" style={{ backgroundColor: palette.panelMuted }}>{filteredLeads.length} total</span>
                  <span className="rounded-full px-3 py-1" style={{ backgroundColor: palette.panelMuted }}>{newCount} new</span>
                </div>
              </div>
            </section>
            {statusFilterMenuOpen && statusFilterMenuPos && typeof document !== "undefined"
              ? createPortal(
                  <div
                    data-status-filter-menu="true"
                    className="fixed z-[210] rounded-[12px] border py-[2px] shadow-[0_18px_42px_rgba(15,23,42,0.22)]"
                    style={{
                      left: statusFilterMenuPos.left,
                      top: statusFilterMenuPos.top,
                      width: statusFilterMenuPos.width,
                      borderColor: palette.border,
                      backgroundColor: palette.panelBg,
                    }}
                  >
                    <button
                      type="button"
                      onClick={() => {
                        setStatusFilter("all");
                        setStatusFilterMenuOpen(false);
                        setStatusFilterMenuPos(null);
                      }}
                      className="flex w-full items-center justify-center px-[3px] py-[3px]"
                    >
                      <span
                        className="inline-flex h-7 items-center justify-center rounded-[10px] px-[5px] text-[11px] font-bold whitespace-nowrap"
                        style={{
                          width: statusFilterPillWidth,
                          backgroundColor: palette.panelBg,
                          color: palette.textSoft,
                          border: `1px solid ${palette.border}`,
                        }}
                      >
                        All Statuses
                      </span>
                    </button>
                    {leadStatusOptions.map((status) => (
                      <button
                        key={status}
                        type="button"
                        onClick={() => {
                          setStatusFilter(String(status).trim().toLowerCase());
                          setStatusFilterMenuOpen(false);
                          setStatusFilterMenuPos(null);
                        }}
                        className="flex w-full items-center justify-center px-[3px] py-[3px]"
                      >
                        <span
                          className="inline-flex h-7 items-center justify-center rounded-[10px] px-[5px] text-[11px] font-bold whitespace-nowrap"
                          style={{
                            width: statusFilterPillWidth,
                            ...leadStatusPillStyle(status),
                          }}
                        >
                          {status}
                        </span>
                      </button>
                    ))}
                  </div>,
                  document.body,
                )
              : null}

            <section className="-mx-4 overflow-hidden border-x md:-mx-5" style={{ marginTop: "-1px", borderColor: palette.border, backgroundColor: palette.panelBg }}>
              {isLoading ? (
                <div className="px-4 py-8 text-[13px] font-semibold" style={{ color: palette.textMuted }}>
                  Loading leads...
                </div>
              ) : filteredLeads.length === 0 ? (
                <div className="px-4 py-10 text-center text-[13px] font-semibold" style={{ color: palette.textMuted }}>
                  No leads yet.
                </div>
              ) : (
                <div className="overflow-x-auto">
                    <div
                      className="grid min-w-full gap-3 border-b px-4 py-3 text-[11px] font-bold uppercase tracking-[0.8px]"
                    style={{
                      gridTemplateColumns: previewGridTemplate,
                      borderColor: palette.border,
                      backgroundColor: palette.panelMuted,
                      color: palette.textMuted,
                    }}
                    >
                      <p></p>
                      <p>Status</p>
                      {rowFields.length === 0 ? <p>No visible lead fields</p> : rowFields.map((column) => <p key={column.key}>{column.label}</p>)}
                      <p className="text-right">Received</p>
                    </div>
                  {filteredLeads.map((lead, idx) => {
                    const leadFields = getLeadDynamicFields(lead);
                    const isOpen = openLeadId === lead.id;
                    return (
                      <Fragment key={lead.id}>
                        <div
                          role="button"
                          tabIndex={0}
                          onMouseEnter={() => setHoveredLeadId(lead.id)}
                          onMouseLeave={() => setHoveredLeadId((prev) => (prev === lead.id ? "" : prev))}
                          onClick={() => {
                            setOpenLeadId((prev) => (prev === lead.id ? "" : lead.id));
                            setConfirmDeleteLeadId("");
                            if (deleteConfirmTimeoutRef.current) {
                              clearTimeout(deleteConfirmTimeoutRef.current);
                              deleteConfirmTimeoutRef.current = null;
                            }
                          }}
                          onKeyDown={(event) => {
                            if (event.key !== "Enter" && event.key !== " ") return;
                            event.preventDefault();
                            setOpenLeadId((prev) => (prev === lead.id ? "" : lead.id));
                            setConfirmDeleteLeadId("");
                            if (deleteConfirmTimeoutRef.current) {
                              clearTimeout(deleteConfirmTimeoutRef.current);
                              deleteConfirmTimeoutRef.current = null;
                            }
                          }}
                          className="grid min-w-full items-center gap-3 border-b px-4 py-[7px] text-left text-[12px] transition-colors"
                          style={{
                            gridTemplateColumns: previewGridTemplate,
                            borderColor: palette.border,
                            backgroundColor:
                              hoveredLeadId === lead.id ? palette.rowHover : idx % 2 === 0 ? palette.panelBg : palette.panelMuted,
                          }}
                        >
                          <span
                            className="flex h-6 w-6 items-center justify-center rounded-full"
                            style={{ backgroundColor: isOpen ? palette.panelBg : "transparent", color: palette.textSoft }}
                            aria-hidden="true"
                          >
                            {isOpen ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
                          </span>
                          <div className="-ml-5 flex justify-center">
                            <button
                              type="button"
                              data-lead-status-trigger="true"
                              onClick={(e) => {
                                e.stopPropagation();
                                if (statusMenuLeadId === lead.id) {
                                  setStatusMenuLeadId("");
                                  setStatusMenuPos(null);
                                  return;
                                }
                                const trigger = e.currentTarget as HTMLButtonElement;
                                const rect = trigger.getBoundingClientRect();
                                const menuWidth = Math.max(rect.width, leadStatusPillWidth + 6);
                                const estimatedMenuHeight = Math.max(120, leadStatusOptions.length * 34);
                                const hasRoomBelow = rect.bottom + estimatedMenuHeight <= window.innerHeight - 8;
                                const hasRoomAbove = rect.top - estimatedMenuHeight >= 8;
                                const shouldOpenUp = !hasRoomBelow && hasRoomAbove;
                                const clampedLeft = Math.min(Math.max(8, rect.left), window.innerWidth - menuWidth - 8);
                                setStatusMenuPos({
                                  left: clampedLeft,
                                  top: shouldOpenUp ? Math.max(8, rect.top - estimatedMenuHeight - 4) : rect.bottom + 4,
                                  width: menuWidth,
                                });
                                setStatusMenuLeadId(lead.id);
                              }}
                              className="inline-flex h-7 shrink-0 items-center justify-center rounded-[10px] px-3 text-[11px] font-bold whitespace-nowrap"
                              style={{
                                ...leadStatusPillStyle(lead.status || "New"),
                                width: leadStatusPillWidth,
                              }}
                              aria-label="Lead status"
                            >
                              {statusUpdatingLeadId === lead.id ? "Saving..." : lead.status || "New"}
                            </button>
                          </div>
                          {rowFields.length === 0 ? (
                            <span
                              className="min-w-0 text-left text-[12px] font-semibold"
                              style={{ gridColumn: "2 / span 1", color: palette.textSoft }}
                            >
                              No preview fields configured yet.
                            </span>
                          ) : (
                            rowFields.map((column) => {
                              const match = leadFields.find(
                                (field) => normalizeLeadFieldKey(field.key) === normalizeLeadFieldKey(column.key),
                              );
                              return (
                                <span
                                  key={`${lead.id}:${column.key}`}
                                  className="min-w-0 overflow-hidden text-left"
                                >
                                  <p className="truncate whitespace-nowrap text-[12px] font-semibold" style={{ color: palette.textSoft }}>
                                    {match?.value || "-"}
                                  </p>
                                </span>
                              );
                            })
                          )}
                          <div className="text-right">
                            <p className="whitespace-nowrap text-[11px] font-semibold" style={{ color: palette.textMuted }}>
                              {formatLeadDate(lead.createdAtIso || "")}
                            </p>
                          </div>
                        </div>
                        {isOpen ? (
                          <div
                            className="border-b px-4 pb-4 pt-3"
                            style={{
                              borderColor: palette.border,
                              backgroundColor: idx % 2 === 0 ? palette.panelMuted : palette.panelBg,
                            }}
                          >
                            <div className="mb-3 flex items-center justify-between gap-3">
                              <div className="flex items-center gap-2">
                                <button
                                  type="button"
                                  onClick={(event) => {
                                    event.stopPropagation();
                                    handleCreateProjectFromLead(lead);
                                  }}
                                  className="inline-flex h-8 shrink-0 items-center justify-center whitespace-nowrap rounded-[8px] border px-3 text-[11px] font-bold text-white"
                                  style={{
                                    borderColor: companyThemeColor,
                                    backgroundColor: companyThemeColor,
                                  }}
                                >
                                  Create Project
                                </button>
                                <button
                                  type="button"
                                  onClick={(event) => {
                                    event.stopPropagation();
                                    void handleDeleteLead(lead);
                                  }}
                                  disabled={deletingLeadId === lead.id}
                                  className="inline-flex h-8 w-[88px] shrink-0 items-center justify-center whitespace-nowrap rounded-[8px] border px-3 text-[11px] font-bold transition-colors"
                                  style={{
                                    borderColor: confirmDeleteLeadId === lead.id ? "#991B1B" : "#F5B4BC",
                                    backgroundColor: confirmDeleteLeadId === lead.id ? "#991B1B" : "#FFF5F6",
                                    color: confirmDeleteLeadId === lead.id ? "#ffffff" : "#991B1B",
                                    opacity: deletingLeadId === lead.id ? 0.65 : 1,
                                  }}
                                >
                                  {deletingLeadId === lead.id ? "Deleting" : confirmDeleteLeadId === lead.id ? "Confirm" : "Delete"}
                                </button>
                              </div>
                              <p className="text-[10px] font-extrabold uppercase tracking-[0.7px]" style={{ color: palette.textMuted }}>
                                Lead Details
                              </p>
                            </div>
                            {detailFields.length === 0 ? (
                              <p className="text-[12px] font-semibold" style={{ color: palette.textMuted }}>
                                No detail fields configured yet.
                              </p>
                            ) : (
                              <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
                                {detailFields.map((column) => {
                                  const match = leadFields.find(
                                    (field) => normalizeLeadFieldKey(field.key) === normalizeLeadFieldKey(column.key),
                                  );
                                  return (
                                    <div
                                      key={`${lead.id}:detail:${column.key}`}
                                      className="rounded-[12px] border px-3 py-2"
                                      style={{ borderColor: palette.border, backgroundColor: palette.panelBg }}
                                    >
                                      <p className="text-[10px] font-extrabold uppercase tracking-[0.7px]" style={{ color: palette.textMuted }}>
                                        {column.label}
                                      </p>
                                      <p className="mt-2 whitespace-pre-wrap text-[12px] font-semibold" style={{ color: palette.textSoft }}>
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
                </div>
              )}
            </section>
          </div>
        )}
        {statusMenuLead &&
          statusMenuPos &&
          typeof document !== "undefined" &&
          createPortal(
            <div
              data-lead-status-menu="true"
              className="fixed z-[210] rounded-[12px] border py-[2px] shadow-[0_18px_42px_rgba(15,23,42,0.22)]"
              style={{
                left: statusMenuPos.left,
                top: statusMenuPos.top,
                width: statusMenuPos.width,
                borderColor: palette.border,
                backgroundColor: palette.panelBg,
              }}
              onClick={(e) => e.stopPropagation()}
            >
              {leadStatusOptions.map((option) => {
                const active = String(statusMenuLead.status || "").trim().toLowerCase() === option.toLowerCase();
                return (
                  <button
                    key={`${statusMenuLead.id}_${option}`}
                    type="button"
                    disabled={statusUpdatingLeadId === statusMenuLead.id}
                    onClick={() => void onSelectLeadStatus(statusMenuLead, option)}
                    className="flex w-full items-center justify-center px-[3px] py-[3px] disabled:opacity-55"
                  >
                    <span
                      className="inline-flex h-7 items-center justify-center rounded-[10px] px-[5px] text-[11px] font-bold whitespace-nowrap"
                      style={{
                        width: leadStatusPillWidth,
                        ...leadStatusPillStyle(option),
                        filter: active ? "brightness(0.96)" : "brightness(1)",
                      }}
                    >
                      {option}
                    </span>
                  </button>
                );
              })}
            </div>,
            document.body,
          )}
      </AppShell>
    </ProtectedRoute>
  );
}
