"use client";

import { activeDate, useCompanyFormats } from "@/lib/company-formats";
import {
  Fragment,
  Suspense,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type MouseEvent as ReactMouseEvent,
  type TouchEvent as ReactTouchEvent,
  type UIEvent as ReactUIEvent,
} from "react";
import { createPortal } from "react-dom";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Archive, Check, ChevronLeft, Mail, MapPin, MessageSquare, Pencil, Phone, Plus, Search, Users, X } from "lucide-react";
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
import { retryAsync } from "@/lib/load-retry";
import { hasPermissionKey, isOwnerOrAdmin, useCompanyAccess } from "@/lib/use-company-access";
import { captureGlassModalOrigin, useGlassModalPopOrigin, type GlassModalOrigin } from "@/lib/use-glass-modal-pop-origin";
import { useLongPress } from "@/lib/use-long-press";
import { GlassActionMenu, GlassDropdown, type GlassActionMenuItem, type GlassDropdownOption } from "@/components/glass-dropdown";

type ContactCategoryOption = { name: string; color: string };

// Duplicated from company-settings/page.tsx's own field-input styling convention rather than shared,
// matching this codebase's established "each consuming file keeps its own small styling consts" rule.
const fieldInputClass =
  "h-9 w-full rounded-[8px] border border-[var(--glass-border)] bg-[var(--panel-bg)] px-2.5 text-[12px] font-medium text-[var(--text-main)] outline-none transition focus:border-[var(--brand)] disabled:opacity-60";
// The profile fields while editing: the regular field look, plus (on mobile only) the frosted-glass fill that
// matches the glass containers they sit in — see .cs-glass-field in globals.css.
const fieldInputEditClass = `${fieldInputClass} cs-glass-field`;
// The same field when the profile isn't being edited: no box, so it reads as plain text (bg-transparent
// also keeps it clear of globals.css's dark-mode "force a grey background on every input" rule).
const fieldReadonlyClass =
  "cs-plain-field h-9 w-full cursor-default rounded-[8px] border border-transparent bg-transparent px-2.5 text-[12px] font-medium text-[var(--text-main)] outline-none";
// On mobile each profile field sits in its own container; from md up this adds nothing (the single
// Profile card around them provides the chrome).
const mobileFieldCardClass =
  "glass-card-mobile rounded-[14px] border px-3 py-2";
// A single-line read-mode value on mobile: short and flush-left, so a container is label + value and little else.
// ! so these win over fieldReadonlyClass's own margin/height/padding/size on the same element.
const mobileReadonlyLineClass = "!mt-0 !h-6 !px-0 !text-[14px]";
const secondaryButtonClass =
  "inline-flex h-9 shrink-0 items-center justify-center gap-1.5 rounded-[8px] border border-[var(--glass-border)] bg-[var(--panel-bg)] px-3 text-[12px] font-bold text-[var(--text-main)] transition hover:brightness-95 disabled:opacity-60";

// Theme colours come straight from the app's CSS variables (set per theme by globals.css) instead of
// a JS-side light/dark palette, so this page follows the app's dark mode with no flash and no
// listener to keep in sync.
const pageBg = "var(--bg-app)";
const panelBg = "var(--panel-bg)";
const border = "var(--panel-border)";
const text = "var(--text-main)";
const textSoft = "var(--text-muted)";

const emptyContactForm = { name: "", email: "", phone: "", address: "", notes: "", category: "" };

// Same starter set company-settings/page.tsx falls back to when a company has never saved any, so
// this page and the settings page agree on what the categories are.
const DEFAULT_CONTACT_CATEGORIES: ContactCategoryOption[] = [
  { name: "Clients", color: "#4ADE80" },
  { name: "Contractor", color: "#F2A33C" },
  { name: "Supplier", color: "#7D99B3" },
];
const NEUTRAL_AMBIENT_COLOR = "#7D99B3";
// The letters on the list's A–Z index strip (the list groups anything that isn't A–Z under "#").
const LETTER_STRIP = [..."ABCDEFGHIJKLMNOPQRSTUVWXYZ", "#"];

// The list slides out / the contact page slides in over this long (matches the app's own drawer
// easing); the contact stays mounted for DETAIL_EXIT_MS so it doesn't blank out mid slide.
const STAGE_SLIDE_CLASS = "transition-transform duration-[260ms] ease-[cubic-bezier(0.32,0.72,0,1)] motion-reduce:transition-none";
const DETAIL_EXIT_MS = 320;

// Mobile contact header (see the collapsing header in the contact pane): it starts MOBILE_HDR_EXPANDED_PX
// tall with the big centred badge, and its height follows the scroll position down to a
// MOBILE_HDR_COLLAPSED_PX sticky bar holding a small badge + the name. The numbers below place each
// piece for both ends of that range; the in-between is interpolated from the scroll progress.
const MOBILE_HDR_EXPANDED_PX = 340;
const MOBILE_HDR_COLLAPSED_PX = 64;
const MOBILE_BADGE_EXPANDED_PX = 144;
const MOBILE_BADGE_COLLAPSED_PX = 40;
const MOBILE_BADGE_TOP_EXPANDED_PX = 56;
const MOBILE_BADGE_TOP_COLLAPSED_PX = (MOBILE_HDR_COLLAPSED_PX - MOBILE_BADGE_COLLAPSED_PX) / 2;
// Collapsed bar, left to right: the Edit button (12px from the left edge) — a 72px "Edit" pill that
// shrinks to a 40px icon-only circle as the header collapses — then the small badge, the name, and the
// 40px back button (12px from the right edge).
const MOBILE_EDIT_BUTTON_EXPANDED_PX = 72;
const MOBILE_EDIT_BUTTON_COLLAPSED_PX = 40;
const MOBILE_BADGE_LEFT_COLLAPSED_PX = 12 + MOBILE_EDIT_BUTTON_COLLAPSED_PX + 10;
const MOBILE_NAME_LEFT_COLLAPSED_PX = MOBILE_BADGE_LEFT_COLLAPSED_PX + MOBILE_BADGE_COLLAPSED_PX + 10;
const MOBILE_NAME_RIGHT_COLLAPSED_PX = 12 + 40 + 10;

function normalizeContactCategoriesForDisplay(raw: unknown): ContactCategoryOption[] {
  if (!Array.isArray(raw)) return DEFAULT_CONTACT_CATEGORIES;
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

// The company's date format (lib/company-formats.ts).
function formatClientDate(value: string) {
  return activeDate(value) || "-";
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

function contactInitials(name: string, email: string) {
  const words = String(name || "")
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  if (words.length >= 2) return `${words[0].charAt(0)}${words[words.length - 1].charAt(0)}`.toUpperCase();
  if (words.length === 1) return words[0].slice(0, 2).toUpperCase();
  const fromEmail = String(email || "").trim().charAt(0);
  return fromEmail ? fromEmail.toUpperCase() : "?";
}

// Dark text on a light category colour, white on a dark one, so the big initials stay legible.
function readableTextOn(color: string) {
  const match = /^#?([0-9a-f]{6})$/i.exec(color.trim());
  if (!match) return "#FFFFFF";
  const value = parseInt(match[1], 16);
  const r = (value >> 16) & 255;
  const g = (value >> 8) & 255;
  const b = value & 255;
  const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  return luminance > 0.62 ? "#0F172A" : "#FFFFFF";
}

type ContactReachOption = { key: string; name: string; value: string };

// Every distinct phone number / email we hold for a contact, each tagged with who it belongs to: the
// contact's own details first, then whatever each of their projects was entered with (a household or
// company often has a different person's number or email on different projects). Junk placeholders
// ("-", "345", "hjk") are skipped so they don't become options.
function collectContactReach(contact: CompanyClientRow, field: "phone" | "email"): ContactReachOption[] {
  const seen = new Set<string>();
  const options: ContactReachOption[] = [];
  const add = (name: string, raw: string) => {
    const value = String(raw || "").trim();
    const key = field === "phone" ? value.replace(/\D+/g, "") : value.toLowerCase();
    const looksValid = field === "phone" ? key.length >= 5 : /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
    if (!looksValid || seen.has(key)) return;
    seen.add(key);
    options.push({ key, name: String(name || "").trim() || contact.name || "Contact", value });
  };
  add(contact.name, field === "phone" ? contact.phone : contact.email);
  for (const row of contact.history) {
    add(row.customer, field === "phone" ? row.clientPhone : row.clientEmail);
  }
  return options;
}

// Opens an address in the device's own maps app: Apple Maps on iPhone/iPad, the default maps app via a
// geo: link on Android (the system picks/offers the installed app), and Google Maps in a new tab elsewhere.
function openAddressInMaps(address: string) {
  const query = encodeURIComponent(String(address || "").trim());
  if (!query) return;
  const userAgent = navigator.userAgent;
  const isApple = /iPhone|iPad|iPod/.test(userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
  if (isApple) {
    window.location.href = `https://maps.apple.com/?q=${query}`;
  } else if (/Android/i.test(userAgent)) {
    window.location.href = `geo:0,0?q=${query}`;
  } else {
    window.open(`https://www.google.com/maps/search/?api=1&query=${query}`, "_blank", "noopener,noreferrer");
  }
}

// The contact view's category colour as a CSS variable (registered as a <color> in globals.css so changing it
// cross-fades); everything on the contact page that's tinted by the category is built from this.
const AMBIENT_VAR = "var(--ambient-color)";
// Same colour, separate property, so the initials badge can fade faster than the ambient background.
const BADGE_VAR = "var(--badge-color)";

function mix(color: string, percent: number) {
  return `color-mix(in srgb, ${color} ${percent}%, transparent)`;
}

// useSearchParams (used to notice the ?contact= param going away) needs a Suspense boundary.
export default function ClientsPage() {
  return (
    <Suspense fallback={null}>
      <ClientsPageInner />
    </Suspense>
  );
}

function ClientsPageInner() {
  // Re-render when the company's date format changes.
  useCompanyFormats();
  const { user } = useAuth();
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

  const access = useCompanyAccess();
  const activeCompanyId = access.companyId;

  // Contact page: the whole list slides left and the contact's own page slides in from the right
  // (replaces the old glass-modal popup). `activeClientId` is the contact being shown and stays set
  // until the slide-out finishes; `isDetailOpen` is what actually drives the slide.
  const [activeClientId, setActiveClientId] = useState("");
  const [isDetailOpen, setIsDetailOpen] = useState(false);
  const [skipStageTransition, setSkipStageTransition] = useState(false);
  const [isMobileHeaderCollapsed, setIsMobileHeaderCollapsed] = useState(false);
  // md+ (768px): the contact opens as a right-hand drawer over the list instead of replacing it, so the
  // list stays visible and usable (tap another contact to switch).
  const [isDesktopViewport, setIsDesktopViewport] = useState(false);
  useEffect(() => {
    const query = window.matchMedia("(min-width: 768px)");
    const sync = () => setIsDesktopViewport(query.matches);
    sync();
    query.addEventListener("change", sync);
    return () => query.removeEventListener("change", sync);
  }, []);
  const mobileHeaderRef = useRef<HTMLDivElement | null>(null);
  const [saveError, setSaveError] = useState("");
  // Bumped when a failed save is rolled back so the uncontrolled text inputs (defaultValue + key)
  // remount showing the restored value instead of the rejected edit.
  const [fieldsRev, setFieldsRev] = useState<Record<string, number>>({});
  const pushedDetailEntryRef = useRef(false);
  const exitTimerRef = useRef<number | null>(null);
  const pendingRemoveDetailIdRef = useRef("");
  const lastRowElRef = useRef<HTMLElement | null>(null);

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
        // Only fall back to the starter categories when the company doc was actually read and has none
        // saved; if it couldn't be read, show none rather than categories the company may not have.
        setContactCategories(
          companyDoc ? normalizeContactCategoriesForDisplay((companyDoc as Record<string, unknown>).contactCategories) : [],
        );
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

  // --- A–Z index strip (mobile) ------------------------------------------------------------------
  // A small floating strip down the right edge of the list: touch it and slide a finger along it to jump
  // the list to that letter. Letters with no contacts are dimmed and skipped (the touch lands on the next
  // letter that has some).
  const listScrollRef = useRef<HTMLDivElement | null>(null);
  const letterStripRef = useRef<HTMLDivElement | null>(null);
  const isScrubbingStripRef = useRef(false);
  const stripClearTimerRef = useRef<number | null>(null);
  const [activeStripLetter, setActiveStripLetter] = useState<string | null>(null);
  const availableLetters = useMemo(() => new Set(groupedClients.map(([letter]) => letter)), [groupedClients]);

  const scrubToLetterAtY = (clientY: number) => {
    const strip = letterStripRef.current;
    const scroller = listScrollRef.current;
    if (!strip || !scroller) return;
    const rect = strip.getBoundingClientRect();
    const ratio = Math.min(0.999, Math.max(0, (clientY - rect.top) / Math.max(1, rect.height)));
    const index = Math.floor(ratio * LETTER_STRIP.length);
    const letter =
      LETTER_STRIP.slice(index).find((candidate) => availableLetters.has(candidate)) ??
      [...LETTER_STRIP].reverse().find((candidate) => availableLetters.has(candidate));
    if (!letter) return;
    setActiveStripLetter(letter);
    const target = scroller.querySelector<HTMLElement>(`[data-letter="${letter}"]`);
    if (!target) return;
    scroller.scrollTop += target.getBoundingClientRect().top - scroller.getBoundingClientRect().top;
  };
  const endStripScrub = () => {
    isScrubbingStripRef.current = false;
    if (stripClearTimerRef.current) window.clearTimeout(stripClearTimerRef.current);
    stripClearTimerRef.current = window.setTimeout(() => setActiveStripLetter(null), 400);
  };
  useEffect(() => {
    return () => {
      if (stripClearTimerRef.current) window.clearTimeout(stripClearTimerRef.current);
    };
  }, []);

  // Options for the glass category dropdowns. `noneLabel` is "All Categories" for the list filter and
  // "Uncategorized" for a contact's own field; `currentValue` keeps a category that has since been
  // renamed/removed in Company Settings visible (instead of silently showing the none option).
  const buildCategoryOptions = (noneLabel: string, currentValue?: string): GlassDropdownOption[] => {
    const options: GlassDropdownOption[] = [
      { value: "", label: noneLabel },
      ...contactCategories.map((c) => ({ value: c.name, label: c.name, color: c.color })),
    ];
    if (currentValue && !contactCategories.some((c) => c.name === currentValue)) {
      options.push({ value: currentValue, label: currentValue });
    }
    return options;
  };

  useEffect(() => {
    // While the list is still loading, wait for it: its rows are the merged view (live project data
    // layered over the saved record), whereas fetching a single contact first (e.g. when landing on
    // /clients?contact=<id>) returns just the saved record with an older project history.
    if (loading || !activeClientId || !activeCompanyId || clientDetailsById[activeClientId]) return;
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
  }, [activeClientId, activeCompanyId, canViewAllClients, clientDetailsById, loading, user?.uid]);

  const activeDetail = activeClientId ? clientDetailsById[activeClientId] ?? null : null;
  const activeDetailLoading = Boolean(activeClientId) && !activeDetail && (loading || detailLoadingClientId === activeClientId);
  const activeCategoryColor = activeDetail?.category ? categoryColorByName.get(activeDetail.category) : undefined;
  const ambientColor = activeCategoryColor || NEUTRAL_AMBIENT_COLOR;

  // --- Contact page open/close (slide) + browser history --------------------------------------
  // Opening pushes a `?contact=<id>` history entry so the browser/phone Back button (and the
  // mobile "Save & Back" pull-down, which calls router.back()) closes the contact page instead of
  // leaving Contacts; coming back from a project opened out of a contact re-opens it too.
  const showDetail = useCallback((id: string) => {
    if (exitTimerRef.current) {
      window.clearTimeout(exitTimerRef.current);
      exitTimerRef.current = null;
    }
    pendingRemoveDetailIdRef.current = "";
    setSaveError("");
    setIsMobileHeaderCollapsed(false);
    setActiveClientId(id);
    setIsDetailOpen(true);
  }, []);

  const hideDetail = useCallback(() => {
    setIsDetailOpen(false);
    if (exitTimerRef.current) window.clearTimeout(exitTimerRef.current);
    exitTimerRef.current = window.setTimeout(() => {
      exitTimerRef.current = null;
      const removeId = pendingRemoveDetailIdRef.current;
      pendingRemoveDetailIdRef.current = "";
      setActiveClientId("");
      if (removeId) {
        setClientDetailsById((prev) => {
          const next = { ...prev };
          delete next[removeId];
          return next;
        });
      }
      const row = lastRowElRef.current;
      if (row?.isConnected) row.focus({ preventScroll: true });
    }, DETAIL_EXIT_MS);
  }, []);

  const openContact = (id: string, rowEl: HTMLElement) => {
    lastRowElRef.current = rowEl;
    // Desktop: the list stays usable beside the drawer, so a contact can be opened while another is
    // already showing — swap the current ?contact= entry rather than stacking a new one, so closing
    // still goes straight back to the plain list.
    const replacing = isDetailOpen && pushedDetailEntryRef.current;
    (document.activeElement as HTMLElement | null)?.blur?.();
    showDetail(id);
    try {
      const url = `${window.location.pathname}?contact=${encodeURIComponent(id)}`;
      if (replacing) window.history.replaceState({ contactDetail: true }, "", url);
      else window.history.pushState({ contactDetail: true }, "", url);
      pushedDetailEntryRef.current = true;
    } catch {
      pushedDetailEntryRef.current = false;
    }
  };

  const closeContact = useCallback(() => {
    // Flush any text field still being edited — its onBlur is what saves it.
    (document.activeElement as HTMLElement | null)?.blur?.();
    if (pushedDetailEntryRef.current) {
      pushedDetailEntryRef.current = false;
      window.history.back();
      return;
    }
    if (new URLSearchParams(window.location.search).has("contact")) {
      // null state (not the current one): Next's patched replaceState re-adds its own routing state
      // and keeps its notion of the URL in sync.
      window.history.replaceState(null, "", window.location.pathname);
    }
    hideDetail();
  }, [hideDetail]);

  useEffect(() => {
    const onPopState = () => {
      const id = new URLSearchParams(window.location.search).get("contact") || "";
      if (id) {
        pushedDetailEntryRef.current = Boolean((window.history.state as { contactDetail?: boolean } | null)?.contactDetail);
        showDetail(id);
        return;
      }
      pushedDetailEntryRef.current = false;
      // Back / the mobile pull-down "Save & Back" can leave a field focused mid-edit — blur it first
      // (while the contact is still the active one) so its onBlur save runs.
      (document.activeElement as HTMLElement | null)?.blur?.();
      hideDetail();
    };
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, [hideDetail, showDetail]);

  // A Next <Link> to /clients (the sidebar's Contacts item) changes the URL without a popstate, so the
  // search params are watched too: ?contact=<id> disappearing while the contact page is open closes it.
  const searchParams = useSearchParams();
  const contactParam = searchParams.get("contact") || "";
  const previousContactParamRef = useRef(contactParam);
  const isDetailOpenRef = useRef(false);
  useEffect(() => {
    isDetailOpenRef.current = isDetailOpen;
  }, [isDetailOpen]);
  useEffect(() => {
    const previous = previousContactParamRef.current;
    previousContactParamRef.current = contactParam;
    if (previous && !contactParam && isDetailOpenRef.current) {
      pushedDetailEntryRef.current = false;
      (document.activeElement as HTMLElement | null)?.blur?.();
      hideDetail();
    }
  }, [contactParam, hideDetail]);

  // Landing on /clients?contact=<id> (reload, or Back from a project opened out of a contact) starts
  // with that contact already open, with no slide. That history entry was pushed by this page, so
  // closing the contact pops it (history.back) instead of leaving a duplicate /clients entry.
  useEffect(() => {
    const id = new URLSearchParams(window.location.search).get("contact") || "";
    if (!id) return;
    pushedDetailEntryRef.current = Boolean((window.history.state as { contactDetail?: boolean } | null)?.contactDetail);
    setSkipStageTransition(true);
    showDetail(id);
    let raf2 = 0;
    const raf1 = requestAnimationFrame(() => {
      raf2 = requestAnimationFrame(() => setSkipStageTransition(false));
    });
    return () => {
      cancelAnimationFrame(raf1);
      cancelAnimationFrame(raf2);
    };
  }, [showDetail]);

  useEffect(() => {
    if (!isDetailOpen) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || isAddContactOpen) return;
      // A glass dropdown handles its own Escape first.
      if (document.querySelector('[data-glass-dropdown-menu="true"]')) return;
      closeContact();
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [closeContact, isAddContactOpen, isDetailOpen]);

  useEffect(() => {
    return () => {
      if (exitTimerRef.current) window.clearTimeout(exitTimerRef.current);
    };
  }, []);

  // --- Desktop drawer: click off to close -------------------------------------------------------
  // Any press outside the drawer closes it — except on a contact row (whose own click either switches to
  // that contact or, for the open contact's row, closes it), inside an open glass menu (that press just
  // closes the menu), the row long-press menu, or while the Add Contact modal is up.
  useEffect(() => {
    if (!isDesktopViewport || !isDetailOpen) return;
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as HTMLElement | null;
      if (!target || isAddContactOpen) return;
      if (detailPaneRef.current?.contains(target)) return;
      if (rowMenuRef.current?.contains(target)) return;
      if (target.closest("[data-contact-row-id]")) return;
      if (target.closest('[data-glass-dropdown-menu="true"]') || document.querySelector('[data-glass-dropdown-menu="true"]')) return;
      closeContact();
    };
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, [closeContact, isAddContactOpen, isDesktopViewport, isDetailOpen]);

  // --- Swipe right to go back (touch) ---------------------------------------------------------
  // A left-to-right swipe anywhere on the contact page drags it (and the list, sitting just off-screen
  // to its left) with the finger; letting go past a third of the width, or with a quick flick, finishes
  // the slide back to the list, otherwise it springs back. While dragging, data-swipe-dragging switches
  // both panes' CSS transitions off so they track the finger 1:1; on release it's cleared first, so the
  // finish/spring-back animates from wherever the finger left them. The transforms written here are the
  // exact strings the panes' own style props use, so React's next render agrees with the DOM.
  const listPaneRef = useRef<HTMLDivElement | null>(null);
  const detailPaneRef = useRef<HTMLDivElement | null>(null);
  const swipeBackRef = useRef<{ x: number; y: number; t: number; width: number; axis: "" | "x" | "none"; dx: number } | null>(null);
  const setPaneTransforms = (detail: string, list: string) => {
    if (detailPaneRef.current) detailPaneRef.current.style.transform = detail;
    if (listPaneRef.current) listPaneRef.current.style.transform = list;
  };
  const setPanesDragging = (dragging: boolean) => {
    for (const pane of [detailPaneRef.current, listPaneRef.current]) {
      if (!pane) continue;
      if (dragging) pane.dataset.swipeDragging = "true";
      else delete pane.dataset.swipeDragging;
    }
  };
  const onDetailTouchStart = (event: ReactTouchEvent<HTMLDivElement>) => {
    const touch = event.touches[0];
    // A glass dropdown/menu being open owns the touch (tapping outside it just closes it).
    if (!isDetailOpen || !touch || event.touches.length > 1 || document.querySelector('[data-glass-dropdown-menu="true"]')) {
      swipeBackRef.current = null;
      return;
    }
    swipeBackRef.current = {
      x: touch.clientX,
      y: touch.clientY,
      t: performance.now(),
      width: event.currentTarget.getBoundingClientRect().width || window.innerWidth,
      axis: "",
      dx: 0,
    };
  };
  const onDetailTouchMove = (event: ReactTouchEvent<HTMLDivElement>) => {
    const swipe = swipeBackRef.current;
    const touch = event.touches[0];
    if (!swipe || !touch || swipe.axis === "none") return;
    if (event.touches.length > 1) {
      swipeBackRef.current = null;
      if (swipe.axis === "x") {
        setPanesDragging(false);
        setPaneTransforms("translate3d(0, 0, 0)", "translate3d(-100%, 0, 0)");
      }
      return;
    }
    const dx = touch.clientX - swipe.x;
    const dy = touch.clientY - swipe.y;
    if (!swipe.axis) {
      if (Math.abs(dx) < 8 && Math.abs(dy) < 8) return;
      // Only a clearly sideways, rightward drag becomes the back swipe; anything else is left to scroll.
      swipe.axis = dx > 0 && Math.abs(dx) > Math.abs(dy) * 1.2 ? "x" : "none";
      if (swipe.axis !== "x") return;
      (document.activeElement as HTMLElement | null)?.blur?.();
      setPanesDragging(true);
    }
    swipe.dx = Math.max(0, dx);
    setPaneTransforms(`translate3d(${swipe.dx}px, 0, 0)`, `translate3d(calc(-100% + ${swipe.dx}px), 0, 0)`);
  };
  const onDetailTouchEnd = (event: ReactTouchEvent<HTMLDivElement>) => {
    const swipe = swipeBackRef.current;
    swipeBackRef.current = null;
    if (!swipe || swipe.axis !== "x") return;
    const cancelled = event.type === "touchcancel";
    const velocity = swipe.dx / Math.max(1, performance.now() - swipe.t);
    setPanesDragging(false);
    // Flush the transition-off state before writing the end position, so the move animates.
    void detailPaneRef.current?.offsetWidth;
    if (!cancelled && (swipe.dx > swipe.width * 0.3 || (velocity > 0.5 && swipe.dx > 40))) {
      setPaneTransforms("translate3d(100%, 0, 0)", "translate3d(0, 0, 0)");
      closeContact();
    } else {
      setPaneTransforms("translate3d(0, 0, 0)", "translate3d(-100%, 0, 0)");
    }
  };

  // --- Long-press a contact in the list -> menu (Archive) --------------------------------------
  // Same hold time as the Specifications cells' long-press (500ms, lib/use-long-press.ts). The menu
  // drops from the pressed row; Archive asks for a second tap before it actually archives.
  const rowLongPress = useLongPress();
  const rowMenuRef = useRef<HTMLDivElement | null>(null);
  const [rowMenu, setRowMenu] = useState<{ clientId: string; left: number; top: number; openUp: boolean } | null>(null);
  const [rowMenuClosing, setRowMenuClosing] = useState(false);
  const [rowMenuConfirming, setRowMenuConfirming] = useState(false);
  const [rowMenuBusy, setRowMenuBusy] = useState(false);
  const [rowMenuError, setRowMenuError] = useState("");
  const closeRowMenu = useCallback(() => {
    setRowMenuClosing(true);
    window.setTimeout(() => {
      setRowMenu(null);
      setRowMenuClosing(false);
      setRowMenuConfirming(false);
      setRowMenuError("");
    }, 180);
  }, []);
  const openRowMenu = (clientId: string, rowRect: { left: number; top: number; width: number; height: number }) => {
    const MENU_WIDTH = 220;
    const MENU_HEIGHT_ESTIMATE = 110;
    const openUp = rowRect.top + rowRect.height + MENU_HEIGHT_ESTIMATE > window.innerHeight - 12;
    setRowMenuClosing(false);
    setRowMenuConfirming(false);
    setRowMenuError("");
    setRowMenu({
      clientId,
      left: Math.min(Math.max(12, rowRect.left + 16), window.innerWidth - MENU_WIDTH - 12),
      top: openUp ? rowRect.top - 6 : rowRect.top + rowRect.height + 6,
      openUp,
    });
  };
  useEffect(() => {
    if (!rowMenu || rowMenuClosing) return;
    const onOutside = (event: Event) => {
      if (rowMenuRef.current?.contains(event.target as Node)) return;
      closeRowMenu();
    };
    const list = listScrollRef.current;
    document.addEventListener("mousedown", onOutside);
    document.addEventListener("touchstart", onOutside);
    list?.addEventListener("scroll", closeRowMenu, { passive: true });
    return () => {
      document.removeEventListener("mousedown", onOutside);
      document.removeEventListener("touchstart", onOutside);
      list?.removeEventListener("scroll", closeRowMenu);
    };
  }, [closeRowMenu, rowMenu, rowMenuClosing]);

  // Drives the mobile collapsing header from the contact scroller's position. The continuous part
  // (height + --p) is written straight to the element so scrolling doesn't re-render the page; only
  // the collapsed/expanded flip (badge slides left, name pops in) goes through state.
  const onDetailScroll = (event: ReactUIEvent<HTMLDivElement>) => {
    const header = mobileHeaderRef.current;
    if (!header) return;
    const scrolled = Math.max(0, event.currentTarget.scrollTop);
    const range = MOBILE_HDR_EXPANDED_PX - MOBILE_HDR_COLLAPSED_PX;
    const progress = Math.min(1, scrolled / range);
    header.style.setProperty("--p", String(progress));
    header.style.height = `${Math.max(MOBILE_HDR_COLLAPSED_PX, MOBILE_HDR_EXPANDED_PX - scrolled)}px`;
    // Once the name/pill/call/email group has faded out it must stop taking taps.
    header.dataset.fade = progress > 0.45 ? "1" : "0";
    setIsMobileHeaderCollapsed(progress >= 1);
  };

  // --- Saving ------------------------------------------------------------------------------------
  const patchClientById = (id: string, patch: Partial<CompanyClientRow>) => {
    setClientDetailsById((prev) => {
      const existing = prev[id];
      if (!existing) return prev;
      return { ...prev, [id]: { ...existing, ...patch } };
    });
    setClients((prev) => prev.map((c) => (c.id === id ? { ...c, ...patch } : c)));
  };

  // Every field change (including the category dropdown) is written straight away — optimistic in
  // the UI, rolled back with a visible error if the write doesn't go through.
  const saveActiveClientField = async (patch: Partial<Pick<CompanyClientRow, "name" | "email" | "phone" | "address" | "notes" | "category">>) => {
    if (!activeClientId || !activeCompanyId) return;
    const clientId = activeClientId;
    const contact = activeDetail;
    const previous: Partial<CompanyClientRow> = {};
    if (contact) {
      for (const key of Object.keys(patch) as Array<keyof typeof patch>) {
        (previous as Record<string, unknown>)[key] = contact[key];
      }
    }
    setSaveError("");
    patchClientById(clientId, patch);
    const result = await updateCompanyClientProfile(
      activeCompanyId,
      clientId,
      patch,
      { viewerUid: String(user?.uid || "").trim(), includeAll: canViewAllClients },
      contact,
    );
    if (!result.ok) {
      patchClientById(clientId, previous);
      // Only the fields in the rejected patch remount — anything else being typed in is left alone.
      setFieldsRev((rev) => {
        const next = { ...rev };
        for (const key of Object.keys(patch)) next[key] = (next[key] ?? 0) + 1;
        return next;
      });
      setSaveError("Couldn't save that change — it was reverted. Please try again.");
    }
  };

  // Archiving removes a contact from the main list without deleting their data — a second,
  // explicit tap is required (isConfirmingArchive) so a stray click can't hide someone by accident.
  const [isConfirmingArchive, setIsConfirmingArchive] = useState(false);
  const [isArchiving, setIsArchiving] = useState(false);
  const [archiveError, setArchiveError] = useState("");
  // The profile fields read as plain text until Edit is pressed (then Done); each field still saves
  // as soon as it changes / loses focus.
  const [isEditingProfile, setIsEditingProfile] = useState(false);
  useEffect(() => {
    setIsConfirmingArchive(false);
    setArchiveError("");
    setIsEditingProfile(false);
  }, [activeClientId]);
  const toggleEditingProfile = () => {
    if (isEditingProfile) {
      // Flush the field being typed in — its onBlur is what saves it.
      (document.activeElement as HTMLElement | null)?.blur?.();
    }
    setIsEditingProfile((editing) => !editing);
  };
  const handleArchiveActiveContact = async () => {
    if (!activeClientId || !activeCompanyId) return;
    setIsArchiving(true);
    setArchiveError("");
    try {
      const result = await updateCompanyClientProfile(
        activeCompanyId,
        activeClientId,
        { archived: true },
        { viewerUid: String(user?.uid || "").trim(), includeAll: canViewAllClients },
        activeDetail,
      );
      if (!result.ok) {
        setArchiveError("Couldn't archive this contact. Please try again.");
        return;
      }
      const archivedId = activeClientId;
      setClients((prev) => prev.filter((c) => c.id !== archivedId));
      // Dropped from the details cache only once the slide-out has finished (see hideDetail), so
      // the contact page doesn't flash "Couldn't load this contact." while it's still on screen.
      pendingRemoveDetailIdRef.current = archivedId;
      closeContact();
    } finally {
      setIsArchiving(false);
      setIsConfirmingArchive(false);
    }
  };

  // The list's long-press menu: same archive write as the contact page's Archive button, for any row.
  const handleArchiveFromRowMenu = async (clientId: string) => {
    if (!activeCompanyId || !clientId) return;
    setRowMenuBusy(true);
    setRowMenuError("");
    try {
      const row = clientDetailsById[clientId] ?? clients.find((c) => c.id === clientId) ?? null;
      const result = await updateCompanyClientProfile(
        activeCompanyId,
        clientId,
        { archived: true },
        { viewerUid: String(user?.uid || "").trim(), includeAll: canViewAllClients },
        row,
      );
      if (!result.ok) {
        setRowMenuError("Couldn't archive — try again.");
        return;
      }
      setClients((prev) => prev.filter((c) => c.id !== clientId));
      setClientDetailsById((prev) => {
        const next = { ...prev };
        delete next[clientId];
        return next;
      });
      closeRowMenu();
    } finally {
      setRowMenuBusy(false);
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

  const openAddContact = (e: ReactMouseEvent<HTMLElement>) => {
    addContactOriginElRef.current = e.currentTarget;
    setAddContactOrigin(captureGlassModalOrigin(e));
    setContactForm(emptyContactForm);
    setAddContactMessage("");
    setIsAddContactOpen(true);
  };

  // The category pill under the name is itself the category picker (edit mode or not): tapping it drops the
  // glass category menu, and a change saves straight away. Its colours come from the --ambient-color
  // variable, so a change cross-fades from the old category's tint to the new one along with the badge
  // and ambient behind it. An uncategorized contact shows an "Uncategorized" pill so it can still be tapped.
  const categoryPill = () =>
    activeDetail ? (
      <GlassDropdown
        value={activeDetail.category || ""}
        options={buildCategoryOptions("Uncategorized", activeDetail.category)}
        onChange={(next) => void saveActiveClientField({ category: next })}
        ariaLabel="Contact category"
        menuMinWidth={190}
        menuAlign="center"
        hideChevron
        triggerClassName="max-w-full rounded-full border px-2.5 py-[3px] text-[12px] font-medium"
        triggerStyle={{
          borderColor: mix(AMBIENT_VAR, 45),
          backgroundColor: mix(AMBIENT_VAR, 16),
          color: "var(--text-main)",
        }}
      />
    ) : null;

  // Mobile header buttons: round glass buttons, 40px — the same size as the badge once it has shrunk.
  const mobileRoundButtonClass =
    "glass-nav-arrow inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-full transition hover:brightness-95";
  // The same round glass button, 32px, for inside a (tight) profile field container.
  const mobileCompactRoundButtonClass =
    "glass-nav-arrow inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full transition hover:brightness-95";
  // Inside a field container these circles sit on top of the container's own frosted glass, so the plain
  // glass-nav-arrow fill stacks into a cool grey-white. A category-tinted fill (no extra blur) gives them
  // the same pinkish/lavender circle as the Call / Text / Email buttons under the badge.
  const containerIconButtonStyle: CSSProperties = {
    // The usual glass fill, pulled toward the category colour so it isn't the cool grey-white it otherwise
    // stacks to; the border stays the plain glass border (as on the header buttons).
    background: `color-mix(in srgb, ${AMBIENT_VAR} 16%, var(--glass-modal-bg))`,
    backdropFilter: "none",
    WebkitBackdropFilter: "none",
  };
  const backButtonMobile = (
    <button type="button" onClick={closeContact} className={mobileRoundButtonClass} aria-label="Back to contacts">
      <ChevronLeft size={22} />
    </button>
  );
  // Edit / Done — turns the profile fields editable (and back). Glass pill normally, brand-coloured while editing.
  const editButtonStyle: CSSProperties | undefined = isEditingProfile
    ? { backgroundImage: "var(--brand-gradient)", borderColor: "var(--brand-strong)", color: "#FFFFFF" }
    : undefined;
  // Mobile: stays the full labelled pill while the header shrinks; only once the header bottoms out and the
  // badge starts sliding left (isMobileHeaderCollapsed) does the label slide away and the pill close up to
  // an icon-only circle — same 220ms ease-out as the badge's slide, so the two move together.
  const editButtonMobile = (
    <button
      type="button"
      onClick={toggleEditingProfile}
      aria-pressed={isEditingProfile}
      aria-label={isEditingProfile ? "Done editing" : "Edit contact"}
      className="glass-nav-arrow inline-flex h-10 shrink-0 items-center justify-center overflow-hidden rounded-full text-[13px] font-medium hover:brightness-95 motion-reduce:!transition-none"
      style={{
        width: isMobileHeaderCollapsed ? MOBILE_EDIT_BUTTON_COLLAPSED_PX : MOBILE_EDIT_BUTTON_EXPANDED_PX,
        transition: "width 220ms ease-out, filter 150ms ease",
        ...editButtonStyle,
      }}
    >
      {isEditingProfile ? <Check size={16} className="shrink-0" /> : <Pencil size={15} className="shrink-0" />}
      <span
        className="overflow-hidden whitespace-nowrap motion-reduce:!transition-none"
        style={{
          maxWidth: isMobileHeaderCollapsed ? 0 : 36,
          marginLeft: isMobileHeaderCollapsed ? 0 : 6,
          opacity: isMobileHeaderCollapsed ? 0 : 1,
          transform: isMobileHeaderCollapsed ? "translateX(-10px)" : "translateX(0)",
          transition: "max-width 220ms ease-out, margin-left 220ms ease-out, transform 220ms ease-out, opacity 180ms ease-out",
        }}
      >
        {isEditingProfile ? "Done" : "Edit"}
      </span>
    </button>
  );
  // Call / Email: one tap when the contact has a single number/email; several (e.g. different people on
  // different projects) open a glass menu to pick which — the person's name on the left, the number or
  // email on the right.
  const callItems: GlassActionMenuItem[] = activeDetail
    ? collectContactReach(activeDetail, "phone").map((option) => ({
        key: option.key,
        label: option.name,
        detail: option.value,
        onSelect: () => {
          window.location.href = `tel:${option.value.replace(/[^\d+]/g, "")}`;
        },
      }))
    : [];
  // Text uses the same numbers as Call (and the same "which person?" menu when there are several).
  const textItems: GlassActionMenuItem[] = activeDetail
    ? collectContactReach(activeDetail, "phone").map((option) => ({
        key: option.key,
        label: option.name,
        detail: option.value,
        onSelect: () => {
          window.location.href = `sms:${option.value.replace(/[^\d+]/g, "")}`;
        },
      }))
    : [];
  const emailItems: GlassActionMenuItem[] = activeDetail
    ? collectContactReach(activeDetail, "email").map((option) => ({
        key: option.key,
        label: option.name,
        detail: option.value,
        onSelect: () => {
          window.location.href = `mailto:${option.value}`;
        },
      }))
    : [];

  const gateCardClass = "rounded-[14px] border p-6 text-[13px] font-semibold";

  return (
    <>
      {access.status === "loading" ? (
        <div className={gateCardClass} style={{ borderColor: border, backgroundColor: panelBg, color: textSoft }}>
          Checking access...
        </div>
      ) : access.status === "error" ? (
        <div className={gateCardClass} style={{ borderColor: border, backgroundColor: panelBg, color: textSoft }}>
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
        <div className={gateCardClass} style={{ borderColor: border, backgroundColor: panelBg, color: textSoft }}>
          You do not have access to contact profiles.
        </div>
      ) : (
        // A fixed stage under the top tab bar (left edge tracks the sidebar at lg+, the same way the tab
        // bar does) holding two side-by-side panes — the contact list and the contact page — that slide
        // together with a transform-only transition. Each pane scrolls on its own, so the list keeps its
        // scroll position while a contact is open. overflow-clip (not hidden) so the stage clips the
        // off-screen pane without becoming a scroll container.
        <div
          className="app-top-bar-sidebar-offset fixed bottom-0 left-0 right-0 top-12 overflow-clip"
          style={{ color: text, backgroundColor: pageBg }}
        >
          {/* LIST PANE */}
          <div
            ref={listPaneRef}
            className={`absolute inset-0 flex flex-col ${STAGE_SLIDE_CLASS} ${skipStageTransition ? "!transition-none" : ""} data-[swipe-dragging=true]:!transition-none md:![transform:none]`}
            style={{ transform: isDetailOpen ? "translate3d(-100%, 0, 0)" : "translate3d(0, 0, 0)" }}
            aria-hidden={isDetailOpen && !isDesktopViewport}
            inert={isDetailOpen && !isDesktopViewport}
          >
            <div className="glass-page-header relative z-[2] shrink-0">
              <div
                className="flex min-h-[56px] items-center justify-between gap-3 border-b px-4 py-2 md:px-5"
                style={{ borderColor: border }}
              >
                <div className="flex min-w-0 items-center gap-2">
                  <Users size={16} strokeWidth={2.1} style={{ color: text }} />
                  <p className="truncate text-[14px] font-medium uppercase tracking-[1px]" style={{ color: text }}>
                    Contacts
                  </p>
                  <span className="text-[14px] font-medium" style={{ color: textSoft }}>
                    |
                  </span>
                  <p className="truncate text-[14px] font-medium" style={{ color: text }}>
                    {companyName || "Company"}
                  </p>
                </div>
                {/* Desktop/tablet: full labeled controls, always expanded. */}
                <div className="hidden shrink-0 items-center gap-2 md:flex">
                  {contactCategories.length > 0 ? (
                    <GlassDropdown
                      value={categoryFilter}
                      options={buildCategoryOptions("All Categories")}
                      onChange={setCategoryFilter}
                      ariaLabel="Filter by category"
                      menuMinWidth={180}
                      triggerClassName="h-9 w-[190px] rounded-[10px] border px-3 text-[12px] font-medium"
                      triggerStyle={{ borderColor: border, backgroundColor: panelBg, color: text }}
                    />
                  ) : null}
                  <div
                    className="flex h-9 items-center gap-2 rounded-[10px] border px-3"
                    style={{ width: 280, minWidth: 220, borderColor: border, backgroundColor: panelBg }}
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
                    onClick={openAddContact}
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
                  filter visibly slides away as search takes over the row. The search icon keeps the
                  same left offset open and closed (collapsed: the box hugs the 32px button, so just
                  the 1px border; expanded: pl-0 + justify-start, the same 1px) so it doesn't jump
                  when it expands. */}
              <div
                className="flex items-center justify-between gap-2 border-b px-4 py-2 md:hidden"
                style={{ borderColor: border }}
              >
                <button
                  type="button"
                  onClick={openAddContact}
                  className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-[9px] border text-white hover:brightness-95"
                  style={{ backgroundImage: "var(--brand-gradient)", borderColor: "var(--brand-strong)" }}
                  aria-label="Add contact"
                >
                  <Plus size={20} />
                </button>
                {contactCategories.length > 0 ? (
                  <div
                    className={`overflow-hidden transition-all duration-200 ${isMobileSearchOpen ? "max-w-0 opacity-0" : "max-w-[140px] opacity-100"}`}
                  >
                    <GlassDropdown
                      value={categoryFilter}
                      options={buildCategoryOptions("All Categories")}
                      onChange={setCategoryFilter}
                      ariaLabel="Filter by category"
                      menuMinWidth={170}
                      triggerClassName="h-9 w-[140px] rounded-[10px] border px-2.5 text-[12px] font-medium"
                      triggerStyle={{ borderColor: border, backgroundColor: panelBg, color: text }}
                    />
                  </div>
                ) : null}
                <div
                  className={`flex h-9 min-w-0 items-center overflow-hidden rounded-[10px] border transition-all duration-200 ${isMobileSearchOpen ? "max-w-[500px] flex-1 justify-start gap-2 pl-0 pr-3" : "max-w-9 shrink-0 justify-center gap-0 px-0"}`}
                  style={{ borderColor: border, backgroundColor: panelBg }}
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

            <div className="relative flex min-h-0 flex-1 flex-col">
            <div
              ref={listScrollRef}
              className="glass-scroll min-h-0 flex-1 overflow-x-auto overflow-y-auto overscroll-contain"
              style={{
                backgroundColor: pageBg,
                // The fixed stage sits outside <main>, so it supplies the bottom safe-area / keyboard room <main> would have.
                paddingBottom: "calc(12px + var(--keyboard-inset-px, 0px) + env(safe-area-inset-bottom, 0px))",
              }}
            >
              <div className="min-w-full">
                {loading ? (
                  <div
                    className="flex min-h-[50vh] min-w-full items-center justify-center px-4 py-4 text-[13px] md:px-5"
                    style={{ color: textSoft }}
                  >
                    Loading contacts...
                  </div>
                ) : filteredClients.length === 0 ? (
                  <div
                    className="flex min-h-[50vh] min-w-full items-center justify-center px-4 py-5 text-[13px] md:px-5"
                    style={{ color: textSoft }}
                  >
                    No contacts yet.
                  </div>
                ) : (
                  groupedClients.map(([letter, letterClients]) => (
                    <div key={letter}>
                      <div
                        data-letter={letter}
                        className="border-b px-4 py-[8px] text-[22px] font-semibold md:px-5"
                        style={{ borderColor: border, backgroundColor: pageBg, color: text }}
                      >
                        {letter}
                      </div>
                      {letterClients.map((client) => {
                        const emblemColor = (client.category ? categoryColorByName.get(client.category) : undefined) || NEUTRAL_AMBIENT_COLOR;
                        // Long-press (touch) opens the row's menu; a normal tap still opens the contact.
                        const { style: longPressStyle, ...longPressHandlers } = rowLongPress.makeHandlers((origin) => openRowMenu(client.id, origin));
                        const isMenuRow = rowMenu?.clientId === client.id && !rowMenuClosing;
                        return (
                          <button
                            key={client.id}
                            type="button"
                            {...longPressHandlers}
                            data-contact-row-id={client.id}
                            onClick={(e) => {
                              // Desktop drawer: clicking the open contact's own row closes it; any other row
                              // switches the drawer to that contact.
                              if (isDesktopViewport && isDetailOpen && activeClientId === client.id) closeContact();
                              else openContact(client.id, e.currentTarget);
                            }}
                            onContextMenu={(e) => {
                              // The hold already opened our own menu; don't also show the browser's.
                              if (e.nativeEvent instanceof PointerEvent && e.nativeEvent.pointerType === "mouse") return;
                              e.preventDefault();
                            }}
                            className={`grid min-w-full grid-cols-1 items-center gap-3 border-b px-4 py-[9px] text-left text-[12px] transition-colors hover:bg-[var(--panel-muted)] max-md:pr-9 md:grid-cols-[minmax(220px,1.4fr)_minmax(200px,1.1fr)_minmax(160px,1fr)_140px_110px] md:px-5 ${isMenuRow ? "bg-[var(--panel-muted)]" : "bg-[var(--panel-bg)]"}`}
                            style={{ ...longPressStyle, borderColor: border, color: text }}
                          >
                            <span className="flex min-w-0 items-center gap-3">
                              {/* The contact's initials emblem in their category's colour (neutral when
                                  they have no category) — same look as the badge on their own page. */}
                              <span
                                aria-hidden
                                title={client.category || undefined}
                                className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-[12px] font-medium leading-none"
                                style={{
                                  background: `linear-gradient(145deg, color-mix(in srgb, ${emblemColor} 78%, white), ${emblemColor})`,
                                  color: readableTextOn(emblemColor),
                                  border: "1px solid rgba(255,255,255,0.4)",
                                }}
                              >
                                {contactInitials(client.name || "", client.email || "")}
                              </span>
                              <span className="truncate text-[14px] font-semibold">{client.name || "Unnamed Client"}</span>
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
            {/* A–Z index strip: mobile only, small, floating a few px in from the right edge and centred
                vertically over the list. touch-none stops the page scrolling under the finger while it slides
                along the letters; pointer capture keeps the drag tracked even if the finger drifts off the strip. */}
            {!loading && groupedClients.length > 0 ? (
              <div
                ref={letterStripRef}
                aria-hidden
                data-app-gesture-exempt="true"
                className="glass-nav-arrow absolute right-1 top-1/2 z-[3] flex h-[min(calc(100%-16px),372px)] w-[18px] -translate-y-1/2 touch-none select-none flex-col justify-between rounded-full py-1.5 md:hidden"
                onPointerDown={(e) => {
                  isScrubbingStripRef.current = true;
                  if (stripClearTimerRef.current) window.clearTimeout(stripClearTimerRef.current);
                  try {
                    e.currentTarget.setPointerCapture(e.pointerId);
                  } catch {
                    // No capturable pointer (e.g. a synthetic event) — scrubbing still works while over the strip.
                  }
                  scrubToLetterAtY(e.clientY);
                }}
                onPointerMove={(e) => {
                  if (isScrubbingStripRef.current) scrubToLetterAtY(e.clientY);
                }}
                onPointerUp={endStripScrub}
                onPointerCancel={endStripScrub}
              >
                {LETTER_STRIP.map((letter) => {
                  const available = availableLetters.has(letter);
                  const isActive = activeStripLetter === letter;
                  return (
                    <span
                      key={letter}
                      className="flex flex-1 items-center justify-center text-[9px] font-medium leading-none"
                      style={{
                        color: isActive ? "var(--brand-strong)" : available ? "var(--text-main)" : "var(--text-muted)",
                        opacity: available ? 1 : 0.4,
                        fontWeight: isActive ? 700 : undefined,
                        transform: isActive ? "scale(1.35)" : undefined,
                        transition: "transform 120ms ease-out",
                      }}
                    >
                      {letter}
                    </span>
                  );
                })}
              </div>
            ) : null}
            </div>
          </div>

          {/* CONTACT PANE — slides in from the right: over the whole stage on a phone, as a 440px drawer over
              the list from md up; the same phone layout either way. data-horizontal-swipe-scroll keeps a sideways swipe
              here from opening the nav drawer / notifications (the shell's own gestures), while the
              vertical pull-down still works; a rightward swipe is this pane's own "back to the list"
              (onDetailTouch*). touch-pan-y leaves vertical scrolling to the browser and hands
              horizontal drags to that gesture. */}
          <div
            ref={detailPaneRef}
            onTouchStart={onDetailTouchStart}
            onTouchMove={onDetailTouchMove}
            onTouchEnd={onDetailTouchEnd}
            onTouchCancel={onDetailTouchEnd}
            className={`cs-contact-pane @container absolute inset-y-0 right-0 z-[5] flex w-full touch-pan-y flex-col overflow-hidden md:w-[min(440px,100%)] md:border-l md:border-[var(--glass-border)] ${STAGE_SLIDE_CLASS} ${skipStageTransition ? "!transition-none" : ""} motion-reduce:!transition-none data-[swipe-dragging=true]:!transition-none`}
            style={
              {
                transform: isDetailOpen ? "translate3d(0, 0, 0)" : "translate3d(100%, 0, 0)",
                backgroundColor: pageBg,
                // The drawer's edge shadow over the list (desktop); off while closed so it can't peek in
                // from the right edge.
                boxShadow: isDesktopViewport && isDetailOpen ? "-16px 0 48px rgba(15, 23, 42, 0.18)" : "none",
                // The contact's category colour, as one registered <color> property that everything on this page
                // tints from. Besides the slide, it carries its own (slower) transition, so changing a contact's
                // category fades the old colour into the new one everywhere at once.
                "--ambient-color": ambientColor,
                // The initials badge reads its own copy so it can fade faster (300ms) than the background (800ms).
                "--badge-color": ambientColor,
                transitionProperty: "transform, --ambient-color, --badge-color",
                transitionDuration: "260ms, 800ms, 300ms",
                transitionTimingFunction: "cubic-bezier(0.32, 0.72, 0, 1), ease-in-out, ease-out",
              } as CSSProperties
            }
            aria-hidden={!isDetailOpen}
            inert={!isDetailOpen}
            data-horizontal-swipe-scroll="true"
          >
            {activeClientId ? (
              <Fragment key={activeClientId}>
                {/* Mobile: ambient wash of the contact's category colour at pane level (not clipped inside
                    the badge block) and the full height of the page: the glow around the badge, plus a faint
                    vertical wash that carries the colour all the way down behind the containers (which are
                    frosted glass on mobile, so they pick it up). (Desktop's ambient is inside the banner and
                    stops at its bottom edge.) */}
                <div
                  aria-hidden
                  className="pointer-events-none absolute inset-0 z-0"
                  style={{
                    backgroundImage: [
                      `radial-gradient(380px 360px at 50% 130px, ${mix(AMBIENT_VAR, 20)}, transparent 100%)`,
                      `radial-gradient(560px 280px at 50% 0px, ${mix(AMBIENT_VAR, 9)}, transparent 100%)`,
                      `linear-gradient(to bottom, ${mix(AMBIENT_VAR, 12)} 0%, ${mix(AMBIENT_VAR, 9)} 55%, ${mix(AMBIENT_VAR, 14)} 100%)`,
                    ].join(", "),
                  }}
                />

                {/* Mobile: a collapsing, sticky header. It overlays the top of the scroller (which reserves
                    MOBILE_HDR_EXPANDED_PX of top padding for it), and as the page scrolls its height tracks
                    the scroll position, so the big centred initials badge shrinks in step with the content
                    moving up. At its smallest it stays pinned as a glass bar: the badge slides left beside
                    the back button and the contact's name pops in. Scroll progress (--p, 0..1) is written
                    straight to the element's style by onDetailScroll — no re-render per frame. The overlay
                    ignores pointer events (only its buttons take them) so a drag that starts on it
                    still scrolls the list underneath. */}
                <div
                  ref={mobileHeaderRef}
                  className="pointer-events-none absolute inset-x-0 top-0 z-[2] overflow-hidden"
                  style={{ height: MOBILE_HDR_EXPANDED_PX, "--p": 0 } as CSSProperties}
                >
                  <div
                    aria-hidden
                    className="absolute inset-0 border-b"
                    style={{
                      opacity: "var(--p)",
                      borderColor: "var(--glass-border)",
                      backgroundColor: "var(--glass-modal-bg)",
                      backdropFilter: "blur(12px) saturate(220%)",
                      WebkitBackdropFilter: "blur(12px) saturate(220%)",
                    }}
                  />
                  <div className="pointer-events-auto absolute left-3 top-3">{editButtonMobile}</div>
                  <div className="pointer-events-auto absolute right-3 top-3">{backButtonMobile}</div>
                  <div
                    aria-hidden
                    className="absolute z-10 flex items-center justify-center rounded-full font-medium leading-none motion-reduce:!transition-none"
                    style={{
                      // The slide left (220ms) and the initials colour flipping light/dark with the category (300ms,
                      // the same quick fade as the badge's own fill).
                      transition: "left 220ms ease-out, transform 220ms ease-out, color 300ms ease-out",
                      top: `calc(${MOBILE_BADGE_TOP_EXPANDED_PX}px - ${MOBILE_BADGE_TOP_EXPANDED_PX - MOBILE_BADGE_TOP_COLLAPSED_PX}px * var(--p))`,
                      width: `calc(${MOBILE_BADGE_EXPANDED_PX}px - ${MOBILE_BADGE_EXPANDED_PX - MOBILE_BADGE_COLLAPSED_PX}px * var(--p))`,
                      height: `calc(${MOBILE_BADGE_EXPANDED_PX}px - ${MOBILE_BADGE_EXPANDED_PX - MOBILE_BADGE_COLLAPSED_PX}px * var(--p))`,
                      fontSize: `calc(${MOBILE_BADGE_EXPANDED_PX * 0.375}px - ${(MOBILE_BADGE_EXPANDED_PX - MOBILE_BADGE_COLLAPSED_PX) * 0.375}px * var(--p))`,
                      left: isMobileHeaderCollapsed ? MOBILE_BADGE_LEFT_COLLAPSED_PX : "50%",
                      transform: isMobileHeaderCollapsed ? "translateX(0)" : "translateX(-50%)",
                      background: `linear-gradient(145deg, color-mix(in srgb, ${BADGE_VAR} 78%, white), ${BADGE_VAR})`,
                      color: readableTextOn(ambientColor),
                      border: "1px solid rgba(255,255,255,0.4)",
                      boxShadow: `0 10px 28px ${mix(BADGE_VAR, 24)}, inset 0 1px 0 rgba(255,255,255,0.5)`,
                    }}
                  >
                    {contactInitials(activeDetail?.name || "", activeDetail?.email || "")}
                  </div>
                  {/* Big centred name + category + Call / Email buttons, following the badge down as it
                      shrinks and fading out well before the header reaches its bar height (and, via the
                      data-fade flag onDetailScroll sets, no longer tappable once faded). The buttons sit
                      right above the profile card. */}
                  <div
                    className="absolute inset-x-4 text-center"
                    style={{
                      top: `calc(${MOBILE_BADGE_TOP_EXPANDED_PX + MOBILE_BADGE_EXPANDED_PX + 12}px - ${(MOBILE_BADGE_TOP_EXPANDED_PX - MOBILE_BADGE_TOP_COLLAPSED_PX) + (MOBILE_BADGE_EXPANDED_PX - MOBILE_BADGE_COLLAPSED_PX)}px * var(--p))`,
                      opacity: "max(0, calc(1 - var(--p) * 2))",
                    }}
                  >
                    <p className="truncate text-[22px] font-medium leading-tight" style={{ color: "var(--text-main)" }}>
                      {activeDetail?.name || (activeDetailLoading ? "Loading..." : "Contact")}
                    </p>
                    <div className="pointer-events-auto mt-1.5 flex justify-center [[data-fade='1']_&]:pointer-events-none">{categoryPill()}</div>
                    <div className="pointer-events-auto mt-3 flex items-center justify-center gap-3 [[data-fade='1']_&]:pointer-events-none">
                      <GlassActionMenu items={callItems} ariaLabel="Call" triggerClassName={mobileRoundButtonClass} menuMinWidth={300}>
                        <Phone size={18} />
                      </GlassActionMenu>
                      <GlassActionMenu items={textItems} ariaLabel="Text" triggerClassName={mobileRoundButtonClass} menuMinWidth={300}>
                        <MessageSquare size={18} />
                      </GlassActionMenu>
                      <GlassActionMenu items={emailItems} ariaLabel="Email" triggerClassName={mobileRoundButtonClass} menuMinWidth={320}>
                        <Mail size={18} />
                      </GlassActionMenu>
                    </div>
                  </div>
                  {/* The name, revealed as the badge slides away from over it: it sits in its final spot
                      beside the small badge, clipped at the badge's trailing edge. The clip's left inset
                      starts at where that edge is while the badge is still centred (half the viewport,
                      plus the badge's own half-width, minus the name's left) and eases to 0 over the same
                      220ms/ease-out as the badge's own slide, so the uncovered edge follows the badge. */}
                  <div
                    className="absolute inset-y-0 flex items-center motion-reduce:!transition-none"
                    style={{
                      left: MOBILE_NAME_LEFT_COLLAPSED_PX,
                      // Leaves room on the right for the 40px back button and its gutter.
                      right: MOBILE_NAME_RIGHT_COLLAPSED_PX,
                      height: MOBILE_HDR_COLLAPSED_PX,
                      clipPath: isMobileHeaderCollapsed
                        ? "inset(0 0 0 0px)"
                        : `inset(0 0 0 calc(50cqw + ${MOBILE_BADGE_COLLAPSED_PX / 2 - MOBILE_NAME_LEFT_COLLAPSED_PX}px))`,
                      opacity: isMobileHeaderCollapsed ? 1 : 0,
                      transition: "clip-path 220ms cubic-bezier(0, 0, 0.2, 1), opacity 160ms ease-out",
                    }}
                  >
                    <p className="truncate text-[17px] font-medium" style={{ color: "var(--text-main)" }}>
                      {activeDetail?.name || (activeDetailLoading ? "Loading..." : "Contact")}
                    </p>
                  </div>
                </div>

                <div
                  className="glass-scroll relative z-[1] min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 pt-[var(--mobile-hdr-h)] scroll-pt-16"
                  style={{
                    "--mobile-hdr-h": `${MOBILE_HDR_EXPANDED_PX}px`,
                    paddingBottom: "calc(16px + var(--keyboard-inset-px, 0px) + env(safe-area-inset-bottom, 0px))",
                  } as CSSProperties}
                  onScroll={onDetailScroll}
                >
                  {activeDetailLoading ? (
                    <div className="rounded-[14px] border p-4 text-[13px]" style={{ borderColor: "var(--glass-border)", backgroundColor: "var(--panel-bg)", color: "var(--text-muted)" }}>
                      Loading contact details...
                    </div>
                  ) : activeDetail ? (
                    // No minimum height: the page ends where its content ends, with no dead space under the last
                    // card / Archive button. (With only a little content the mobile header simply collapses as far
                    // as the available scroll allows.)
                    <div className="mx-auto w-full max-w-[1100px]">
                    <div className="grid w-full gap-4">
                      <div className="space-y-3">
                        {/* Each field is its own full-width container (Phone, Email, Address, Notes — with call /
                            email / maps buttons); Name and Category are already at the top of the page so they only
                            show while editing. */}
                        <div>
                          <p className="text-[12px] font-extrabold uppercase tracking-[0.8px] hidden" style={{ color: "var(--text-main)" }}>
                            Profile
                          </p>
                          <div className="flex flex-col gap-2">
                            <label className={`block text-[11px] font-bold ${mobileFieldCardClass} ${isEditingProfile ? "order-[-2]" : "!hidden"}`} style={{ color: "var(--text-muted)" }}>
                              Name
                              <input
                                defaultValue={activeDetail.name}
                                key={`${activeDetail.id}_name_${fieldsRev.name ?? 0}`}
                                onBlur={(e) => {
                                  if (e.target.value.trim() !== activeDetail.name) void saveActiveClientField({ name: e.target.value.trim() });
                                }}
                                readOnly={!isEditingProfile}
                                className={`${isEditingProfile ? fieldInputEditClass : fieldReadonlyClass} mt-1`}
                              />
                            </label>
                            <div className={`flex items-center gap-2 ${mobileFieldCardClass} order-2`}>
                              <label className="block min-w-0 flex-1 text-[11px] font-bold" style={{ color: "var(--text-muted)" }}>
                                Email
                                <input
                                  defaultValue={activeDetail.email}
                                  key={`${activeDetail.id}_email_${fieldsRev.email ?? 0}`}
                                  onBlur={(e) => {
                                    if (e.target.value.trim() !== activeDetail.email) void saveActiveClientField({ email: e.target.value.trim() });
                                  }}
                                  readOnly={!isEditingProfile}
                                  className={`${isEditingProfile ? fieldInputEditClass : `${fieldReadonlyClass} ${mobileReadonlyLineClass}`} mt-1`}
                                />
                              </label>
                              {/* Mobile only, and not while editing: email this contact (several addresses -> pick which). */}
                              {!isEditingProfile ? (
                                <div className="shrink-0">
                                  <GlassActionMenu items={emailItems} ariaLabel="Email" triggerClassName={mobileCompactRoundButtonClass} triggerStyle={containerIconButtonStyle} menuMinWidth={320}>
                                    <Mail size={16} />
                                  </GlassActionMenu>
                                </div>
                              ) : null}
                            </div>
                            <div className={`flex items-center gap-2 ${mobileFieldCardClass} order-1`}>
                              <label className="block min-w-0 flex-1 text-[11px] font-bold" style={{ color: "var(--text-muted)" }}>
                                Phone
                                <input
                                  defaultValue={activeDetail.phone}
                                  key={`${activeDetail.id}_phone_${fieldsRev.phone ?? 0}`}
                                  onBlur={(e) => {
                                    if (e.target.value.trim() !== activeDetail.phone) void saveActiveClientField({ phone: e.target.value.trim() });
                                  }}
                                  readOnly={!isEditingProfile}
                                  className={`${isEditingProfile ? fieldInputEditClass : `${fieldReadonlyClass} ${mobileReadonlyLineClass}`} mt-1`}
                                />
                              </label>
                              {/* Mobile only, and not while editing: call this contact (several numbers -> pick which,
                                  same glass menu as the header's). */}
                              {!isEditingProfile ? (
                                <div className="shrink-0">
                                  <GlassActionMenu items={callItems} ariaLabel="Call" triggerClassName={mobileCompactRoundButtonClass} triggerStyle={containerIconButtonStyle} menuMinWidth={300}>
                                    <Phone size={18} />
                                  </GlassActionMenu>
                                </div>
                              ) : null}
                            </div>
                            <div className={`flex items-center gap-2 ${mobileFieldCardClass} order-3`}>
                              <label className="block min-w-0 flex-1 text-[11px] font-bold" style={{ color: "var(--text-muted)" }}>
                                Address
                                <input
                                  defaultValue={activeDetail.address}
                                  key={`${activeDetail.id}_address_${fieldsRev.address ?? 0}`}
                                  onBlur={(e) => {
                                    if (e.target.value.trim() !== activeDetail.address) void saveActiveClientField({ address: e.target.value.trim() });
                                  }}
                                  readOnly={!isEditingProfile}
                                  className={`${isEditingProfile ? fieldInputEditClass : `${fieldReadonlyClass} ${mobileReadonlyLineClass}`} mt-1`}
                                />
                              </label>
                              {/* Mobile only, and not while editing: open the address in the phone's default maps app. */}
                              {!isEditingProfile ? (
                                <div className="shrink-0">
                                  <button
                                    type="button"
                                    onClick={() => openAddressInMaps(activeDetail.address)}
                                    disabled={!activeDetail.address.trim()}
                                    aria-label="Open address in Maps"
                                    style={containerIconButtonStyle}
                                    className={`${mobileCompactRoundButtonClass} disabled:opacity-40`}
                                  >
                                    <MapPin size={16} />
                                  </button>
                                </div>
                              ) : null}
                            </div>
                            <div className={`block text-[11px] font-bold ${mobileFieldCardClass} ${isEditingProfile ? "order-[-1]" : "!hidden"}`} style={{ color: "var(--text-muted)" }}>
                              Category
                              <div className="mt-1">
                                <GlassDropdown
                                  value={activeDetail.category || ""}
                                  options={buildCategoryOptions("Uncategorized", activeDetail.category)}
                                  onChange={(next) => void saveActiveClientField({ category: next })}
                                  ariaLabel="Contact category"
                                  disabled={!isEditingProfile}
                                  triggerClassName={`${isEditingProfile ? fieldInputEditClass : `${fieldReadonlyClass} disabled:!opacity-100`} justify-between`}
                                />
                              </div>
                            </div>
                            <label className={`block text-[11px] font-bold ${mobileFieldCardClass} order-4`} style={{ color: "var(--text-muted)" }}>
                              Notes
                              <textarea
                                defaultValue={activeDetail.notes}
                                key={`${activeDetail.id}_notes_${fieldsRev.notes ?? 0}`}
                                onBlur={(e) => {
                                  if (e.target.value.trim() !== activeDetail.notes) void saveActiveClientField({ notes: e.target.value.trim() });
                                }}
                                rows={isEditingProfile ? 3 : 2}
                                // Notes stay editable without pressing Edit (tap and type, saves on blur) but, outside Edit
                                // mode, show no box — not even on focus — so it just reads as an (empty) container.
                                className={`${isEditingProfile ? fieldInputEditClass : `${fieldReadonlyClass} cursor-text !mt-0 !px-0 !py-0`} mt-1 h-auto py-2 text-[14px] ${isEditingProfile ? "" : "resize-none"}`}
                              />
                            </label>
                            {saveError ? (
                              <p className="text-[12px] font-medium order-5" style={{ color: "var(--danger-strong)" }}>{saveError}</p>
                            ) : null}
                            {/* First / last project dates: shown in the desktop Profile card; removed on mobile. */}
                            <div className="space-y-1 pt-1 text-[12px] hidden" style={{ color: "var(--text-muted)" }}>
                              <p><span className="font-semibold" style={{ color: "var(--text-main)" }}>First Project:</span> {activeDetail.firstProjectAtIso ? formatClientDate(activeDetail.firstProjectAtIso) : "-"}</p>
                              <p><span className="font-semibold" style={{ color: "var(--text-main)" }}>Last Project:</span> {activeDetail.lastProjectAtIso ? formatClientDate(activeDetail.lastProjectAtIso) : "-"}</p>
                              <p><span className="font-semibold" style={{ color: "var(--text-main)" }}>Time Since Last Project:</span> {activeDetail.lastProjectAtIso ? timeSinceLabel(activeDetail.lastProjectAtIso) : "-"}</p>
                            </div>
                          </div>
                        </div>
                      </div>
                      {/* Active / Completed Projects aren't editable, so on mobile they step aside while editing. */}
                      <div className={`space-y-3 ${isEditingProfile ? "hidden" : ""}`}>
                        {([
                          { title: "Active Projects", rows: activeDetail.history.filter((h) => !isCompletedClientProjectStatus(h.statusLabel)), empty: "No active projects." },
                          { title: "Completed Projects", rows: activeDetail.history.filter((h) => isCompletedClientProjectStatus(h.statusLabel)), empty: "No completed projects." },
                        ] as const).map((section) => (
                          <div key={section.title} className="glass-card-mobile rounded-[14px] border border-[var(--glass-border)] bg-[var(--panel-bg)] p-4">
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
                                      className="glass-tint-row flex items-center justify-between rounded-[10px] border border-[var(--glass-border)] bg-[var(--panel-muted)] px-3 py-2 text-[12px] transition-colors"
                                      style={{ color: "var(--text-main)" }}
                                    >
                                      <div className="min-w-0">
                                        <p className="truncate font-semibold">{history.projectName}</p>
                                        <p className="truncate" style={{ color: "var(--text-muted)" }}>
                                          {history.statusLabel} | {formatClientDate(history.updatedAtIso || history.createdAtIso)}
                                        </p>
                                      </div>
                                      {/* The whole row is the link to the project, so there's no "Open" label; a project
                                          that no longer exists still says "Removed" (that row isn't a link). */}
                                      {canOpenProject ? null : (
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
                    {/* Archive: one big button at the very bottom of the page, only shown while editing (inline
                        display, so there's no utility-class tie to break). The first tap asks for confirmation
                        (the label becomes "Confirm Archive"), the second archives. Coloured like the project
                        page's Delete button (the danger gradient). */}
                    <div className="w-full pt-4" style={{ display: isEditingProfile ? undefined : "none" }}>
                      {isConfirmingArchive ? (
                        <p className="mb-2 text-center text-[12px] font-medium" style={{ color: "var(--danger-strong)" }}>
                          Remove this contact from the main list?
                        </p>
                      ) : null}
                      {archiveError ? (
                        <p className="mb-2 text-center text-[12px] font-medium" style={{ color: "var(--danger-strong)" }}>{archiveError}</p>
                      ) : null}
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
                        className="flex h-12 w-full items-center justify-center rounded-[14px] border text-[16px] font-medium text-white transition hover:brightness-95 disabled:opacity-60"
                        // Same red as the "Delete" button in the project details top bar (projects/[projectId]/page.tsx).
                        style={{ backgroundImage: "var(--danger-gradient)", borderColor: "var(--danger-strong)" }}
                      >
                        {isArchiving ? "Archiving..." : isConfirmingArchive ? "Confirm Archive" : "Archive"}
                      </button>
                    </div>
                    </div>
                  ) : (
                    <div className="rounded-[14px] border p-4 text-[13px]" style={{ borderColor: "var(--glass-border)", backgroundColor: "var(--panel-bg)", color: "var(--text-muted)" }}>
                      Couldn&apos;t load this contact.
                    </div>
                  )}
                </div>
              </Fragment>
            ) : null}
          </div>
        </div>
      )}

      {/* Long-press menu for a contact row (see rowLongPress). Same small glass pop-up as the Specifications
          long-press menu; portaled to <body> so the list's scroller can't clip it. */}
      {rowMenu && typeof document !== "undefined"
        ? createPortal(
            <div
              ref={rowMenuRef}
              className={`${rowMenuClosing ? "floating-bar-slot-pop" : "glass-bubble-pop"} fixed z-[2000] w-[220px] overflow-hidden rounded-[12px] border py-1.5`}
              style={{
                left: rowMenu.left,
                top: rowMenu.top,
                translate: rowMenu.openUp ? "0 -100%" : undefined,
                borderColor: "var(--glass-border)",
                backgroundColor: "var(--glass-bg-strong)",
                backdropFilter: "blur(24px) saturate(180%)",
                WebkitBackdropFilter: "blur(24px) saturate(180%)",
                boxShadow: "var(--shadow-glass)",
              }}
            >
              <p className="truncate px-4 pb-1 pt-1.5 text-[11px] font-medium" style={{ color: "var(--text-muted)" }}>
                {clients.find((c) => c.id === rowMenu.clientId)?.name || "Contact"}
              </p>
              <button
                type="button"
                disabled={rowMenuBusy}
                onClick={() => {
                  if (rowMenuConfirming) void handleArchiveFromRowMenu(rowMenu.clientId);
                  else setRowMenuConfirming(true);
                }}
                className="flex w-full items-center gap-2.5 whitespace-nowrap px-4 py-3 text-left text-[14px] font-medium disabled:opacity-60"
                style={{
                  color: "var(--danger-strong)",
                  WebkitTapHighlightColor: "transparent",
                  WebkitUserSelect: "none",
                  userSelect: "none",
                  WebkitTouchCallout: "none",
                }}
              >
                <Archive size={16} />
                {rowMenuBusy ? "Archiving..." : rowMenuConfirming ? "Tap again to archive" : "Archive"}
              </button>
              {rowMenuError ? (
                <p className="px-4 pb-1.5 text-[11px] font-medium" style={{ color: "var(--danger-strong)" }}>{rowMenuError}</p>
              ) : null}
            </div>,
            document.body,
          )
        : null}

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
              <div className="block text-[11px] font-bold" style={{ color: "var(--text-muted)" }}>
                Category
                <div className="mt-1">
                  <GlassDropdown
                    value={contactForm.category}
                    options={buildCategoryOptions("Uncategorized", contactForm.category)}
                    onChange={(next) => setContactForm((prev) => ({ ...prev, category: next }))}
                    ariaLabel="Contact category"
                    triggerClassName={`${fieldInputClass} justify-between`}
                  />
                </div>
              </div>
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
