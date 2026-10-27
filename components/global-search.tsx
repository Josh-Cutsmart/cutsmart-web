"use client";

// The app's global search: a glass bar that drops down from the top of the screen (on a phone, the whole screen) —
// Ctrl/⌘+K anywhere, or the top bar's search button (GLOBAL_SEARCH_OPEN_EVENT). What's typed finds projects, small
// jobs, leads, contacts, calendar events and pages (the sidebar's, User Settings, Company Settings' sections and the
// settings in them) — only what this person can see (lib/global-search.ts) — in groups, best first. Arrow keys move,
// Enter opens, Esc closes. With nothing typed: what they opened from it lately.

import { useCallback, useEffect, useMemo, useRef, useState, type ComponentType } from "react";
import { createPortal } from "react-dom";
import { useRouter } from "next/navigation";
import { CalendarDays, FolderKanban, Hammer, Inbox, Search, Settings, UserRound, Users, X } from "lucide-react";
import { useAuth } from "@/lib/auth-context";
import { useCompanyAccess } from "@/lib/use-company-access";
import { SETTINGS_SEARCH_INDEX, SETTINGS_SECTIONS } from "@/lib/company-settings-sections";
import { SMALL_JOB_COLOR } from "@/lib/small-jobs";
import {
  GLOBAL_SEARCH_KINDS,
  GLOBAL_SEARCH_OPEN_EVENT,
  OPEN_LEAD_EVENT,
  loadGlobalSearchItems,
  normalizeSearchText,
  readRecentSearchItems,
  rememberRecentSearchItem,
  searchGlobalItems,
  type GlobalSearchItem,
  type GlobalSearchKind,
} from "@/lib/global-search";

type IconType = ComponentType<{ size?: number; strokeWidth?: number; className?: string; style?: React.CSSProperties }>;

export type GlobalSearchPage = { href: string; label: string; group: string; icon: IconType };

const KIND_META: Record<GlobalSearchKind, { label: string; icon: IconType; color: string }> = {
  project: { label: "Projects", icon: FolderKanban, color: "var(--brand)" },
  smalljob: { label: "Small Jobs", icon: Hammer, color: SMALL_JOB_COLOR },
  lead: { label: "Leads", icon: Inbox, color: "#8B5CF6" },
  contact: { label: "Contacts", icon: Users, color: "#0EA5E9" },
  event: { label: "Events", icon: CalendarDays, color: "#16A34A" },
  page: { label: "Pages", icon: Settings, color: "var(--text-muted)" },
};
// How many of a group show before its "Show all".
const GROUP_LIMIT = 5;
// What's been loaded is reused for this long before it's quietly loaded again on opening.
const REUSE_MS = 60 * 1000;

// What was found last time, for whom (kept for the session — opening it again shows it straight away).
let cachedIndex: { key: string; at: number; items: GlobalSearchItem[] } | null = null;

const itemKey = (item: { kind: string; id: string }) => `${item.kind}:${item.id}`;

export function GlobalSearch({ pages, canOpenSettings }: { pages: GlobalSearchPage[]; canOpenSettings: boolean }) {
  const router = useRouter();
  const { user } = useAuth();
  const access = useCompanyAccess();
  const uid = String(user?.uid || "").trim();
  const companyId = String(access.companyId || "").trim();
  const viewerKey = `${uid}|${companyId}|${access.role}|${access.roleId || ""}|${access.permissionKeys.join(",")}`;

  // mounted: on the page (sliding up as it closes); shown: slid down.
  const [mounted, setMounted] = useState(false);
  const [shown, setShown] = useState(false);
  const [query, setQuery] = useState("");
  const [items, setItems] = useState<GlobalSearchItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [recentKeys, setRecentKeys] = useState<string[]>([]);
  const [activeKey, setActiveKey] = useState("");
  const [expanded, setExpanded] = useState<Partial<Record<GlobalSearchKind, boolean>>>({});
  const inputRef = useRef<HTMLInputElement | null>(null);
  const listRef = useRef<HTMLDivElement | null>(null);
  const closeTimerRef = useRef<number | null>(null);
  const loadRunRef = useRef(0);

  // The pages it can find: the sidebar's (only those this person has — app-shell passes them), User Settings, and
  // with Company Settings, its sections and the settings in them.
  const iconByKey = useMemo(() => {
    const map = new Map<string, IconType>();
    for (const page of pages) map.set(page.href, page.icon);
    for (const section of SETTINGS_SECTIONS) map.set(`settings:${section.key}`, section.icon as IconType);
    map.set("/user-settings", UserRound);
    return map;
  }, [pages]);
  const pageItems = useMemo<GlobalSearchItem[]>(() => {
    const out: GlobalSearchItem[] = pages.map((page, i) => ({
      kind: "page",
      id: page.href,
      title: page.label,
      subtitle: page.group,
      href: page.href,
      icon: page.href,
      titleText: normalizeSearchText(page.label),
      otherText: normalizeSearchText(page.group),
      rank: -i,
    }));
    out.push({
      kind: "page",
      id: "/user-settings",
      title: "User Settings",
      subtitle: "Your profile",
      href: "/user-settings",
      icon: "/user-settings",
      titleText: normalizeSearchText("User Settings"),
      otherText: normalizeSearchText("profile account password notifications theme dark light mode pin"),
      rank: -100,
    });
    if (canOpenSettings) {
      SETTINGS_SECTIONS.forEach((section, i) =>
        out.push({
          kind: "page",
          id: `settings:${section.key}`,
          title: section.label,
          subtitle: "Company Settings",
          href: `/company-settings?section=${section.key}`,
          icon: `settings:${section.key}`,
          titleText: normalizeSearchText(section.label),
          otherText: normalizeSearchText(`company settings ${section.group} ${section.description}`),
          rank: -200 - i,
        }),
      );
      SETTINGS_SEARCH_INDEX.forEach((entry, i) => {
        const sectionLabel = SETTINGS_SECTIONS.find((s) => s.key === entry.section)?.label ?? "";
        out.push({
          kind: "page",
          id: `settings:${entry.section}:${entry.label}`,
          title: entry.label,
          subtitle: `Company Settings › ${sectionLabel}`,
          href: `/company-settings?section=${entry.section}&card=${encodeURIComponent(entry.card)}`,
          icon: `settings:${entry.section}`,
          titleText: normalizeSearchText(entry.label),
          otherText: normalizeSearchText(`company settings ${sectionLabel} ${entry.card} ${entry.keywords ?? ""}`),
          rank: -300 - i,
        });
      });
    }
    return out;
  }, [canOpenSettings, pages]);

  // Loads (again) what this person can find, a kind at a time.
  const loadingForRef = useRef("");
  const startLoad = useCallback(() => {
    if (access.status !== "ready" || !uid || !companyId) return;
    if (cachedIndex && cachedIndex.key === viewerKey && Date.now() - cachedIndex.at < REUSE_MS) return;
    // (Already loading for this person.)
    if (loadingForRef.current === viewerKey) return;
    loadingForRef.current = viewerKey;
    const run = ++loadRunRef.current;
    setLoading(true);
    let next: GlobalSearchItem[] = cachedIndex?.key === viewerKey ? cachedIndex.items : [];
    void loadGlobalSearchItems(
      { uid, companyId, role: access.role, roleId: access.roleId, permissionKeys: access.permissionKeys },
      (kinds, found) => {
        if (run !== loadRunRef.current) return;
        next = [...next.filter((item) => !kinds.includes(item.kind)), ...found];
        cachedIndex = { key: viewerKey, at: Date.now(), items: next };
        setItems(next);
      },
    ).finally(() => {
      if (loadingForRef.current === viewerKey) loadingForRef.current = "";
      if (run === loadRunRef.current) setLoading(false);
    });
  }, [access.permissionKeys, access.role, access.roleId, access.status, companyId, uid, viewerKey]);
  // Opened before this person's access was known: loaded as soon as it is.
  useEffect(() => {
    if (!mounted || access.status !== "ready") return;
    const frame = window.requestAnimationFrame(startLoad);
    return () => window.cancelAnimationFrame(frame);
  }, [access.status, mounted, startLoad]);

  const open = useCallback(() => {
    if (closeTimerRef.current) window.clearTimeout(closeTimerRef.current);
    // What was typed last time stays (selected, so typing over it starts afresh); its results show again.
    setExpanded({});
    setActiveKey("");
    setRecentKeys(readRecentSearchItems(uid).map(itemKey));
    setItems(cachedIndex?.key === viewerKey ? cachedIndex.items : []);
    setMounted(true);
    startLoad();
    window.requestAnimationFrame(() =>
      window.requestAnimationFrame(() => {
        setShown(true);
        inputRef.current?.focus({ preventScroll: true });
        inputRef.current?.select();
      }),
    );
  }, [startLoad, uid, viewerKey]);
  const close = useCallback(() => {
    setShown(false);
    if (closeTimerRef.current) window.clearTimeout(closeTimerRef.current);
    closeTimerRef.current = window.setTimeout(() => setMounted(false), 280);
  }, []);
  // (The listeners below are added once; they reach the latest open / close through these.)
  const openRef = useRef(open);
  const closeRef = useRef(close);
  const mountedRef = useRef(mounted);
  useEffect(() => {
    openRef.current = open;
    closeRef.current = close;
    mountedRef.current = mounted && shown;
  });

  // Ctrl/⌘+K anywhere (not inside a notes editor, where it's its own — a link), and the top bar's button. Esc closes it
  // whatever has the focus while it's open (caught first, so nothing on the page under it acts on it too).
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && mountedRef.current) {
        event.preventDefault();
        event.stopPropagation();
        closeRef.current();
        return;
      }
      if (!(event.ctrlKey || event.metaKey) || event.altKey || event.shiftKey || event.key.toLowerCase() !== "k") return;
      const target = event.target as HTMLElement | null;
      if (target?.closest?.('[contenteditable="true"]')) return;
      event.preventDefault();
      if (mountedRef.current) closeRef.current();
      else openRef.current();
    };
    const onOpenEvent = () => openRef.current();
    window.addEventListener("keydown", onKeyDown, true);
    window.addEventListener(GLOBAL_SEARCH_OPEN_EVENT, onOpenEvent);
    return () => {
      window.removeEventListener("keydown", onKeyDown, true);
      window.removeEventListener(GLOBAL_SEARCH_OPEN_EVENT, onOpenEvent);
    };
  }, []);
  useEffect(
    () => () => {
      if (closeTimerRef.current) window.clearTimeout(closeTimerRef.current);
    },
    [],
  );

  // What shows: the groups found for what's typed — or, with nothing typed, what was opened from it lately (still
  // there to find: something no longer theirs to see isn't offered).
  const everything = useMemo(() => [...items, ...pageItems], [items, pageItems]);
  const groups = useMemo<Array<{ kind: GlobalSearchKind | "recent"; rows: GlobalSearchItem[]; total: number }>>(() => {
    if (!query.trim()) {
      const byKey = new Map(everything.map((item) => [itemKey(item), item] as const));
      const recent = recentKeys.map((key) => byKey.get(key)).filter((item): item is GlobalSearchItem => Boolean(item));
      return recent.length ? [{ kind: "recent", rows: recent, total: recent.length }] : [];
    }
    const found = searchGlobalItems(everything, query);
    return GLOBAL_SEARCH_KINDS.filter((kind) => found.get(kind)?.length).map((kind) => {
      const all = found.get(kind) ?? [];
      return { kind, rows: expanded[kind] ? all : all.slice(0, GROUP_LIMIT), total: all.length };
    });
  }, [everything, expanded, query, recentKeys]);
  const rows = useMemo(() => groups.flatMap((group) => group.rows), [groups]);
  const currentKey = rows.some((row) => itemKey(row) === activeKey) ? activeKey : rows[0] ? itemKey(rows[0]) : "";

  // The highlighted row kept in view as the arrow keys move it.
  useEffect(() => {
    if (!currentKey) return;
    listRef.current?.querySelector<HTMLElement>(`[data-search-row="${CSS.escape(currentKey)}"]`)?.scrollIntoView({ block: "nearest" });
  }, [currentKey]);

  const openItem = (item: GlobalSearchItem) => {
    rememberRecentSearchItem(uid, item);
    close();
    router.push(item.href);
    // The Leads page already open: it opens the lead itself (?lead= is read as it opens).
    if (item.kind === "lead") window.setTimeout(() => window.dispatchEvent(new CustomEvent(OPEN_LEAD_EVENT, { detail: item.id })), 0);
  };

  const onInputKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      if (!rows.length) return;
      const at = Math.max(0, rows.findIndex((row) => itemKey(row) === currentKey));
      const next = event.key === "ArrowDown" ? Math.min(rows.length - 1, at + 1) : Math.max(0, at - 1);
      setActiveKey(itemKey(rows[next]));
      return;
    }
    if (event.key === "Enter") {
      const item = rows.find((row) => itemKey(row) === currentKey);
      if (item) {
        event.preventDefault();
        openItem(item);
      }
    }
  };

  if (!mounted || typeof document === "undefined") return null;
  const isMac = typeof navigator !== "undefined" && /mac|iphone|ipad/i.test(navigator.platform || navigator.userAgent);

  return createPortal(
    <div className="fixed inset-0" style={{ zIndex: 2147483600 }} role="presentation">
      <button
        type="button"
        aria-label="Close search"
        onClick={close}
        className="glass-modal-backdrop absolute inset-0 transition-opacity duration-200"
        style={{ opacity: shown ? 1 : 0 }}
      />
      {/* Drops down from the very top of the screen, its top square to it (on a phone: the whole screen does). */}
      <div
        className="pointer-events-none absolute inset-x-0 top-0 flex justify-center px-4 transition-transform duration-300 ease-[cubic-bezier(0.22,1,0.36,1)] motion-reduce:transition-none max-sm:bottom-0 max-sm:p-0"
        style={{ transform: shown ? "translateY(0)" : "translateY(calc(-100% - 24px))" }}
      >
        <div
          role="dialog"
          aria-modal="true"
          aria-label="Search"
          className="glass-modal-panel pointer-events-auto relative flex w-full max-w-[680px] flex-col overflow-hidden"
          style={{ maxHeight: "min(640px, calc(100dvh - 12px))", borderTopLeftRadius: 0, borderTopRightRadius: 0, borderTopWidth: 0 }}
        >
          <div className="flex h-[56px] shrink-0 items-center gap-3 border-b px-4" style={{ borderColor: "var(--glass-border)" }}>
            <Search size={18} className="shrink-0" style={{ color: "var(--text-main)" }} />
            <input
              ref={inputRef}
              value={query}
              onChange={(event) => {
                setQuery(event.target.value);
                setExpanded({});
                setActiveKey("");
              }}
              onKeyDown={onInputKeyDown}
              placeholder="Search projects, leads, contacts, events…"
              aria-label="Search"
              autoComplete="off"
              spellCheck={false}
              className="min-w-0 flex-1 bg-transparent text-[15px] font-medium outline-none placeholder:font-normal placeholder:text-[var(--text-muted)] max-sm:text-[16px]"
              style={{ color: "var(--text-main)" }}
            />
            {/* Clears what's typed (the box keeps its cursor). */}
            {query ? (
              <button
                type="button"
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => {
                  setQuery("");
                  setExpanded({});
                  setActiveKey("");
                  inputRef.current?.focus({ preventScroll: true });
                }}
                aria-label="Clear search"
                title="Clear"
                className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full transition hover:brightness-95"
                style={{ backgroundColor: "color-mix(in srgb, var(--text-main) 10%, transparent)", color: "var(--text-main)" }}
              >
                <X size={13} strokeWidth={2.5} />
              </button>
            ) : null}
            {loading ? (
              <span
                aria-hidden="true"
                className="h-4 w-4 shrink-0 animate-spin rounded-full border-2"
                style={{ borderColor: "color-mix(in srgb, var(--text-muted) 30%, transparent)", borderTopColor: "var(--brand)" }}
              />
            ) : null}
            <kbd
              className="shrink-0 rounded-[6px] border px-1.5 py-0.5 text-[10.5px] font-semibold max-sm:hidden"
              style={{ borderColor: "var(--glass-border)", color: "var(--text-main)" }}
            >
              Esc
            </kbd>
            <button
              type="button"
              onClick={close}
              aria-label="Close search"
              className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full transition hover:bg-[var(--danger-soft)] hover:text-[var(--danger)] sm:hidden"
              style={{ color: "var(--text-main)" }}
            >
              <X size={20} />
            </button>
          </div>

          <div ref={listRef} className="glass-scroll min-h-0 flex-1 overflow-y-auto px-2 pb-2 pt-1 max-sm:pb-6">
            {groups.map((group) => {
              const meta = group.kind === "recent" ? null : KIND_META[group.kind];
              const HeadingIcon = meta?.icon;
              return (
                <div key={group.kind} className="pt-2">
                  <p className="flex items-center gap-1.5 px-3 pb-1 text-[11px] font-bold uppercase tracking-[0.8px]" style={{ color: "var(--text-main)" }}>
                    {HeadingIcon ? <HeadingIcon size={13} /> : null}
                    {meta ? meta.label : "Recent"}
                    {meta ? <span className="font-semibold normal-case tracking-normal">· {group.total}</span> : null}
                    {/* A line on from its name (and count) to the end of the row — as the sidebar's section names. */}
                    <span
                      aria-hidden="true"
                      className="ml-1.5 h-px min-w-0 flex-1"
                      style={{ backgroundColor: "color-mix(in srgb, var(--text-main) 22%, transparent)" }}
                    />
                  </p>
                  {group.rows.map((item) => {
                    const key = itemKey(item);
                    const active = key === currentKey;
                    const kindMeta = KIND_META[item.kind];
                    const RowIcon = (item.icon && iconByKey.get(item.icon)) || kindMeta.icon;
                    const tint = item.color || kindMeta.color;
                    return (
                      <button
                        key={key}
                        type="button"
                        data-search-row={key}
                        onMouseMove={() => {
                          if (!active) setActiveKey(key);
                        }}
                        onClick={() => openItem(item)}
                        className={`flex w-full items-center gap-3 rounded-[12px] px-3 py-2 text-left transition-colors max-sm:py-2.5 ${active ? "nav-active-glass" : ""}`}
                      >
                        <span
                          className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-[10px]"
                          style={{ backgroundColor: `color-mix(in srgb, ${tint} 16%, transparent)`, color: tint }}
                        >
                          <RowIcon size={16} />
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-[13.5px] font-medium" style={{ color: "var(--text-main)" }}>
                            {item.title}
                          </span>
                          {item.subtitle ? (
                            <span className="block truncate text-[12px]" style={{ color: "var(--text-main)" }}>
                              {group.kind === "recent" ? `${kindMeta.label.replace(/s$/, "")} · ${item.subtitle}` : item.subtitle}
                            </span>
                          ) : group.kind === "recent" ? (
                            <span className="block truncate text-[12px]" style={{ color: "var(--text-main)" }}>
                              {kindMeta.label.replace(/s$/, "")}
                            </span>
                          ) : null}
                        </span>
                        {item.badge ? (
                          <span
                            className="max-w-[40%] shrink-0 truncate rounded-full px-2 py-0.5 text-[11px] font-semibold"
                            style={{ backgroundColor: "color-mix(in srgb, var(--text-main) 6%, transparent)", color: "var(--text-main)" }}
                          >
                            {item.badge}
                          </span>
                        ) : null}
                      </button>
                    );
                  })}
                  {group.kind !== "recent" && group.total > group.rows.length ? (
                    <button
                      type="button"
                      onClick={() => setExpanded((prev) => ({ ...prev, [group.kind]: true }))}
                      className="ml-3 mt-0.5 rounded-full px-2 py-1 text-[12px] font-semibold transition hover:bg-[color-mix(in_srgb,var(--text-main)_6%,transparent)]"
                      style={{ color: "var(--text-main)" }}
                    >
                      Show all {group.total}
                    </button>
                  ) : null}
                </div>
              );
            })}
            {!groups.length ? (
              <p className="px-4 py-8 text-center text-[13px]" style={{ color: "var(--text-main)" }}>
                {query.trim()
                  ? loading
                    ? "Searching…"
                    : `Nothing matches “${query.trim()}”.`
                  : "Search projects, small jobs, leads, contacts, events and pages."}
              </p>
            ) : null}
          </div>

          <div
            className="flex shrink-0 items-center gap-4 border-t px-4 py-2 text-[11px] font-medium max-sm:hidden"
            style={{ borderColor: "var(--glass-border)", color: "var(--text-main)" }}
          >
            <span>↑ ↓ to move</span>
            <span>Enter to open</span>
            <span>Esc to close</span>
            <span className="flex-1" />
            <span>{isMac ? "⌘" : "Ctrl"}+K</span>
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}
