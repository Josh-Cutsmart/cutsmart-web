"use client";

import { useEffect, useMemo, useState } from "react";
import { Inbox, Phone, Search, UserRound } from "lucide-react";
import { AppShell } from "@/components/app-shell";
import { ProtectedRoute } from "@/components/protected-route";
import { useAuth } from "@/lib/auth-context";
import { fetchCompanyAccess, fetchPrimaryMembership } from "@/lib/membership";
import { fetchCompanyDoc, fetchCompanyLeads, type CompanyLeadRow } from "@/lib/firestore-data";
import { readThemeMode, THEME_MODE_UPDATED_EVENT, type ThemeMode } from "@/lib/theme-mode";

const ACTIVE_COMPANY_STORAGE_KEY = "cutsmart_active_company_id";
const RESERVED_LEAD_FIELD_KEYS = new Set([
  "companyid",
  "name",
  "email",
  "phone",
  "message",
  "submittedat",
  "submittedatiso",
  "source",
  "formname",
  "status",
]);

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

function getLeadDynamicFields(lead: CompanyLeadRow) {
  const raw = lead.rawFields ?? {};
  return Object.entries(raw)
    .filter(([key]) => !RESERVED_LEAD_FIELD_KEYS.has(normalizeLeadFieldKey(key)))
    .map(([key, value]) => ({
      key,
      label: formatLeadFieldLabel(key),
      value: leadValueToText(value),
    }))
    .filter((field) => field.value);
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
      const [access, companyDoc, leadRows] = await Promise.all([
        fetchCompanyAccess(companyId, user.uid),
        fetchCompanyDoc(companyId),
        fetchCompanyLeads(companyId),
      ]);
      const role = String(access?.role || "").trim().toLowerCase();
      const permitted =
        role === "owner" || role === "admin" || hasPermissionKey(access?.permissionKeys, "company.dashboard.view");
      setCompanyName(String(companyDoc?.name || "").trim());
      setCompanyAccessResolved(true);
      setCanAccessLeads(permitted);
      setLeads(permitted ? leadRows : []);
      setIsLoading(false);
    };
    void run();
  }, [user?.uid, user?.companyId]);

  const filteredLeads = useMemo(() => {
    const query = String(search || "").trim().toLowerCase();
    if (!query) return leads;
    return leads.filter((lead) => {
      const searchable = [
        lead.name,
        lead.email,
        lead.phone,
        lead.message,
        lead.formName,
        ...getLeadDynamicFields(lead).map((field) => field.value),
      ];
      return searchable.some((value) => String(value || "").toLowerCase().includes(query));
    });
  }, [leads, search]);

  const newCount = filteredLeads.filter((lead) => lead.status === "new").length;
  const dynamicColumns = useMemo(() => {
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
  const visibleStandardColumns = useMemo(
    () => ({
      email: leads.some((lead) => Boolean(lead.email)),
      phone: leads.some((lead) => Boolean(lead.phone)),
      message: leads.some((lead) => Boolean(lead.message)),
    }),
    [leads],
  );
  const desktopGridTemplate = useMemo(() => {
    const parts = ["minmax(190px,1.1fr)"];
    if (visibleStandardColumns.email) parts.push("minmax(180px,1fr)");
    if (visibleStandardColumns.phone) parts.push("minmax(150px,0.8fr)");
    for (const _ of dynamicColumns) parts.push("minmax(170px,0.95fr)");
    if (visibleStandardColumns.message) parts.push("minmax(240px,1.4fr)");
    parts.push("minmax(140px,0.8fr)");
    return parts.join(" ");
  }, [dynamicColumns, visibleStandardColumns.email, visibleStandardColumns.message, visibleStandardColumns.phone]);

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
            <section className="rounded-[14px] border px-4 py-3" style={{ borderColor: palette.border, backgroundColor: palette.panelBg, boxShadow: palette.shadow }}>
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="flex items-center gap-2">
                  <Inbox size={18} />
                  <div>
                    <p className="text-[22px] font-bold" style={{ color: palette.text }}>Leads</p>
                    <p className="text-[12px]" style={{ color: palette.textMuted }}>
                      {companyName || activeCompanyId || "Company"} website submissions
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-2 text-[12px] font-semibold" style={{ color: palette.textSoft }}>
                  <span className="rounded-full px-3 py-1" style={{ backgroundColor: palette.panelMuted }}>{filteredLeads.length} total</span>
                  <span className="rounded-full px-3 py-1" style={{ backgroundColor: palette.panelMuted }}>{newCount} new</span>
                </div>
              </div>
              <div className="mt-3 flex items-center gap-2">
                <div className="relative w-full max-w-[420px]">
                  <Search size={14} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2" style={{ color: palette.textMuted }} />
                  <input
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    placeholder="Search leads..."
                    className="h-10 w-full rounded-[10px] border pl-9 pr-3 text-[13px] outline-none"
                    style={{ borderColor: palette.border, backgroundColor: palette.inputBg, color: palette.inputText }}
                  />
                </div>
              </div>
            </section>

            <section className="overflow-hidden rounded-[14px] border" style={{ borderColor: palette.border, backgroundColor: palette.panelBg, boxShadow: palette.shadow }}>
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
                      gridTemplateColumns: desktopGridTemplate,
                      borderColor: palette.border,
                      backgroundColor: palette.panelMuted,
                      color: palette.textMuted,
                    }}
                  >
                    <p>Name</p>
                    {visibleStandardColumns.email ? <p>Email</p> : null}
                    {visibleStandardColumns.phone ? <p>Phone</p> : null}
                    {dynamicColumns.map((column) => (
                      <p key={column.key}>{column.label}</p>
                    ))}
                    {visibleStandardColumns.message ? <p>Message</p> : null}
                    <p>Submitted</p>
                  </div>
                  {filteredLeads.map((lead, idx) => (
                    <div
                      key={lead.id}
                      className="grid min-w-full gap-3 border-b px-4 py-3 text-[12px]"
                      style={{
                        gridTemplateColumns: desktopGridTemplate,
                        borderColor: palette.border,
                        backgroundColor: idx % 2 === 0 ? palette.panelBg : palette.panelMuted,
                      }}
                    >
                      <div className="min-w-0">
                        <div className="inline-flex max-w-full items-center gap-2">
                          <UserRound size={13} style={{ color: palette.textMuted }} />
                          <p className="truncate font-bold" style={{ color: palette.textSoft }}>{lead.name || "-"}</p>
                        </div>
                        <p className="mt-1 text-[10px] font-bold uppercase tracking-[0.6px]" style={{ color: lead.status === "new" ? "#1F6A3B" : palette.textMuted }}>
                          {lead.status}
                        </p>
                        {lead.formName ? (
                          <p className="mt-1 truncate text-[10px]" style={{ color: palette.textMuted }}>
                            {lead.formName}
                          </p>
                        ) : null}
                      </div>
                      {visibleStandardColumns.email ? (
                        <p className="truncate" style={{ color: palette.textSoft }}>{lead.email || "-"}</p>
                      ) : null}
                      {visibleStandardColumns.phone ? (
                        <div className="inline-flex items-center gap-2">
                          <Phone size={12} style={{ color: palette.textMuted }} />
                          <p className="truncate" style={{ color: palette.textSoft }}>{lead.phone || "-"}</p>
                        </div>
                      ) : null}
                      {dynamicColumns.map((column) => {
                        const match = getLeadDynamicFields(lead).find(
                          (field) => normalizeLeadFieldKey(field.key) === normalizeLeadFieldKey(column.key),
                        );
                        return (
                          <p key={`${lead.id}:${column.key}`} className="line-clamp-3 whitespace-pre-wrap" style={{ color: palette.textSoft }}>
                            {match?.value || "-"}
                          </p>
                        );
                      })}
                      {visibleStandardColumns.message ? (
                        <p className="line-clamp-3 whitespace-pre-wrap" style={{ color: palette.textSoft }}>{lead.message || "-"}</p>
                      ) : null}
                      <p style={{ color: palette.textMuted }}>{formatLeadDate(lead.submittedAtIso || lead.createdAtIso)}</p>
                    </div>
                  ))}
                </div>
              )}
            </section>
          </div>
        )}
      </AppShell>
    </ProtectedRoute>
  );
}
