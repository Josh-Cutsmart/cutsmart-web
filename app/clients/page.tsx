"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { ChevronDown, ChevronRight, Search, Users } from "lucide-react";
import { AppShell } from "@/components/app-shell";
import { ProtectedRoute } from "@/components/protected-route";
import { useAuth } from "@/lib/auth-context";
import { fetchCompanyActiveProjectIds, fetchCompanyClients, fetchCompanyDoc, type CompanyClientRow } from "@/lib/firestore-data";
import { fetchCompanyAccess, fetchPrimaryMembership } from "@/lib/membership";
import { readThemeMode, THEME_MODE_UPDATED_EVENT, type ThemeMode } from "@/lib/theme-mode";

const ACTIVE_COMPANY_STORAGE_KEY = "cutsmart_active_company_id";

function hasPermissionKey(permissionKeys: string[] | undefined, key: string): boolean {
  const target = String(key || "").trim().toLowerCase();
  if (!target) return false;
  return (permissionKeys ?? []).some((item) => {
    const normalized = String(item || "").trim().toLowerCase();
    return normalized === "company.*" || normalized === target;
  });
}

function formatClientDate(value: string) {
  const d = new Date(String(value || ""));
  if (Number.isNaN(d.getTime())) return "-";
  return new Intl.DateTimeFormat("en-NZ", {
    day: "2-digit",
    month: "long",
    year: "numeric",
  })
    .format(d);
}

function timeSinceLabel(value: string) {
  const ms = Date.now() - Date.parse(String(value || ""));
  if (!Number.isFinite(ms) || ms < 0) return "-";
  const days = Math.floor(ms / 86400000);
  if (days < 1) return "Today";
  if (days < 30) return `${days}d ago`;
  const months = Math.floor(days / 30);
  if (months < 12) return `${months}m ago`;
  const years = Math.floor(months / 12);
  const remMonths = months % 12;
  return remMonths > 0 ? `${years}y ${remMonths}m ago` : `${years}y ago`;
}

export default function ClientsPage() {
  const { user } = useAuth();
  const [themeMode, setThemeMode] = useState<ThemeMode>("light");
  const [search, setSearch] = useState("");
  const [clients, setClients] = useState<CompanyClientRow[]>([]);
  const [expandedClientId, setExpandedClientId] = useState("");
  const [companyName, setCompanyName] = useState("Company");
  const [activeProjectIds, setActiveProjectIds] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);
  const [permissionKeys, setPermissionKeys] = useState<string[]>([]);
  const [accessResolved, setAccessResolved] = useState(false);

  const isDarkMode = themeMode === "dark";

  useEffect(() => {
    setThemeMode(readThemeMode());
    const onTheme = (event: Event) => {
      const detail = (event as CustomEvent<ThemeMode>).detail;
      setThemeMode(detail === "dark" ? "dark" : "light");
    };
    window.addEventListener(THEME_MODE_UPDATED_EVENT, onTheme as EventListener);
    return () => window.removeEventListener(THEME_MODE_UPDATED_EVENT, onTheme as EventListener);
  }, []);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      setLoading(true);
      setAccessResolved(false);
      const storedCompanyId =
        typeof window !== "undefined"
          ? String(window.localStorage.getItem(ACTIVE_COMPANY_STORAGE_KEY) || "").trim()
          : "";
      const membership = user?.uid ? await fetchPrimaryMembership(user.uid) : null;
      const activeCompanyId = storedCompanyId || String(user?.companyId || membership?.companyId || "").trim();
      if (!activeCompanyId) {
        if (!cancelled) {
          setClients([]);
          setCompanyName("Company");
          setPermissionKeys(Array.isArray(user?.permissions) ? user.permissions : []);
          setAccessResolved(true);
          setLoading(false);
        }
        return;
      }
      const [companyDoc, access] = await Promise.all([
        fetchCompanyDoc(activeCompanyId),
        user?.uid ? fetchCompanyAccess(activeCompanyId, user.uid) : Promise.resolve(null),
      ]);
      if (cancelled) return;
      const nextPermissionKeys = access?.permissionKeys ?? (Array.isArray(user?.permissions) ? user.permissions : []);
      setCompanyName(String(companyDoc?.companyName ?? companyDoc?.name ?? "Company").trim() || "Company");
      setPermissionKeys(nextPermissionKeys);
      setAccessResolved(true);
      const role = String(access?.role || user?.role || "").trim().toLowerCase();
      const permitted = role === "owner" || role === "admin" || hasPermissionKey(nextPermissionKeys, "company.clients");
      if (!permitted) {
        setClients([]);
        setActiveProjectIds(new Set());
        setLoading(false);
        return;
      }
      const projectIdsPromise = fetchCompanyActiveProjectIds(activeCompanyId);
      let companyClients: CompanyClientRow[] = [];
      try {
        const response = await fetch(`/api/clients?companyId=${encodeURIComponent(activeCompanyId)}`, {
          method: "GET",
          cache: "no-store",
        });
        const json = (await response.json().catch(() => null)) as { ok?: boolean; clients?: CompanyClientRow[] } | null;
        if (response.ok && json?.ok && Array.isArray(json.clients)) {
          companyClients = json.clients;
        } else {
          companyClients = await fetchCompanyClients(activeCompanyId);
        }
      } catch {
        companyClients = await fetchCompanyClients(activeCompanyId);
      }
      const projectIds = await projectIdsPromise;
      if (cancelled) return;
      setClients(companyClients);
      setActiveProjectIds(projectIds);
      setLoading(false);
    };
    void load();
    return () => {
      cancelled = true;
    };
  }, [user?.companyId, user?.permissions, user?.uid]);

  const canAccessClients = useMemo(() => {
    const role = String(user?.role || "").trim().toLowerCase();
    if (role === "owner" || role === "admin") return true;
    return hasPermissionKey(permissionKeys, "company.clients");
  }, [permissionKeys, user?.role]);

  const filteredClients = useMemo(() => {
    const q = String(search || "").trim().toLowerCase();
    const source = !q
      ? clients
      : clients.filter((client) =>
      [
        client.name,
        client.email,
        client.phone,
        client.address,
        ...client.history.map((row) => row.projectName),
      ]
        .join(" ")
        .toLowerCase()
        .includes(q),
      );
    return source.slice().sort((a, b) => {
      const aName = String(a.name || a.email || "").trim().toLowerCase();
      const bName = String(b.name || b.email || "").trim().toLowerCase();
      return aName.localeCompare(bName);
    });
  }, [clients, search]);

  const groupedClients = useMemo(() => {
    const groups = new Map<string, CompanyClientRow[]>();
    for (const client of filteredClients) {
      const base = String(client.name || client.email || "#").trim();
      const firstChar = base.charAt(0).toUpperCase();
      const letter = /^[A-Z]$/.test(firstChar) ? firstChar : "#";
      const existing = groups.get(letter);
      if (existing) {
        existing.push(client);
      } else {
        groups.set(letter, [client]);
      }
    }
    return Array.from(groups.entries()).sort(([a], [b]) => a.localeCompare(b));
  }, [filteredClients]);

  const pageBg = isDarkMode ? "#0f172a" : "#F5F7FB";
  const panelBg = isDarkMode ? "#111827" : "#FFFFFF";
  const border = isDarkMode ? "#243041" : "#D7DEE8";
  const text = isDarkMode ? "#F8FAFC" : "#12345B";
  const textSoft = isDarkMode ? "#CBD5E1" : "#667085";
  const zebra = isDarkMode ? "#172131" : "#F8FAFC";
  const rowHover = isDarkMode ? "#1E293B" : "#F1F5F9";

  return (
    <ProtectedRoute>
      <AppShell>
        {!accessResolved ? (
          <div className="rounded-[14px] border p-6 text-[13px] font-semibold" style={{ borderColor: border, backgroundColor: panelBg, color: textSoft }}>
            Checking access...
          </div>
        ) : !canAccessClients ? (
          <div className="rounded-[14px] border p-6 text-[13px] font-semibold" style={{ borderColor: border, backgroundColor: panelBg, color: textSoft }}>
            You do not have access to client profiles.
          </div>
          ) : (
            <div className="-ml-4 -mr-4 -mb-4 -mt-4 min-h-[calc(100vh-96px)] md:-ml-5 md:-mr-5" style={{ color: text, backgroundColor: pageBg }}>
            <section className="min-h-[calc(100vh-96px)] pb-4 pt-0" style={{ backgroundColor: pageBg }}>
                <div
                  className="fixed left-0 right-0 top-14 z-30 lg:left-[226px] lg:top-0"
                  style={{ backgroundColor: panelBg }}
                >
                <div
                  className="flex h-[56px] items-center justify-between gap-3 border-b px-4 md:px-5"
                  style={{ borderColor: border, backgroundColor: panelBg }}
                >
                  <div className="flex min-w-0 items-center gap-2">
                    <Users size={16} color="#12345B" strokeWidth={2.1} />
                    <p className="truncate text-[14px] font-medium uppercase tracking-[1px]" style={{ color: "#12345B" }}>
                      Clients
                    </p>
                    <span className="text-[14px] font-medium" style={{ color: "#6B7280" }}>
                      |
                    </span>
                    <p className="truncate text-[14px] font-medium" style={{ color: "#334155" }}>
                      {companyName || "Company"}
                    </p>
                  </div>
                  <div
                    className="flex h-9 items-center gap-2 rounded-[10px] border px-3"
                    style={{ width: 340, minWidth: 340, borderColor: border, backgroundColor: isDarkMode ? "#0F172A" : "#FFFFFF", transform: "translateX(4px)" }}
                  >
                    <Search size={14} className="shrink-0" style={{ color: textSoft }} />
                    <input
                      value={search}
                      onChange={(e) => setSearch(e.target.value)}
                      placeholder="Search clients..."
                      className="h-8 w-full bg-transparent text-[12px] outline-none"
                      style={{ color: text }}
                    />
                  </div>
                </div>
                <div
                  className="grid items-center gap-3 border-b px-4 py-[7px] text-[12px] font-semibold md:px-5"
                  style={{
                    gridTemplateColumns: "40px minmax(220px,1.4fr) minmax(220px,1.2fr) minmax(160px,1fr) 140px 110px",
                    borderColor: border,
                    backgroundColor: panelBg,
                    color: text,
                  }}
                >
                  <span />
                  <span>Client</span>
                  <span>Email</span>
                  <span>Phone</span>
                  <span>Last Project</span>
                  <span>Projects</span>
                </div>
              </div>

              <div className="h-[93px]" />

              <div className="-ml-0 overflow-x-auto" style={{ backgroundColor: pageBg }}>
                <div className="min-w-full" style={{ backgroundColor: pageBg }}>

                {loading ? (
                  <div
                    className="flex min-h-[calc(100vh-176px)] min-w-full items-center justify-center px-4 py-4 text-[13px] md:px-5"
                    style={{ color: textSoft, backgroundColor: pageBg }}
                  >
                    Loading clients...
                  </div>
                ) : filteredClients.length === 0 ? (
                  <div
                    className="flex min-h-[calc(100vh-176px)] min-w-full items-center justify-center px-4 py-5 text-[13px] md:px-5"
                    style={{ color: textSoft, backgroundColor: pageBg }}
                  >
                    No clients yet.
                  </div>
                ) : (
                  groupedClients.map(([letter, letterClients]) => (
                    <div key={letter}>
                      <div
                        className="border-b px-4 py-[8px] text-[22px] font-semibold md:px-5"
                        style={{ borderColor: border, backgroundColor: pageBg, color: text }}
                      >
                        {letter}
                      </div>
                      {letterClients.map((client, index) => {
                        const expanded = expandedClientId === client.id;
                        return (
                          <div key={client.id}>
                            <button
                              type="button"
                              onClick={() => setExpandedClientId((prev) => (prev === client.id ? "" : client.id))}
                              className="grid min-w-full items-center gap-3 border-b px-4 py-[9px] text-left text-[12px] transition-colors md:px-5"
                              style={{
                                gridTemplateColumns: "40px minmax(220px,1.4fr) minmax(220px,1.2fr) minmax(160px,1fr) 140px 110px",
                                borderColor: border,
                                backgroundColor: index % 2 === 1 ? zebra : panelBg,
                                color: text,
                              }}
                              onMouseEnter={(e) => {
                                e.currentTarget.style.backgroundColor = rowHover;
                              }}
                              onMouseLeave={(e) => {
                                e.currentTarget.style.backgroundColor = index % 2 === 1 ? zebra : panelBg;
                              }}
                            >
                              <span className="flex items-center justify-center">
                                {expanded ? <ChevronDown size={15} /> : <ChevronRight size={15} />}
                              </span>
                              <span className="truncate text-[14px] font-semibold">{client.name || "Unnamed Client"}</span>
                              <span className="truncate">{client.email || "-"}</span>
                              <span className="truncate">{client.phone || "-"}</span>
                              <span className="truncate">{client.lastProjectAtIso ? timeSinceLabel(client.lastProjectAtIso) : "-"}</span>
                              <span>{client.projectCount}</span>
                            </button>
                            {expanded ? (
                              <div className="border-b px-4 py-4 md:px-5" style={{ borderColor: border, backgroundColor: index % 2 === 1 ? panelBg : zebra }}>
                                <div className="grid gap-4 xl:grid-cols-[320px_1fr]">
                                  <div className="rounded-[14px] border p-4" style={{ borderColor: border, backgroundColor: panelBg }}>
                                    <p className="text-[12px] font-extrabold uppercase tracking-[0.8px]" style={{ color: text }}>
                                      Client Profile
                                    </p>
                                    <div className="mt-3 space-y-2 text-[12px]" style={{ color: textSoft }}>
                                      <p><span className="font-semibold" style={{ color: text }}>Name:</span> {client.name || "-"}</p>
                                      <p><span className="font-semibold" style={{ color: text }}>Email:</span> {client.email || "-"}</p>
                                      <p><span className="font-semibold" style={{ color: text }}>Phone:</span> {client.phone || "-"}</p>
                                      <p><span className="font-semibold" style={{ color: text }}>Address:</span> {client.address || "-"}</p>
                                      <p><span className="font-semibold" style={{ color: text }}>First Project:</span> {client.firstProjectAtIso ? formatClientDate(client.firstProjectAtIso) : "-"}</p>
                                      <p><span className="font-semibold" style={{ color: text }}>Last Project:</span> {client.lastProjectAtIso ? formatClientDate(client.lastProjectAtIso) : "-"}</p>
                                      <p><span className="font-semibold" style={{ color: text }}>Time Since Last Project:</span> {client.lastProjectAtIso ? timeSinceLabel(client.lastProjectAtIso) : "-"}</p>
                                    </div>
                                  </div>
                                  <div className="rounded-[14px] border p-4" style={{ borderColor: border, backgroundColor: panelBg }}>
                                    <p className="text-[12px] font-extrabold uppercase tracking-[0.8px]" style={{ color: text }}>
                                      Project History
                                    </p>
                                    <div className="mt-3 space-y-2">
                                      {client.history.map((history) => {
                                        const canOpenProject = activeProjectIds.has(String(history.projectId || "").trim());
                                        const rowBody = (
                                          <div
                                            className="flex items-center justify-between rounded-[10px] border px-3 py-2 text-[12px] transition-colors"
                                            style={{ borderColor: border, color: text, backgroundColor: isDarkMode ? "#0F172A" : "#FFFFFF" }}
                                          >
                                            <div className="min-w-0">
                                              <p className="truncate font-semibold">{history.projectName}</p>
                                              <p className="truncate" style={{ color: textSoft }}>
                                                {history.statusLabel} | {formatClientDate(history.updatedAtIso || history.createdAtIso)}
                                              </p>
                                            </div>
                                            {canOpenProject ? (
                                              <span className="ml-3 shrink-0 text-[11px]" style={{ color: textSoft }}>
                                                Open
                                              </span>
                                            ) : (
                                              <span className="ml-3 shrink-0 text-[11px]" style={{ color: textSoft }}>
                                                Removed
                                              </span>
                                            )}
                                          </div>
                                        );
                                        return canOpenProject ? (
                                          <Link
                                            key={history.projectId}
                                            href={`/projects/${history.projectId}?tab=general`}
                                            className="block no-underline"
                                          >
                                            {rowBody}
                                          </Link>
                                        ) : (
                                          <div key={history.projectId}>{rowBody}</div>
                                        );
                                      })}
                                    </div>
                                  </div>
                                </div>
                              </div>
                            ) : null}
                          </div>
                        );
                      })}
                    </div>
                  ))
                )}
              </div>
              </div>
            </section>
          </div>
        )}
      </AppShell>
    </ProtectedRoute>
  );
}
