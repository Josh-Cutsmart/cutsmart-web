"use client";

import { Fragment, useEffect, useMemo, useState } from "react";
import { ChevronDown, ChevronRight, Inbox, Search } from "lucide-react";
import { AppShell } from "@/components/app-shell";
import { ProtectedRoute } from "@/components/protected-route";
import { useAuth } from "@/lib/auth-context";
import { fetchCompanyAccess, fetchPrimaryMembership } from "@/lib/membership";
import { fetchCompanyDoc, type CompanyLeadRow } from "@/lib/firestore-data";
import { readThemeMode, THEME_MODE_UPDATED_EVENT, type ThemeMode } from "@/lib/theme-mode";
import { buildTemporarySampleLeads } from "@/lib/removable-sample-leads";
import { OPEN_NEW_PROJECT_EVENT, type NewProjectPrefillPayload } from "@/lib/new-project-bridge";

const ACTIVE_COMPANY_STORAGE_KEY = "cutsmart_active_company_id";
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
  const [isLoading, setIsLoading] = useState(true);
  const [companyName, setCompanyName] = useState("");
  const [companyThemeColor, setCompanyThemeColor] = useState("#2F6BFF");
  const [fieldLayout, setFieldLayout] = useState<LeadFieldLayoutRow[]>([]);
  const [openLeadId, setOpenLeadId] = useState("");
  const [hoveredLeadId, setHoveredLeadId] = useState("");

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
      const permitted =
        role === "owner" || role === "admin" || hasPermissionKey(access?.permissionKeys, "company.dashboard.view");
      setCompanyName(String(companyDoc?.name || "").trim());
      setCompanyThemeColor(String(companyDoc?.themeColor || "").trim() || "#2F6BFF");
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
      try {
        const response = await fetch(`/api/leads?companyId=${encodeURIComponent(companyId)}`, {
          method: "GET",
          cache: "no-store",
        });
        const detail = (await response.json().catch(() => null)) as
          | { ok?: boolean; leads?: CompanyLeadRow[] }
          | null;
        const fetchedLeads = response.ok && Array.isArray(detail?.leads) ? detail.leads : [];
        setLeads([...buildTemporarySampleLeads(companyId), ...fetchedLeads]);
      } catch {
        setLeads(buildTemporarySampleLeads(companyId));
      }
      setIsLoading(false);
    };
    void run();
  }, [user?.uid, user?.companyId]);

  const filteredLeads = useMemo(() => {
    const query = String(search || "").trim().toLowerCase();
    if (!query) return leads;
    return leads.filter((lead) => {
      const searchable = [
        lead.formName,
        lead.status,
        ...getLeadDynamicFields(lead).map((field) => field.value),
      ];
      return searchable.some((value) => String(value || "").toLowerCase().includes(query));
    });
  }, [leads, search]);

  const newCount = filteredLeads.filter((lead) => lead.status === "new").length;
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
  const previewGridTemplate = useMemo(() => {
    const parts = ["40px"];
    for (const _ of rowFields) parts.push("minmax(150px,1fr)");
    parts.push("132px");
    return parts.join(" ");
  }, [rowFields]);

  const handleCreateProjectFromLead = (lead: CompanyLeadRow) => {
    if (typeof window === "undefined") return;
    window.dispatchEvent(
      new CustomEvent<NewProjectPrefillPayload>(OPEN_NEW_PROJECT_EVENT, {
        detail: buildLeadProjectPrefill(lead, mergedFieldLayout),
      }),
    );
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
                    {rowFields.length === 0 ? <p>No visible lead fields</p> : rowFields.map((column) => <p key={column.key}>{column.label}</p>)}
                    <p className="text-right">Received</p>
                  </div>
                  {filteredLeads.map((lead, idx) => {
                    const leadFields = getLeadDynamicFields(lead);
                    const isOpen = openLeadId === lead.id;
                    return (
                      <Fragment key={lead.id}>
                        <div
                          onMouseEnter={() => setHoveredLeadId(lead.id)}
                          onMouseLeave={() => setHoveredLeadId((prev) => (prev === lead.id ? "" : prev))}
                          className="grid min-w-full items-center gap-3 border-b px-4 py-[7px] text-left text-[12px] transition-colors"
                          style={{
                            gridTemplateColumns: previewGridTemplate,
                            borderColor: palette.border,
                            backgroundColor: idx % 2 === 0 ? palette.panelBg : palette.panelMuted,
                          }}
                        >
                          <button
                            type="button"
                            onClick={() => setOpenLeadId((prev) => (prev === lead.id ? "" : lead.id))}
                            className="flex h-6 w-6 items-center justify-center rounded-full"
                            style={{ backgroundColor: isOpen ? palette.panelBg : "transparent", color: palette.textSoft }}
                            aria-label={isOpen ? "Collapse lead details" : "Expand lead details"}
                          >
                            {isOpen ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
                          </button>
                          {rowFields.length === 0 ? (
                            <button
                              type="button"
                              onClick={() => setOpenLeadId((prev) => (prev === lead.id ? "" : lead.id))}
                              className="min-w-0 text-left text-[12px] font-semibold"
                              style={{ gridColumn: "2 / span 1", color: palette.textSoft }}
                            >
                              No preview fields configured yet.
                            </button>
                          ) : (
                            rowFields.map((column) => {
                              const match = leadFields.find(
                                (field) => normalizeLeadFieldKey(field.key) === normalizeLeadFieldKey(column.key),
                              );
                              return (
                                <button
                                  key={`${lead.id}:${column.key}`}
                                  type="button"
                                  onClick={() => setOpenLeadId((prev) => (prev === lead.id ? "" : lead.id))}
                                  className="min-w-0 text-left"
                                >
                                  <p className="line-clamp-2 whitespace-pre-wrap text-[12px] font-semibold" style={{ color: palette.textSoft }}>
                                    {match?.value || "-"}
                                  </p>
                                </button>
                              );
                            })
                          )}
                          <div className="flex items-center justify-end gap-2 text-right">
                            {hoveredLeadId === lead.id ? (
                              <button
                                type="button"
                                onClick={(event) => {
                                  event.stopPropagation();
                                  handleCreateProjectFromLead(lead);
                                }}
                                className="inline-flex h-7 items-center rounded-[8px] border px-3 text-[11px] font-bold text-white transition-opacity"
                                style={{
                                  borderColor: companyThemeColor,
                                  backgroundColor: companyThemeColor,
                                }}
                              >
                                Create Project
                              </button>
                            ) : null}
                            <p className="text-[11px] font-semibold" style={{ color: palette.textMuted }}>
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
      </AppShell>
    </ProtectedRoute>
  );
}
