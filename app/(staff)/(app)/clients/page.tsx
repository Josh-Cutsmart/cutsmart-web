"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { ChevronRight, Plus, Search, Users, X } from "lucide-react";
import { useAuth } from "@/lib/auth-context";
import {
  createOrAttachManualCompanyClient,
  fetchCompanyClientById,
  fetchCompanyClients,
  fetchCompanyDoc,
  isCompletedClientProjectStatus,
  updateCompanyClientProfile,
  type CompanyClientRow,
} from "@/lib/firestore-data";
import { readThemeMode, THEME_MODE_UPDATED_EVENT, type ThemeMode } from "@/lib/theme-mode";
import { retryAsync } from "@/lib/load-retry";
import { hasPermissionKey, isOwnerOrAdmin, useCompanyAccess } from "@/lib/use-company-access";
import { captureGlassModalOrigin, useGlassModalPopOrigin, type GlassModalOrigin } from "@/lib/use-glass-modal-pop-origin";

type ContactCategoryOption = { name: string; color: string };

// Duplicated from company-settings/page.tsx's own field-input styling convention rather than shared,
// matching this codebase's established "each consuming file keeps its own small styling consts" rule.
const fieldInputClass =
  "h-9 w-full rounded-[8px] border border-[var(--glass-border)] bg-[var(--panel-bg)] px-2.5 text-[12px] font-medium text-[var(--text-main)] outline-none transition focus:border-[var(--brand)] disabled:opacity-60";
const secondaryButtonClass =
  "inline-flex h-9 shrink-0 items-center justify-center gap-1.5 rounded-[8px] border border-[var(--glass-border)] bg-[var(--panel-bg)] px-3 text-[12px] font-bold text-[var(--text-main)] transition hover:brightness-95 disabled:opacity-60";

const emptyContactForm = { name: "", email: "", phone: "", address: "", notes: "", category: "" };

function normalizeContactCategoriesForDisplay(raw: unknown): ContactCategoryOption[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((item) => item && typeof item === "object")
    .map((item) => {
      const row = item as Record<string, unknown>;
      const name = String(row.name ?? "").trim();
      const color = String(row.color ?? "").trim() || "#7D99B3";
      return { name, color };
    })
    .filter((row) => row.name);
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
  const [categoryFilter, setCategoryFilter] = useState("");
  // Mobile-only: the header's search starts collapsed to just an icon button (room is tight next to
  // the category filter + add button) and expands into the real input on tap; the category filter
  // slides away while it's open to make room, then slides back when search closes.
  const [isMobileSearchOpen, setIsMobileSearchOpen] = useState(false);
  const mobileSearchInputRef = useRef<HTMLInputElement | null>(null);
  const [clients, setClients] = useState<CompanyClientRow[]>([]);
  const [clientDetailsById, setClientDetailsById] = useState<Record<string, CompanyClientRow>>({});
  const [companyName, setCompanyName] = useState("Company");
  const [contactCategories, setContactCategories] = useState<ContactCategoryOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [reloadTick, setReloadTick] = useState(0);
  const [detailLoadingClientId, setDetailLoadingClientId] = useState("");

  const isDarkMode = themeMode === "dark";
  const access = useCompanyAccess();
  const activeCompanyId = access.companyId;

  // Contact detail — glass modal (replaces the old inline accordion expand).
  const [activeClientId, setActiveClientId] = useState("");
  const [clientModalOrigin, setClientModalOrigin] = useState<GlassModalOrigin>(null);
  const clientModalPanelRef = useRef<HTMLDivElement | null>(null);
  const clientModalOriginElRef = useRef<HTMLElement | null>(null);
  const shouldRenderClientModal = useGlassModalPopOrigin(
    Boolean(activeClientId),
    clientModalOrigin,
    clientModalPanelRef,
    undefined,
    clientModalOriginElRef,
  );

  // Add Contact — glass modal.
  const [isAddContactOpen, setIsAddContactOpen] = useState(false);
  const [addContactOrigin, setAddContactOrigin] = useState<GlassModalOrigin>(null);
  const addContactPanelRef = useRef<HTMLDivElement | null>(null);
  const addContactOriginElRef = useRef<HTMLElement | null>(null);
  const shouldRenderAddContactModal = useGlassModalPopOrigin(
    isAddContactOpen,
    addContactOrigin,
    addContactPanelRef,
    undefined,
    addContactOriginElRef,
  );
  const [contactForm, setContactForm] = useState(emptyContactForm);
  const [isSavingContact, setIsSavingContact] = useState(false);
  const [addContactMessage, setAddContactMessage] = useState("");

  useEffect(() => {
    setThemeMode(readThemeMode());
    const onTheme = (event: Event) => {
      const detail = (event as CustomEvent<ThemeMode>).detail;
      setThemeMode(detail === "dark" ? "dark" : "light");
    };
    window.addEventListener(THEME_MODE_UPDATED_EVENT, onTheme as EventListener);
    return () => window.removeEventListener(THEME_MODE_UPDATED_EVENT, onTheme as EventListener);
  }, []);

  const canViewAllClients =
    access.status === "ready" && (isOwnerOrAdmin(access.role) || hasPermissionKey(access.permissionKeys, "clients.view.all"));
  const canAccessClients =
    access.status === "ready" &&
    (isOwnerOrAdmin(access.role) || hasPermissionKey(access.permissionKeys, "clients.view") || canViewAllClients);

  useEffect(() => {
    // Access itself is still loading/erroring — lib/use-company-access.ts's own status drives the
    // "Checking access..." / error+retry render below; nothing to fetch here yet.
    if (access.status !== "ready") {
      return;
    }
    if (!activeCompanyId) {
      setCompanyName("Company");
      setContactCategories([]);
      setClients([]);
      setClientDetailsById({});
      setLoading(false);
      return;
    }
    let cancelled = false;
    const load = async () => {
      setLoading(true);
      try {
        const companyDoc = await retryAsync(() => fetchCompanyDoc(activeCompanyId), { attempts: 2, delayMs: 250 });
        if (cancelled) return;
        setCompanyName(String(companyDoc?.companyName ?? companyDoc?.name ?? "Company").trim() || "Company");
        setContactCategories(normalizeContactCategoriesForDisplay((companyDoc as Record<string, unknown> | null)?.contactCategories));
        if (!canAccessClients) {
          setClients([]);
          setClientDetailsById({});
          return;
        }
        let companyClients: CompanyClientRow[] = [];
        try {
          companyClients = await retryAsync(
            async () => {
              const response = await fetch(
                `/api/clients?companyId=${encodeURIComponent(activeCompanyId)}&mode=summary&viewerUid=${encodeURIComponent(String(user?.uid || ""))}&scope=${canViewAllClients ? "all" : "mine"}`,
                {
                  method: "GET",
                  cache: "no-store",
                },
              );
              const json = (await response.json().catch(() => null)) as { ok?: boolean; clients?: CompanyClientRow[] } | null;
              if (response.ok && json?.ok && Array.isArray(json.clients)) {
                return json.clients;
              }
              return await fetchCompanyClients(activeCompanyId, {
                viewerUid: String(user?.uid || "").trim(),
                includeAll: canViewAllClients,
              });
            },
            { attempts: 2, delayMs: 300 },
          );
        } catch {
          companyClients = await retryAsync(
            () =>
              fetchCompanyClients(activeCompanyId, {
                viewerUid: String(user?.uid || "").trim(),
                includeAll: canViewAllClients,
              }),
            { attempts: 2, delayMs: 300 },
          );
        }
        if (cancelled) return;
        setClients(companyClients);
        setClientDetailsById(
          Object.fromEntries(
            companyClients.map((client) => [client.id, client]),
          ),
        );
      } catch {
        if (!cancelled) {
          setClients([]);
          setClientDetailsById({});
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    };
    void load();
    return () => {
      cancelled = true;
    };
  }, [access.status, activeCompanyId, canAccessClients, canViewAllClients, reloadTick, user?.uid]);

  const filteredClients = useMemo(() => {
    const q = String(search || "").trim().toLowerCase();
    const source = clients.filter((client) => {
      if (client.archived) return false;
      if (categoryFilter && (client.category || "") !== categoryFilter) return false;
      if (!q) return true;
      return [
        client.name,
        client.email,
        client.phone,
        client.address,
      ]
        .join(" ")
        .toLowerCase()
        .includes(q);
    });
    return source.slice().sort((a, b) => {
      const aName = String(a.name || a.email || "").trim().toLowerCase();
      const bName = String(b.name || b.email || "").trim().toLowerCase();
      return aName.localeCompare(bName);
    });
  }, [categoryFilter, clients, search]);

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

  const categoryColorByName = useMemo(() => {
    const map = new Map<string, string>();
    contactCategories.forEach((c) => map.set(c.name, c.color));
    return map;
  }, [contactCategories]);

  const pageBg = isDarkMode ? "#0f172a" : "#F5F7FB";
  const panelBg = isDarkMode ? "#111827" : "#FFFFFF";
  const border = isDarkMode ? "#243041" : "#D7DEE8";
  const text = isDarkMode ? "#F8FAFC" : "#12345B";
  const textSoft = isDarkMode ? "#CBD5E1" : "#667085";
  const rowHover = isDarkMode ? "#1E293B" : "#F1F5F9";

  useEffect(() => {
    if (!activeClientId || !activeCompanyId || clientDetailsById[activeClientId]) return;
    let cancelled = false;
    const loadClientDetail = async () => {
      setDetailLoadingClientId(activeClientId);
      let detail: CompanyClientRow | null = null;
      try {
        const response = await fetch(
          `/api/clients?companyId=${encodeURIComponent(activeCompanyId)}&mode=detail&clientId=${encodeURIComponent(activeClientId)}&viewerUid=${encodeURIComponent(String(user?.uid || ""))}&scope=${canViewAllClients ? "all" : "mine"}`,
          {
            method: "GET",
            cache: "no-store",
          },
        );
        const json = (await response.json().catch(() => null)) as { ok?: boolean; client?: CompanyClientRow } | null;
        if (response.ok && json?.ok && json.client) {
          detail = json.client;
        } else {
          detail = await fetchCompanyClientById(activeCompanyId, activeClientId, {
            viewerUid: String(user?.uid || "").trim(),
            includeAll: canViewAllClients,
          });
        }
      } catch {
        detail = await fetchCompanyClientById(activeCompanyId, activeClientId, {
          viewerUid: String(user?.uid || "").trim(),
          includeAll: canViewAllClients,
        });
      }
      if (cancelled) return;
      if (detail) {
        setClientDetailsById((prev) => ({ ...prev, [activeClientId]: detail }));
      }
      setDetailLoadingClientId((current) => (current === activeClientId ? "" : current));
    };
    void loadClientDetail();
    return () => {
      cancelled = true;
    };
  }, [activeClientId, activeCompanyId, canViewAllClients, clientDetailsById, user?.uid]);

  const activeDetail = activeClientId ? clientDetailsById[activeClientId] ?? null : null;
  const activeDetailLoading = Boolean(activeClientId) && detailLoadingClientId === activeClientId && !activeDetail;

  const patchActiveClient = (patch: Partial<CompanyClientRow>) => {
    if (!activeClientId) return;
    setClientDetailsById((prev) => {
      const existing = prev[activeClientId];
      if (!existing) return prev;
      return { ...prev, [activeClientId]: { ...existing, ...patch } };
    });
    setClients((prev) => prev.map((c) => (c.id === activeClientId ? { ...c, ...patch } : c)));
  };

  const saveActiveClientField = async (patch: Partial<Pick<CompanyClientRow, "name" | "email" | "phone" | "address" | "notes" | "category">>) => {
    if (!activeClientId || !activeCompanyId) return;
    patchActiveClient(patch);
    await updateCompanyClientProfile(activeCompanyId, activeClientId, patch, {
      viewerUid: String(user?.uid || "").trim(),
      includeAll: canViewAllClients,
    });
  };

  // Archiving removes a contact from the main list without deleting their data — a second,
  // explicit tap is required (isConfirmingArchive) so a stray click can't hide someone by accident.
  const [isConfirmingArchive, setIsConfirmingArchive] = useState(false);
  const [isArchiving, setIsArchiving] = useState(false);
  useEffect(() => {
    setIsConfirmingArchive(false);
  }, [activeClientId]);
  const handleArchiveActiveContact = async () => {
    if (!activeClientId || !activeCompanyId) return;
    setIsArchiving(true);
    try {
      const result = await updateCompanyClientProfile(activeCompanyId, activeClientId, { archived: true }, {
        viewerUid: String(user?.uid || "").trim(),
        includeAll: canViewAllClients,
      });
      if (!result.ok) return;
      const archivedId = activeClientId;
      setClients((prev) => prev.filter((c) => c.id !== archivedId));
      setClientDetailsById((prev) => {
        const next = { ...prev };
        delete next[archivedId];
        return next;
      });
      setActiveClientId("");
    } finally {
      setIsArchiving(false);
      setIsConfirmingArchive(false);
    }
  };

  const handleAddContactSubmit = async () => {
    if (!activeCompanyId || !user?.uid) return;
    const name = contactForm.name.trim();
    const email = contactForm.email.trim();
    const phone = contactForm.phone.trim();
    if (!name && !email && !phone) {
      setAddContactMessage("Enter at least a name, email, or phone.");
      return;
    }
    setIsSavingContact(true);
    setAddContactMessage("");
    try {
      const result = await createOrAttachManualCompanyClient(
        activeCompanyId,
        {
          name,
          email,
          phone,
          address: contactForm.address.trim(),
          notes: contactForm.notes.trim(),
          category: contactForm.category.trim(),
        },
        user.uid,
      );
      if (!result.ok) {
        setAddContactMessage("Couldn't save that contact — try again.");
        return;
      }
      setAddContactMessage(result.merged ? "Matched an existing contact." : "Contact added.");
      setContactForm(emptyContactForm);
      setReloadTick((tick) => tick + 1);
      window.setTimeout(() => {
        setIsAddContactOpen(false);
        setAddContactMessage("");
      }, 1100);
    } finally {
      setIsSavingContact(false);
    }
  };

  return (
    <>
        {access.status === "loading" ? (
          <div className="rounded-[14px] border p-6 text-[13px] font-semibold" style={{ borderColor: border, backgroundColor: panelBg, color: textSoft }}>
            Checking access...
          </div>
        ) : access.status === "error" ? (
          <div className="rounded-[14px] border p-6 text-[13px] font-semibold" style={{ borderColor: border, backgroundColor: panelBg, color: textSoft }}>
            <p>Couldn&apos;t check your access to clients — the connection may be slow or offline.</p>
            <button
              type="button"
              onClick={() => access.retry()}
              className="mt-3 inline-flex h-9 items-center rounded-[8px] border px-3 text-[12px] font-bold hover:brightness-95"
              style={{ borderColor: border, backgroundColor: panelBg, color: textSoft }}
            >
              Retry
            </button>
          </div>
        ) : !canAccessClients ? (
          <div className="rounded-[14px] border p-6 text-[13px] font-semibold" style={{ borderColor: border, backgroundColor: panelBg, color: textSoft }}>
            You do not have access to contact profiles.
          </div>
          ) : (
            <div className="-ml-4 -mr-4 -mb-4 -mt-4 min-h-[calc(100vh-96px)] md:-ml-5 md:-mr-5" style={{ color: text, backgroundColor: pageBg }}>
            <section className="min-h-[calc(100vh-96px)] pb-4 pt-0" style={{ backgroundColor: pageBg }}>
                {/* sticky (not fixed) + top-0/lg:top-[48px], matching company-settings/page.tsx's own
                    .glass-page-header convention exactly — GlobalAppTabsBar (components/global-app-
                    tabs-bar.tsx) is a separate fixed h-12 (48px) bar at z-[95] that sits above
                    everything, so a page header needs to clear it by that same 48px on large screens
                    (where the tab bar is visible) rather than sitting at top-0 itself, which would put
                    this header's top portion right behind it. Sticky also means no manual spacer div
                    is needed below to reserve the space this header occupies, unlike a fixed header. */}
                {/* The outer wrapper's own -ml-4/-mr-4 (md:-ml-5/-mr-5) full-bleed negative margin
                    exists so the row list below can stretch edge-to-edge, but this header is sticky
                    (normal document flow, unlike the old fixed version which ignored ancestor margins
                    entirely via left-0/right-0), so without some correction it either inherits the
                    full-bleed width and spills out under the sidebar (no margin) or lands past the
                    page's own padding into a visible gap (fully cancelling the negative margin,
                    ml-4/md:ml-5). lg:ml-2/lg:mr-2 splits the difference, landing it flush against the
                    sidebar's own right edge — verified against its measured boundingClientRect. Only
                    needed at lg+ (there's a sidebar to clear there); below that there's no sidebar, so
                    the header stays full-bleed like the row list below it, flush with the screen edge. */}
                <div className="glass-page-header sticky -top-3 z-[95] lg:ml-2 lg:mr-2">
                <div
                  className="flex min-h-[56px] items-center justify-between gap-3 border-b px-4 py-2 md:px-5"
                  style={{ borderColor: border }}
                >
                  <div className="flex min-w-0 items-center gap-2">
                    <Users size={16} color="#12345B" strokeWidth={2.1} />
                    <p className="truncate text-[14px] font-medium uppercase tracking-[1px]" style={{ color: "#12345B" }}>
                      Contacts
                    </p>
                    <span className="text-[14px] font-medium" style={{ color: "#6B7280" }}>
                      |
                    </span>
                    <p className="truncate text-[14px] font-medium" style={{ color: "#334155" }}>
                      {companyName || "Company"}
                    </p>
                  </div>
                  {/* Desktop/tablet: full labeled controls, always expanded — unchanged from before. */}
                  <div className="hidden shrink-0 items-center gap-2 md:flex">
                    {contactCategories.length > 0 ? (
                      <select
                        value={categoryFilter}
                        onChange={(e) => setCategoryFilter(e.target.value)}
                        className="h-9 rounded-[10px] border px-2 text-[12px] font-semibold"
                        style={{ borderColor: border, backgroundColor: isDarkMode ? "#0F172A" : "#FFFFFF", color: text }}
                      >
                        <option value="">All Categories</option>
                        {contactCategories.map((c) => (
                          <option key={c.name} value={c.name}>{c.name}</option>
                        ))}
                      </select>
                    ) : null}
                    <div
                      className="flex h-9 items-center gap-2 rounded-[10px] border px-3"
                      style={{ width: 280, minWidth: 220, borderColor: border, backgroundColor: isDarkMode ? "#0F172A" : "#FFFFFF" }}
                    >
                      <Search size={14} className="shrink-0" style={{ color: textSoft }} />
                      <input
                        value={search}
                        onChange={(e) => setSearch(e.target.value)}
                        placeholder="Search contacts..."
                        className="h-8 w-full bg-transparent text-[12px] outline-none"
                        style={{ color: text }}
                      />
                    </div>
                    <button
                      type="button"
                      onClick={(e) => {
                        addContactOriginElRef.current = e.currentTarget;
                        setAddContactOrigin(captureGlassModalOrigin(e));
                        setContactForm(emptyContactForm);
                        setAddContactMessage("");
                        setIsAddContactOpen(true);
                      }}
                      className="inline-flex h-9 items-center gap-1.5 rounded-[9px] border px-3 text-[12px] font-bold text-white hover:brightness-95"
                      style={{ backgroundImage: "var(--brand-gradient)", borderColor: "var(--brand-strong)" }}
                    >
                      <Plus size={20} />
                      Add Contact
                    </button>
                  </div>
                </div>
                {/* Mobile: its own separate bar below the title row (not sharing a line with it) —
                    + left-aligned, category filter centered, search right-aligned. Centering works
                    via plain justify-between symmetry: the + button and the collapsed search button
                    are both exactly w-9 (36px), so the free space split evenly on each side of the
                    filter between them lands it visually centered. Tapping search grows its own
                    max-width while the filter's max-width shrinks to 0 on the same duration, so the
                    filter visibly slides away as search takes over the row. */}
                <div
                  className="flex items-center justify-between gap-2 border-b px-4 py-2 md:hidden"
                  style={{ borderColor: border }}
                >
                  <button
                    type="button"
                    onClick={(e) => {
                      addContactOriginElRef.current = e.currentTarget;
                      setAddContactOrigin(captureGlassModalOrigin(e));
                      setContactForm(emptyContactForm);
                      setAddContactMessage("");
                      setIsAddContactOpen(true);
                    }}
                    className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-[9px] border text-white hover:brightness-95"
                    style={{ backgroundImage: "var(--brand-gradient)", borderColor: "var(--brand-strong)" }}
                    aria-label="Add contact"
                  >
                    <Plus size={20} />
                  </button>
                  {contactCategories.length > 0 ? (
                    <div
                      className={`overflow-hidden transition-all duration-200 ${isMobileSearchOpen ? "max-w-0 opacity-0" : "max-w-[120px] opacity-100"}`}
                    >
                      <select
                        value={categoryFilter}
                        onChange={(e) => setCategoryFilter(e.target.value)}
                        className="h-9 w-[120px] rounded-[10px] border px-2 text-[12px] font-semibold"
                        style={{ borderColor: border, backgroundColor: isDarkMode ? "#0F172A" : "#FFFFFF", color: text }}
                      >
                        <option value="">All Categories</option>
                        {contactCategories.map((c) => (
                          <option key={c.name} value={c.name}>{c.name}</option>
                        ))}
                      </select>
                    </div>
                  ) : null}
                  <div
                    className={`flex h-9 min-w-0 items-center overflow-hidden rounded-[10px] border transition-all duration-200 ${isMobileSearchOpen ? "max-w-[500px] flex-1 gap-2 px-3" : "max-w-9 shrink-0 justify-center gap-0 px-0"}`}
                    style={{ borderColor: border, backgroundColor: isDarkMode ? "#0F172A" : "#FFFFFF" }}
                  >
                    <button
                      type="button"
                      onClick={() => {
                        if (isMobileSearchOpen) return;
                        setIsMobileSearchOpen(true);
                        window.setTimeout(() => mobileSearchInputRef.current?.focus(), 0);
                      }}
                      className="inline-flex h-8 w-8 shrink-0 items-center justify-center"
                      aria-label="Search contacts"
                    >
                      <Search size={14} style={{ color: textSoft }} />
                    </button>
                    {isMobileSearchOpen ? (
                      <>
                        <input
                          ref={mobileSearchInputRef}
                          value={search}
                          onChange={(e) => setSearch(e.target.value)}
                          placeholder="Search contacts..."
                          className="h-8 w-full min-w-0 bg-transparent text-[12px] outline-none"
                          style={{ color: text }}
                        />
                        <button
                          type="button"
                          onClick={() => {
                            setSearch("");
                            setIsMobileSearchOpen(false);
                          }}
                          className="shrink-0"
                          aria-label="Close search"
                        >
                          <X size={14} style={{ color: textSoft }} />
                        </button>
                      </>
                    ) : null}
                  </div>
                </div>
                {/* Column header row — desktop/tablet only; mobile shows just the name per row so a
                    "Contact" label on its own isn't useful. */}
                <div
                  className="hidden items-center gap-3 border-b px-4 py-[7px] text-[12px] font-semibold md:grid md:grid-cols-[minmax(220px,1.4fr)_minmax(200px,1.1fr)_minmax(160px,1fr)_140px_110px] md:px-5"
                  style={{ borderColor: border, color: text }}
                >
                  <span>Contact</span>
                  <span>Email</span>
                  <span>Phone</span>
                  <span>Last Project</span>
                  <span>Projects</span>
                </div>
              </div>

              <div className="-ml-0 overflow-x-auto" style={{ backgroundColor: pageBg }}>
                <div className="min-w-full" style={{ backgroundColor: pageBg }}>

                {loading ? (
                  <div
                    className="flex min-h-[calc(100vh-176px)] min-w-full items-center justify-center px-4 py-4 text-[13px] md:px-5"
                    style={{ color: textSoft, backgroundColor: pageBg }}
                  >
                    Loading contacts...
                  </div>
                ) : filteredClients.length === 0 ? (
                  <div
                    className="flex min-h-[calc(100vh-176px)] min-w-full items-center justify-center px-4 py-5 text-[13px] md:px-5"
                    style={{ color: textSoft, backgroundColor: pageBg }}
                  >
                    No contacts yet.
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
                      {letterClients.map((client) => {
                        const categoryColor = client.category ? categoryColorByName.get(client.category) : undefined;
                        return (
                          <button
                            key={client.id}
                            type="button"
                            onClick={(e) => {
                              clientModalOriginElRef.current = e.currentTarget;
                              setClientModalOrigin(captureGlassModalOrigin(e));
                              setActiveClientId(client.id);
                            }}
                            className="grid min-w-full grid-cols-1 items-center gap-3 border-b px-4 py-[9px] text-left text-[12px] transition-colors md:grid-cols-[minmax(220px,1.4fr)_minmax(200px,1.1fr)_minmax(160px,1fr)_140px_110px] md:px-5"
                            style={{
                              borderColor: border,
                              backgroundColor: panelBg,
                              color: text,
                            }}
                            onMouseEnter={(e) => {
                              e.currentTarget.style.backgroundColor = rowHover;
                            }}
                            onMouseLeave={(e) => {
                              e.currentTarget.style.backgroundColor = panelBg;
                            }}
                          >
                            <span className="flex min-w-0 items-center gap-2">
                              {categoryColor ? (
                                <span
                                  className="inline-block h-2.5 w-2.5 shrink-0 rounded-full"
                                  style={{ backgroundColor: categoryColor }}
                                  title={client.category}
                                />
                              ) : null}
                              <span className="truncate text-[14px] font-semibold">{client.name || "Unnamed Client"}</span>
                              <ChevronRight size={14} className="shrink-0 opacity-50" />
                            </span>
                            <span className="hidden truncate md:block">{client.email || "-"}</span>
                            <span className="hidden truncate md:block">{client.phone || "-"}</span>
                            <span className="hidden truncate md:block">{client.lastProjectAtIso ? timeSinceLabel(client.lastProjectAtIso) : "-"}</span>
                            <span className="hidden md:block">{client.projectCount}</span>
                          </button>
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

        {/* Contact detail — glass modal, replaces the old inline-expand dropdown. */}
        {shouldRenderClientModal ? (
          <div className="fixed inset-0 z-[1700] flex items-center justify-center px-4 py-4">
            <button
              type="button"
              aria-label="Close contact"
              onClick={() => setActiveClientId("")}
              className="glass-modal-backdrop absolute inset-0"
            />
            <div
              ref={clientModalPanelRef}
              className="glass-modal-panel relative z-[1701] flex h-[min(760px,calc(100svh-32px))] w-full max-w-[920px] flex-col overflow-hidden"
            >
              <div className="glass-modal-header flex items-center justify-between px-4 py-3">
                <p className="truncate text-[13px] font-extrabold uppercase tracking-[0.8px]" style={{ color: "var(--text-main)" }}>
                  {activeDetail?.name || "Contact"}
                </p>
                <button
                  type="button"
                  onClick={() => setActiveClientId("")}
                  className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-[8px] border transition hover:brightness-95"
                  style={{ borderColor: "var(--glass-border)", backgroundColor: "var(--panel-bg)", color: "var(--text-muted)" }}
                >
                  <X size={16} />
                </button>
              </div>
              <div className="flex-1 overflow-y-auto px-4 py-4">
                {activeDetailLoading ? (
                  <div className="rounded-[14px] border p-4 text-[13px]" style={{ borderColor: "var(--glass-border)", backgroundColor: "var(--panel-bg)", color: "var(--text-muted)" }}>
                    Loading contact details...
                  </div>
                ) : activeDetail ? (
                  <div className="grid gap-4 xl:grid-cols-[360px_1fr]">
                    <div className="space-y-3">
                      <div className="rounded-[14px] border p-4" style={{ borderColor: "var(--glass-border)", backgroundColor: "var(--panel-bg)" }}>
                        <p className="text-[12px] font-extrabold uppercase tracking-[0.8px]" style={{ color: "var(--text-main)" }}>
                          Profile
                        </p>
                        <div className="mt-3 space-y-2.5">
                          <label className="block text-[11px] font-bold" style={{ color: "var(--text-muted)" }}>
                            Name
                            <input
                              defaultValue={activeDetail.name}
                              key={`${activeDetail.id}_name`}
                              onBlur={(e) => {
                                if (e.target.value.trim() !== activeDetail.name) void saveActiveClientField({ name: e.target.value.trim() });
                              }}
                              className={`${fieldInputClass} mt-1`}
                            />
                          </label>
                          <label className="block text-[11px] font-bold" style={{ color: "var(--text-muted)" }}>
                            Email
                            <input
                              defaultValue={activeDetail.email}
                              key={`${activeDetail.id}_email`}
                              onBlur={(e) => {
                                if (e.target.value.trim() !== activeDetail.email) void saveActiveClientField({ email: e.target.value.trim() });
                              }}
                              className={`${fieldInputClass} mt-1`}
                            />
                          </label>
                          <label className="block text-[11px] font-bold" style={{ color: "var(--text-muted)" }}>
                            Phone
                            <input
                              defaultValue={activeDetail.phone}
                              key={`${activeDetail.id}_phone`}
                              onBlur={(e) => {
                                if (e.target.value.trim() !== activeDetail.phone) void saveActiveClientField({ phone: e.target.value.trim() });
                              }}
                              className={`${fieldInputClass} mt-1`}
                            />
                          </label>
                          <label className="block text-[11px] font-bold" style={{ color: "var(--text-muted)" }}>
                            Address
                            <input
                              defaultValue={activeDetail.address}
                              key={`${activeDetail.id}_address`}
                              onBlur={(e) => {
                                if (e.target.value.trim() !== activeDetail.address) void saveActiveClientField({ address: e.target.value.trim() });
                              }}
                              className={`${fieldInputClass} mt-1`}
                            />
                          </label>
                          <label className="block text-[11px] font-bold" style={{ color: "var(--text-muted)" }}>
                            Category
                            <select
                              value={activeDetail.category || ""}
                              onChange={(e) => void saveActiveClientField({ category: e.target.value })}
                              className={`${fieldInputClass} mt-1`}
                            >
                              <option value="">Uncategorized</option>
                              {contactCategories.map((c) => (
                                <option key={c.name} value={c.name}>{c.name}</option>
                              ))}
                            </select>
                          </label>
                          <label className="block text-[11px] font-bold" style={{ color: "var(--text-muted)" }}>
                            Notes
                            <textarea
                              defaultValue={activeDetail.notes}
                              key={`${activeDetail.id}_notes`}
                              onBlur={(e) => {
                                if (e.target.value.trim() !== activeDetail.notes) void saveActiveClientField({ notes: e.target.value.trim() });
                              }}
                              rows={3}
                              className={`${fieldInputClass} mt-1 h-auto py-2`}
                            />
                          </label>
                          <div className="space-y-1 pt-1 text-[12px]" style={{ color: "var(--text-muted)" }}>
                            <p><span className="font-semibold" style={{ color: "var(--text-main)" }}>First Project:</span> {activeDetail.firstProjectAtIso ? formatClientDate(activeDetail.firstProjectAtIso) : "-"}</p>
                            <p><span className="font-semibold" style={{ color: "var(--text-main)" }}>Last Project:</span> {activeDetail.lastProjectAtIso ? formatClientDate(activeDetail.lastProjectAtIso) : "-"}</p>
                            <p><span className="font-semibold" style={{ color: "var(--text-main)" }}>Time Since Last Project:</span> {activeDetail.lastProjectAtIso ? timeSinceLabel(activeDetail.lastProjectAtIso) : "-"}</p>
                          </div>
                        </div>
                      </div>
                      <div
                        className="flex items-center justify-between gap-2 rounded-[14px] border p-3"
                        style={{ borderColor: "var(--danger-border)", backgroundColor: "var(--danger-soft)" }}
                      >
                        <p className="text-[12px] font-semibold" style={{ color: "var(--danger-strong)" }}>
                          {isConfirmingArchive ? "Remove from the main list?" : "Archive this contact"}
                        </p>
                        <button
                          type="button"
                          onClick={() => {
                            if (isConfirmingArchive) {
                              void handleArchiveActiveContact();
                            } else {
                              setIsConfirmingArchive(true);
                            }
                          }}
                          disabled={isArchiving}
                          className="inline-flex h-8 shrink-0 items-center rounded-[8px] border px-3 text-[12px] font-bold hover:brightness-95 disabled:opacity-60"
                          style={{ borderColor: "var(--danger-border)", backgroundColor: "var(--panel-bg)", color: "var(--danger-strong)" }}
                        >
                          {isArchiving ? "Archiving..." : isConfirmingArchive ? "Confirm Archive" : "Archive"}
                        </button>
                      </div>
                    </div>
                    <div className="space-y-3">
                      {([
                        { title: "Active Projects", rows: activeDetail.history.filter((h) => !isCompletedClientProjectStatus(h.statusLabel)), empty: "No active projects." },
                        { title: "Completed Projects", rows: activeDetail.history.filter((h) => isCompletedClientProjectStatus(h.statusLabel)), empty: "No completed projects." },
                      ] as const).map((section) => (
                        <div key={section.title} className="rounded-[14px] border p-4" style={{ borderColor: "var(--glass-border)", backgroundColor: "var(--panel-bg)" }}>
                          <p className="text-[12px] font-extrabold uppercase tracking-[0.8px]" style={{ color: "var(--text-main)" }}>
                            {section.title}
                          </p>
                          <div className="mt-3 space-y-2">
                            {section.rows.length === 0 ? (
                              <p className="text-[12px]" style={{ color: "var(--text-muted)" }}>{section.empty}</p>
                            ) : (
                              section.rows.map((history) => {
                                const canOpenProject = Boolean(String(history.projectId || "").trim());
                                const rowBody = (
                                  <div
                                    className="flex items-center justify-between rounded-[10px] border px-3 py-2 text-[12px] transition-colors"
                                    style={{ borderColor: "var(--glass-border)", color: "var(--text-main)", backgroundColor: isDarkMode ? "#0F172A" : "#FFFFFF" }}
                                  >
                                    <div className="min-w-0">
                                      <p className="truncate font-semibold">{history.projectName}</p>
                                      <p className="truncate" style={{ color: "var(--text-muted)" }}>
                                        {history.statusLabel} | {formatClientDate(history.updatedAtIso || history.createdAtIso)}
                                      </p>
                                    </div>
                                    {canOpenProject ? (
                                      <span className="ml-3 shrink-0 text-[11px]" style={{ color: "var(--text-muted)" }}>
                                        Open
                                      </span>
                                    ) : (
                                      <span className="ml-3 shrink-0 text-[11px]" style={{ color: "var(--text-muted)" }}>
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
                              })
                            )}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                ) : (
                  <div className="rounded-[14px] border p-4 text-[13px]" style={{ borderColor: "var(--glass-border)", backgroundColor: "var(--panel-bg)", color: "var(--text-muted)" }}>
                    Couldn&apos;t load this contact.
                  </div>
                )}
              </div>
            </div>
          </div>
        ) : null}

        {/* Add Contact — glass modal. */}
        {shouldRenderAddContactModal ? (
          <div className="fixed inset-0 z-[1700] flex items-center justify-center px-4 py-4">
            <button
              type="button"
              aria-label="Close add contact"
              onClick={() => (isSavingContact ? null : setIsAddContactOpen(false))}
              className="glass-modal-backdrop absolute inset-0"
            />
            <div
              ref={addContactPanelRef}
              className="glass-modal-panel relative z-[1701] flex h-[min(600px,calc(100svh-32px))] w-full max-w-[520px] flex-col overflow-hidden"
            >
              <div className="glass-modal-header flex items-center justify-between px-4 py-3">
                <p className="text-[13px] font-extrabold uppercase tracking-[0.8px]" style={{ color: "var(--text-main)" }}>
                  Add Contact
                </p>
                <button
                  type="button"
                  onClick={() => setIsAddContactOpen(false)}
                  disabled={isSavingContact}
                  className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-[8px] border transition hover:brightness-95 disabled:opacity-60"
                  style={{ borderColor: "var(--glass-border)", backgroundColor: "var(--panel-bg)", color: "var(--text-muted)" }}
                >
                  <X size={16} />
                </button>
              </div>
              <div className="flex-1 space-y-2.5 overflow-y-auto px-4 py-4">
                <label className="block text-[11px] font-bold" style={{ color: "var(--text-muted)" }}>
                  Name
                  <input
                    value={contactForm.name}
                    onChange={(e) => setContactForm((prev) => ({ ...prev, name: e.target.value }))}
                    className={`${fieldInputClass} mt-1`}
                  />
                </label>
                <label className="block text-[11px] font-bold" style={{ color: "var(--text-muted)" }}>
                  Email
                  <input
                    value={contactForm.email}
                    onChange={(e) => setContactForm((prev) => ({ ...prev, email: e.target.value }))}
                    className={`${fieldInputClass} mt-1`}
                  />
                </label>
                <label className="block text-[11px] font-bold" style={{ color: "var(--text-muted)" }}>
                  Phone
                  <input
                    value={contactForm.phone}
                    onChange={(e) => setContactForm((prev) => ({ ...prev, phone: e.target.value }))}
                    className={`${fieldInputClass} mt-1`}
                  />
                </label>
                <label className="block text-[11px] font-bold" style={{ color: "var(--text-muted)" }}>
                  Address
                  <input
                    value={contactForm.address}
                    onChange={(e) => setContactForm((prev) => ({ ...prev, address: e.target.value }))}
                    className={`${fieldInputClass} mt-1`}
                  />
                </label>
                <label className="block text-[11px] font-bold" style={{ color: "var(--text-muted)" }}>
                  Category
                  <select
                    value={contactForm.category}
                    onChange={(e) => setContactForm((prev) => ({ ...prev, category: e.target.value }))}
                    className={`${fieldInputClass} mt-1`}
                  >
                    <option value="">Uncategorized</option>
                    {contactCategories.map((c) => (
                      <option key={c.name} value={c.name}>{c.name}</option>
                    ))}
                  </select>
                </label>
                <label className="block text-[11px] font-bold" style={{ color: "var(--text-muted)" }}>
                  Notes
                  <textarea
                    value={contactForm.notes}
                    onChange={(e) => setContactForm((prev) => ({ ...prev, notes: e.target.value }))}
                    rows={3}
                    className={`${fieldInputClass} mt-1 h-auto py-2`}
                  />
                </label>
                {addContactMessage ? (
                  <p className="text-[12px] font-semibold" style={{ color: "var(--brand-strong)" }}>{addContactMessage}</p>
                ) : null}
              </div>
              <div className="flex items-center justify-end gap-2 border-t px-4 py-3" style={{ borderColor: "var(--glass-border)" }}>
                <button type="button" onClick={() => setIsAddContactOpen(false)} disabled={isSavingContact} className={secondaryButtonClass}>
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={() => void handleAddContactSubmit()}
                  disabled={isSavingContact}
                  className="inline-flex h-9 items-center gap-1.5 rounded-[8px] border px-3 text-[12px] font-bold hover:brightness-95 disabled:opacity-60"
                  style={{ borderColor: "var(--brand-strong)", backgroundColor: "var(--brand-soft)", color: "var(--brand-strong)" }}
                >
                  {isSavingContact ? "Saving..." : "Save Contact"}
                </button>
              </div>
            </div>
          </div>
        ) : null}
    </>
  );
}
