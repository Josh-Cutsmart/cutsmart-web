"use client";

import {
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type ComponentType,
  type CSSProperties,
  type MouseEvent as ReactMouseEvent,
  type RefObject,
  type TouchEvent as ReactTouchEvent,
} from "react";
import { createPortal } from "react-dom";
import { doc, getDoc, setDoc } from "firebase/firestore";
import { Bell, CalendarDays, ChevronLeft, ChevronRight, FolderKanban, Globe, Inbox, Plus, Search, Share, Sparkles, Timer, X, type LucideIcon } from "lucide-react";
import { db } from "@/lib/firebase";
import { GlassDropdown } from "@/components/glass-dropdown";
import { DevTestButton } from "@/components/dev-mode";
import { iconRemoveButtonClass } from "@/components/settings-ui";
import { captureGlassModalOrigin, useGlassModalPopOrigin, type GlassModalOrigin } from "@/lib/use-glass-modal-pop-origin";
import {
  ALL_DAY_EVENT_REMINDER_OPTIONS,
  CLIENT_PORTAL_PENDING_OPTIONS,
  isPushNotificationCategoryEnabled,
  isPushNotificationTypeEnabled,
  MAX_REMINDER_ROWS,
  normalizeCalendarReminderLead,
  normalizeClientPortalReminderDays,
  normalizePushQuietMinutes,
  PUSH_NOTIFICATION_CATEGORIES,
  PUSH_QUIET_INTERVAL_OPTIONS,
  TIMED_EVENT_REMINDER_OPTIONS,
  type CalendarReminderLead,
  type ClientPortalReminderDays,
  type PushNotificationCategory,
  type PushNotificationTypeOption,
  type ReminderLeadOption,
} from "@/lib/push-notification-types";
import { useDevModeOn } from "@/lib/dev-mode";
import {
  confirmPushDeviceStatus,
  disablePushOnThisDevice,
  enablePushOnThisDevice,
  readPushDeviceStatus,
  type PushDeviceStatus,
} from "@/lib/push-client";

// User Settings > Push Notifications: turn them on for this device (each device is turned on separately),
// the time between them, and which kinds to get — a row per category (with a switch for the whole
// category) that opens as a pop-up on a computer, or slides the page over to it on a phone (swipe right
// or Back to return, like a contact in Contacts), plus a search across every kind. Those choices are the
// user's own, stored on their profile (users/{uid}.pushNotificationTypes / pushNotificationCategories /
// calendarReminderLead / clientPortalReminderDays / pushQuietMinutes), and apply to all their devices.

// The small text under titles here — a stronger shade than the usual muted grey (closer to the main text,
// so darker in light mode and brighter in dark).
const SUB_TEXT_COLOR = "color-mix(in srgb, var(--text-main) 55%, var(--text-muted))";

// Phones (below md) slide the page over to a category; anything wider opens it as a pop-up.
const PHONE_QUERY = "(max-width: 767.98px)";
const subscribePhone = (onChange: () => void) => {
  const query = window.matchMedia(PHONE_QUERY);
  query.addEventListener("change", onChange);
  return () => query.removeEventListener("change", onChange);
};
const readPhone = () => window.matchMedia(PHONE_QUERY).matches;
// The same slide as Contacts' list -> contact page.
const SLIDE_CLASS = "transition-transform duration-[260ms] ease-[cubic-bezier(0.32,0.72,0,1)] motion-reduce:transition-none";
const SLIDE_TRANSITION = "transform 260ms cubic-bezier(0.32, 0.72, 0, 1)";

type ToggleProps = { checked: boolean; onChange: (checked: boolean) => void; disabled?: boolean };

// A list of reminder times (e.g. "1 day before", "1 hour before"): one dropdown per row, X to remove a
// row (there's always at least one), and + to add another (a choice not already in the list).
function ReminderTimesList({
  label,
  values,
  options,
  onChange,
}: {
  label: string;
  values: number[];
  options: readonly ReminderLeadOption[];
  onChange: (next: number[]) => void;
}) {
  const unused = options.filter((option) => !values.includes(option.value));
  return (
    <div className="block text-[11px] font-semibold" style={{ color: SUB_TEXT_COLOR }}>
      {label}
      <div className="mt-1 space-y-1.5">
        {values.map((value, index) => (
          <div key={`${value}_${index}`} className="flex items-center gap-1.5">
            <div className="min-w-0 flex-1">
              <GlassDropdown
                value={String(value)}
                // Its own choice, plus any not already used by another row.
                options={options
                  .filter((option) => option.value === value || !values.includes(option.value))
                  .map((option) => ({ value: String(option.value), label: option.label }))}
                onChange={(next) => onChange(values.map((v, i) => (i === index ? Number(next) : v)))}
                ariaLabel={`${label} reminder ${index + 1}`}
                triggerClassName="flex h-9 w-full items-center justify-between rounded-[9px] border px-3 text-[12px] font-medium"
                triggerStyle={{ borderColor: "var(--glass-border)", backgroundColor: "var(--panel-bg)", color: "var(--text-main)" }}
              />
            </div>
            <button
              type="button"
              disabled={values.length <= 1}
              onClick={() => onChange(values.filter((_, i) => i !== index))}
              className={iconRemoveButtonClass}
              aria-label={`Remove this ${label.toLowerCase()} reminder`}
              title="Remove"
            >
              <X size={16} />
            </button>
          </div>
        ))}
        {values.length < MAX_REMINDER_ROWS && unused.length ? (
          <button
            type="button"
            onClick={() => onChange([...values, unused[0].value])}
            className="inline-flex h-8 items-center gap-1 rounded-[9px] border px-2.5 text-[11.5px] font-semibold transition hover:brightness-95"
            style={{ borderColor: "var(--glass-border)", backgroundColor: "var(--panel-bg)", color: "var(--brand-strong)" }}
          >
            <Plus size={13} /> Add another
          </button>
        ) : null}
      </div>
    </div>
  );
}

// Why the switch can't be turned on here (its tooltip) — the card itself has no status text.
const UNAVAILABLE_REASON: Partial<Record<PushDeviceStatus, string>> = {
  blocked: "Notifications are blocked for CutSmart in this browser's or phone's settings — allow them there first.",
  unsupported: "This browser can't show notifications — try Chrome, Edge, Firefox or Safari.",
  unconfigured: "Notifications haven't been set up for CutSmart yet.",
};

// What was last shown — this device's status, and the user's choices — so the next time this opens (a
// phone's Notifications page opens fresh each time) it shows straight away, then catches up.
let lastDeviceStatus: PushDeviceStatus | null = null;
type SavedPushPrefs = {
  uid: string;
  choices: Record<string, unknown>;
  categoryChoices: Record<string, unknown>;
  reminderLead: CalendarReminderLead;
  pendingDays: ClientPortalReminderDays;
  quietMinutes: number;
};
let lastPrefs: SavedPushPrefs | null = null;
const lastPrefsFor = (uid: string) => (lastPrefs && lastPrefs.uid === uid ? lastPrefs : null);

// The phone ("rows") layout: cards of rows, and a category's page starts under User Settings' own bar
// (which stays put above it — the app's tab bar, then User Settings' 44px bar).
const ROWS_CARD_CLASS = "divide-y divide-[var(--glass-border)] overflow-hidden rounded-[18px] border";
const ROWS_PAGE_TOP_CLASS = "top-[92px]";

// The categories' icons in the phone layout's rows (and User Settings' search).
export const PUSH_CATEGORY_ICONS: Record<string, LucideIcon> = {
  projects: FolderKanban,
  leads: Inbox,
  client_portal: Globe,
  calendar: CalendarDays,
  cutsmart: Sparkles,
};

export function PushNotificationSettings({
  uid,
  cardStyle,
  Toggle,
  pageRef,
  layout = "card",
  initialSearch = "",
}: {
  uid: string;
  cardStyle: CSSProperties;
  Toggle: ComponentType<ToggleProps>;
  // The User Settings page itself — on a phone it slides away to the left as a category slides in.
  pageRef?: RefObject<HTMLDivElement | null>;
  // "card": one card with its own heading (a computer). "rows": User Settings' phone layout — cards of
  // rows (icon, name, its switch or setting), like the rest of the page there.
  layout?: "card" | "rows";
  // Opens already searched for this (e.g. a notification picked in User Settings' search).
  initialSearch?: string;
}) {
  const [status, setStatus] = useState<PushDeviceStatus | "loading">(() => lastDeviceStatus ?? "loading");
  const [busy, setBusy] = useState(false);
  // The user's choices below are shown once they've loaded (or straight away, as last seen).
  const [prefsLoaded, setPrefsLoaded] = useState(() => Boolean(lastPrefsFor(uid)));
  const [choices, setChoices] = useState<Record<string, unknown>>(() => lastPrefsFor(uid)?.choices ?? {});
  // Whole categories turned off (their kinds' own switches are kept, just overridden).
  const [categoryChoices, setCategoryChoices] = useState<Record<string, unknown>>(() => lastPrefsFor(uid)?.categoryChoices ?? {});
  const [search, setSearch] = useState(initialSearch);
  const [reminderLead, setReminderLead] = useState(() => lastPrefsFor(uid)?.reminderLead ?? normalizeCalendarReminderLead(null));
  // After how many days a quote / specifications still waiting on the client reminds them.
  const [pendingDays, setPendingDays] = useState(() => lastPrefsFor(uid)?.pendingDays ?? normalizeClientPortalReminderDays(null));
  // Time between notifications (users/{uid}.pushQuietMinutes — see lib/push-server.ts).
  const [quietMinutes, setQuietMinutes] = useState(() => lastPrefsFor(uid)?.quietMinutes ?? 0);

  // This device's own answer first (no waiting on the server), then the server's word on it in the
  // background — usually already known from when the app opened — correcting it if it disagrees.
  useEffect(() => {
    let cancelled = false;
    void readPushDeviceStatus().then((next) => {
      if (cancelled) return;
      setStatus(next);
      if (next !== "on") return;
      void confirmPushDeviceStatus().then((confirmed) => {
        if (!cancelled && confirmed) setStatus((prev) => (prev === "on" ? confirmed : prev));
      });
    });
    return () => {
      cancelled = true;
    };
  }, [uid]);
  useEffect(() => {
    if (status !== "loading") lastDeviceStatus = status;
  }, [status]);
  useEffect(() => {
    if (prefsLoaded && uid) lastPrefs = { uid, choices, categoryChoices, reminderLead, pendingDays, quietMinutes };
  }, [prefsLoaded, uid, choices, categoryChoices, reminderLead, pendingDays, quietMinutes]);

  useEffect(() => {
    if (!db || !uid) return;
    let cancelled = false;
    void getDoc(doc(db, "users", uid))
      .then((snap) => {
        if (cancelled) return;
        const saved = snap.data()?.pushNotificationTypes;
        setChoices(saved && typeof saved === "object" ? (saved as Record<string, unknown>) : {});
        const savedCategories = snap.data()?.pushNotificationCategories;
        setCategoryChoices(savedCategories && typeof savedCategories === "object" ? (savedCategories as Record<string, unknown>) : {});
        setReminderLead(normalizeCalendarReminderLead(snap.data()?.calendarReminderLead));
        setPendingDays(normalizeClientPortalReminderDays(snap.data()?.clientPortalReminderDays));
        setQuietMinutes(normalizePushQuietMinutes(snap.data()?.pushQuietMinutes));
        setPrefsLoaded(true);
      })
      .catch(() => {
        if (!cancelled) setPrefsLoaded(true);
      });
    return () => {
      cancelled = true;
    };
  }, [uid]);

  // Straight from the tap: turning it on asks the browser/phone for permission first thing.
  const onToggleDevice = async (next: boolean) => {
    if (busy) return;
    setBusy(true);
    try {
      if (next) {
        setStatus(await enablePushOnThisDevice());
      } else {
        await disablePushOnThisDevice();
        setStatus("off");
      }
    } finally {
      setBusy(false);
    }
  };

  const onToggleType = (type: string, enabled: boolean) => {
    setChoices((prev) => ({ ...prev, [type]: enabled }));
    if (db && uid) {
      void setDoc(doc(db, "users", uid), { pushNotificationTypes: { [type]: enabled } }, { merge: true }).catch(() => undefined);
    }
  };

  const onToggleCategory = (categoryId: string, enabled: boolean) => {
    setCategoryChoices((prev) => ({ ...prev, [categoryId]: enabled }));
    if (db && uid) {
      void setDoc(doc(db, "users", uid), { pushNotificationCategories: { [categoryId]: enabled } }, { merge: true }).catch(() => undefined);
    }
  };

  // Lists are saved whole (a removed row has to go), each under its own field.
  const onReminderLeadChange = (patch: Partial<CalendarReminderLead>) => {
    const next = { ...reminderLead, ...patch };
    setReminderLead(next);
    if (db && uid) void setDoc(doc(db, "users", uid), { calendarReminderLead: next }, { mergeFields: ["calendarReminderLead"] }).catch(() => undefined);
  };
  const onPendingDaysChange = (patch: Partial<ClientPortalReminderDays>) => {
    const next = { ...pendingDays, ...patch };
    setPendingDays(next);
    if (db && uid) void setDoc(doc(db, "users", uid), { clientPortalReminderDays: next }, { mergeFields: ["clientPortalReminderDays"] }).catch(() => undefined);
  };

  const onQuietMinutesChange = (minutes: number) => {
    setQuietMinutes(minutes);
    if (db && uid) void setDoc(doc(db, "users", uid), { pushQuietMinutes: minutes }, { merge: true }).catch(() => undefined);
  };

  const mutedText = { color: "var(--text-muted)" } as const;
  const subText = { color: SUB_TEXT_COLOR } as const;
  // Dev users with dev mode on (components/dev-mode.tsx) get "test" buttons on the rows.
  const devModeOn = useDevModeOn();

  const isPhone = useSyncExternalStore(subscribePhone, readPhone, () => false);
  // The category being shown (kept while it animates closed), and whether it's open.
  const [openCategoryId, setOpenCategoryId] = useState("");
  const [isCategoryOpen, setIsCategoryOpen] = useState(false);
  const closeTimerRef = useRef<number | null>(null);
  const openCategory = openCategoryId ? PUSH_NOTIFICATION_CATEGORIES.find((category) => category.id === openCategoryId) ?? null : null;

  // Computer: the pop-up grows out of the row that opened it.
  const [popOrigin, setPopOrigin] = useState<GlassModalOrigin>(null);
  const popPanelRef = useRef<HTMLDivElement | null>(null);
  const popOriginElRef = useRef<HTMLElement | null>(null);
  const shouldRenderPopup = useGlassModalPopOrigin(!isPhone && isCategoryOpen, popOrigin, popPanelRef, undefined, popOriginElRef);

  // Phone: the page slides left and the category's page slides in from the right; Back (and the phone's
  // own back gesture/button) returns — opening pushes a history entry for that.
  const panePref = useRef<HTMLDivElement | null>(null);
  const pushedEntryRef = useRef(false);
  const setPageSlide = (open: boolean, animate = true) => {
    const page = pageRef?.current;
    if (!page) return;
    page.style.transition = animate ? SLIDE_TRANSITION : "none";
    page.style.transform = open ? "translate3d(-100%, 0, 0)" : "";
  };

  const showCategory = (categoryId: string, event: ReactMouseEvent<HTMLElement>) => {
    if (closeTimerRef.current) {
      window.clearTimeout(closeTimerRef.current);
      closeTimerRef.current = null;
    }
    setOpenCategoryId(categoryId);
    if (isPhone) {
      window.history.pushState({ ...(window.history.state ?? {}), pushCategory: categoryId }, "");
      pushedEntryRef.current = true;
      // Next frame, so the pane mounts off-screen first and then slides.
      requestAnimationFrame(() => {
        setIsCategoryOpen(true);
        setPageSlide(true);
      });
    } else {
      popOriginElRef.current = event.currentTarget;
      setPopOrigin(captureGlassModalOrigin(event));
      setIsCategoryOpen(true);
    }
  };
  const finishClosing = () => {
    setIsCategoryOpen(false);
    setPageSlide(false);
    if (closeTimerRef.current) window.clearTimeout(closeTimerRef.current);
    closeTimerRef.current = window.setTimeout(() => {
      closeTimerRef.current = null;
      setOpenCategoryId("");
      if (pageRef?.current) pageRef.current.style.transition = "";
    }, 320);
  };
  const closeCategory = () => {
    if (isPhone && pushedEntryRef.current) {
      // Back through the entry opening it pushed — popstate (below) closes it.
      window.history.back();
      return;
    }
    finishClosing();
  };
  useEffect(() => {
    const onPopState = () => {
      if (!pushedEntryRef.current) return;
      pushedEntryRef.current = false;
      finishClosing();
    };
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
    // finishClosing only touches refs/setters.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  // Leaving the page with a category open puts the page back.
  useEffect(() => {
    const page = pageRef?.current;
    return () => {
      if (page) {
        page.style.transform = "";
        page.style.transition = "";
      }
    };
  }, [pageRef]);
  // Escape closes the pop-up.
  useEffect(() => {
    if (!isCategoryOpen || isPhone) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setIsCategoryOpen(false);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [isCategoryOpen, isPhone]);

  // Swipe right to go back (phone) — Contacts' own gesture: the pane and the page follow the finger;
  // past a third of the width, or a quick flick, finishes going back, otherwise it springs back.
  const swipeRef = useRef<{ x: number; y: number; t: number; width: number; axis: "" | "x" | "none"; dx: number } | null>(null);
  const setSwipeTransforms = (dx: number | null) => {
    const pane = panePref.current;
    const page = pageRef?.current;
    if (pane) pane.style.transform = dx === null ? "" : `translate3d(${dx}px, 0, 0)`;
    if (page) page.style.transform = dx === null ? "translate3d(-100%, 0, 0)" : `translate3d(calc(-100% + ${dx}px), 0, 0)`;
  };
  const setSwipeDragging = (dragging: boolean) => {
    const pane = panePref.current;
    const page = pageRef?.current;
    if (pane) pane.style.transition = dragging ? "none" : "";
    if (page) page.style.transition = dragging ? "none" : SLIDE_TRANSITION;
  };
  const onPaneTouchStart = (event: ReactTouchEvent<HTMLDivElement>) => {
    const touch = event.touches[0];
    if (!isCategoryOpen || !touch || event.touches.length > 1 || document.querySelector('[data-glass-dropdown-menu="true"]')) {
      swipeRef.current = null;
      return;
    }
    swipeRef.current = { x: touch.clientX, y: touch.clientY, t: performance.now(), width: window.innerWidth, axis: "", dx: 0 };
  };
  const onPaneTouchMove = (event: ReactTouchEvent<HTMLDivElement>) => {
    const swipe = swipeRef.current;
    const touch = event.touches[0];
    if (!swipe || !touch || swipe.axis === "none") return;
    const dx = touch.clientX - swipe.x;
    const dy = touch.clientY - swipe.y;
    if (!swipe.axis) {
      if (Math.abs(dx) < 8 && Math.abs(dy) < 8) return;
      swipe.axis = dx > 0 && Math.abs(dx) > Math.abs(dy) * 1.2 ? "x" : "none";
      if (swipe.axis !== "x") return;
      setSwipeDragging(true);
    }
    swipe.dx = Math.max(0, dx);
    setSwipeTransforms(swipe.dx);
  };
  const onPaneTouchEnd = (event: ReactTouchEvent<HTMLDivElement>) => {
    const swipe = swipeRef.current;
    swipeRef.current = null;
    if (!swipe || swipe.axis !== "x") return;
    const velocity = swipe.dx / Math.max(1, performance.now() - swipe.t);
    setSwipeDragging(false);
    void panePref.current?.offsetWidth;
    if (event.type !== "touchcancel" && (swipe.dx > swipe.width * 0.3 || (velocity > 0.5 && swipe.dx > 40))) {
      if (panePref.current) panePref.current.style.transform = "";
      closeCategory();
    } else {
      setSwipeTransforms(null);
    }
  };

  // One kind's row: its name and description, its switch (greyed out while its whole category is off),
  // and for reminders, how far ahead / after how long.
  const renderTypeRow = (option: PushNotificationTypeOption, categoryOn: boolean, categoryLabel?: string) => {
    const isOn = isPushNotificationTypeEnabled(choices, option.type);
    return (
      <div key={option.type} style={{ opacity: categoryOn ? 1 : 0.5 }}>
        <div className="flex items-center justify-between gap-3">
          <div className="min-w-0">
            {categoryLabel ? (
              <p className="text-[10.5px] font-bold uppercase tracking-[0.6px]" style={subText}>{categoryLabel}</p>
            ) : null}
            <p className="text-[13px] font-semibold" style={{ color: "var(--text-main)" }}>{option.label}</p>
            <p className="text-[11px]" style={subText}>{option.description}</p>
          </div>
          <div className="flex shrink-0 items-center gap-2.5">
            {devModeOn ? <DevTestButton sample={option.type} /> : null}
            <Toggle checked={isOn} onChange={(next) => onToggleType(option.type, next)} disabled={!categoryOn} />
          </div>
        </div>
        {option.type === "calendar_reminder" && isOn && categoryOn ? (
          // How far ahead, as many as they like: timed events by minutes to months, all-day events by days
          // to months.
          <div className="mt-2.5 grid gap-3 sm:grid-cols-2">
            <ReminderTimesList
              label="Timed events"
              values={reminderLead.timedMinutes}
              options={TIMED_EVENT_REMINDER_OPTIONS}
              onChange={(next) => onReminderLeadChange({ timedMinutes: next })}
            />
            <ReminderTimesList
              label="All-day events"
              values={reminderLead.allDayDays}
              options={ALL_DAY_EVENT_REMINDER_OPTIONS}
              onChange={(next) => onReminderLeadChange({ allDayDays: next })}
            />
          </div>
        ) : null}
        {(option.type === "quote_pending" || option.type === "specs_pending") && isOn && categoryOn ? (
          // After how many days still waiting, as many as they like.
          <div className="mt-2.5 sm:max-w-[50%]">
            <ReminderTimesList
              label="Remind me"
              values={option.type === "quote_pending" ? pendingDays.quote : pendingDays.specs}
              options={CLIENT_PORTAL_PENDING_OPTIONS}
              onChange={(next) => onPendingDaysChange(option.type === "quote_pending" ? { quote: next } : { specs: next })}
            />
          </div>
        ) : null}
      </div>
    );
  };
  // A category's kinds, in its pop-up / page.
  const renderCategoryBody = (category: PushNotificationCategory) => {
    const categoryOn = isPushNotificationCategoryEnabled(categoryChoices, category.id);
    return <div className="space-y-4">{category.types.map((option) => renderTypeRow(option, categoryOn))}</div>;
  };
  // The phone layout's category page: a title card (Back to Notifications, icon, name, the whole category's
  // switch), then its kinds.
  const renderCategoryRowsPage = (category: PushNotificationCategory) => {
    const categoryOn = isPushNotificationCategoryEnabled(categoryChoices, category.id);
    const Icon = PUSH_CATEGORY_ICONS[category.id] ?? Bell;
    return (
      <div className="space-y-4">
        <div className="flex items-center gap-3 rounded-[18px] border p-4" style={cardStyle}>
          <button
            type="button"
            onClick={closeCategory}
            className="glass-nav-arrow inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full"
            aria-label="Back"
          >
            <ChevronLeft size={18} />
          </button>
          <div
            className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-full"
            style={{ backgroundColor: "var(--panel-muted)", color: "var(--text-main)" }}
          >
            <Icon size={20} />
          </div>
          <p className="min-w-0 flex-1 truncate text-[20px] font-semibold leading-tight" style={{ color: "var(--text-main)" }}>{category.label}</p>
          <Toggle checked={categoryOn} onChange={(next) => onToggleCategory(category.id, next)} />
        </div>
        <div className={ROWS_CARD_CLASS} style={cardStyle}>
          {category.types.map((option) => (
            <div key={option.type} className="px-4 py-3">
              {renderTypeRow(option, categoryOn)}
            </div>
          ))}
        </div>
      </div>
    );
  };
  const query = search.trim().toLowerCase();
  const searchResults = query
    ? PUSH_NOTIFICATION_CATEGORIES.flatMap((category) =>
        category.types
          .filter((option) => `${option.label} ${option.description} ${category.label}`.toLowerCase().includes(query))
          .map((option) => ({ category, option })),
      )
    : [];

  // The category's pop-up (computer) or sliding page (phone) — in either layout.
  const overlays = (
    <>
      {/* Computer: the category as a pop-up. */}
      {shouldRenderPopup && openCategory && typeof document !== "undefined"
        ? createPortal(
            <div className="fixed inset-0 z-[9998] flex items-center justify-center p-4">
              <button type="button" aria-label="Close" onClick={() => setIsCategoryOpen(false)} className="glass-modal-backdrop absolute inset-0" />
              <div ref={popPanelRef} className="glass-modal-panel relative flex max-h-[min(640px,90vh)] w-full max-w-[520px] flex-col overflow-hidden">
                <div className="glass-modal-header flex h-[54px] shrink-0 items-center justify-between gap-3 px-4">
                  <div className="flex min-w-0 items-center gap-3">
                    <Toggle
                      checked={isPushNotificationCategoryEnabled(categoryChoices, openCategory.id)}
                      onChange={(next) => onToggleCategory(openCategory.id, next)}
                    />
                    <p className="truncate text-[15px] font-bold uppercase tracking-[1px]" style={{ color: "var(--text-main)" }}>{openCategory.label}</p>
                  </div>
                  <button type="button" onClick={() => setIsCategoryOpen(false)} className={iconRemoveButtonClass} aria-label="Close">
                    <X size={16} />
                  </button>
                </div>
                <div className="glass-scroll min-h-0 flex-1 overflow-y-auto p-4">{renderCategoryBody(openCategory)}</div>
              </div>
            </div>,
            document.body,
          )
        : null}

      {/* Phone: the category's own page, sliding in from the right (the settings page slides away left) — in the
          rows layout under User Settings' bar, which stays put. */}
      {isPhone && openCategory && typeof document !== "undefined"
        ? createPortal(
            <div
              ref={panePref}
              onTouchStart={onPaneTouchStart}
              onTouchMove={onPaneTouchMove}
              onTouchEnd={onPaneTouchEnd}
              onTouchCancel={onPaneTouchEnd}
              data-horizontal-swipe-scroll="true"
              className={`fixed inset-x-0 bottom-0 ${layout === "rows" ? ROWS_PAGE_TOP_CLASS : "top-12"} z-[30] flex touch-pan-y flex-col ${SLIDE_CLASS}`}
              style={{ transform: isCategoryOpen ? "translate3d(0, 0, 0)" : "translate3d(100%, 0, 0)", backgroundColor: "var(--bg-app, var(--panel-bg))" }}
            >
              {layout === "rows" ? null : (
                <div className="glass-page-header flex h-[44px] shrink-0 items-center justify-between gap-3 px-4">
                  <div className="flex min-w-0 items-center gap-2.5">
                    <Toggle
                      checked={isPushNotificationCategoryEnabled(categoryChoices, openCategory.id)}
                      onChange={(next) => onToggleCategory(openCategory.id, next)}
                    />
                    <p className="truncate text-[14px] font-medium uppercase tracking-[1px]" style={{ color: "var(--text-main)" }}>{openCategory.label}</p>
                  </div>
                  <button
                    type="button"
                    onClick={closeCategory}
                    className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-[10px] border hover:brightness-95"
                    style={{ backgroundImage: "var(--brand-gradient)", borderColor: "var(--brand-strong)" }}
                    aria-label="Back"
                  >
                    <ChevronLeft size={18} color="#ffffff" strokeWidth={2.5} />
                  </button>
                </div>
              )}
              <div
                className="min-h-0 flex-1 overflow-y-auto px-4 py-4"
                style={{ paddingBottom: "max(16px, env(safe-area-inset-bottom, 0px))" }}
              >
                {layout === "rows" ? renderCategoryRowsPage(openCategory) : renderCategoryBody(openCategory)}
              </div>
            </div>,
            document.body,
          )
        : null}
    </>
  );

  // What's under the switch shows once it's on and the user's choices are in (so they don't flip after).
  const showChoices = status === "on" && (prefsLoaded || !db || !uid);
  const deviceToggle =
    status === "needs-install" ? null : (
      <span title={status !== "on" && status !== "off" && status !== "loading" ? UNAVAILABLE_REASON[status] : undefined}>
        <Toggle
          checked={status === "on"}
          onChange={(next) => void onToggleDevice(next)}
          disabled={busy || (status !== "on" && status !== "off")}
        />
      </span>
    );
  const renderInstallSteps = (className: string) => (
    <ol className={`list-decimal space-y-1 rounded-[12px] border py-3 pl-8 pr-3 text-[12px] ${className}`} style={{ borderColor: "var(--glass-border)", backgroundColor: "var(--panel-muted)", color: "var(--text-main)" }}>
      <li>
        In Safari, tap <Share size={12} className="inline align-[-1px]" /> <b>Share</b>, then <b>Add to Home Screen</b>.
      </li>
      <li>Open CutSmart from your Home Screen.</li>
      <li>Come back to User Settings there and turn this on.</li>
    </ol>
  );
  const devGroupTests = devModeOn ? (
    <>
      <DevTestButton sample="group_same" />
      <DevTestButton sample="group_mixed" label="test mix" />
    </>
  ) : null;
  const quietDropdown = (
    <GlassDropdown
      value={String(quietMinutes)}
      options={PUSH_QUIET_INTERVAL_OPTIONS.map((o) => ({ value: String(o.value), label: o.label }))}
      onChange={(next) => onQuietMinutesChange(Number(next))}
      ariaLabel="Time between notifications"
      triggerClassName="flex h-9 w-full items-center justify-between rounded-[9px] border px-3 text-[12px] font-medium"
      triggerStyle={{ borderColor: "var(--glass-border)", backgroundColor: "var(--panel-bg)", color: "var(--text-main)" }}
    />
  );
  const renderSearchBar = (className: string, style: CSSProperties) => (
    <label className={`flex items-center gap-2 border px-3 ${className}`} style={style}>
      <Search size={14} className="shrink-0" style={mutedText} />
      <input
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        placeholder="Search notifications"
        className="h-8 w-full min-w-0 bg-transparent text-[12.5px] outline-none"
        style={{ color: "var(--text-main)" }}
      />
      {search ? (
        <button type="button" onClick={() => setSearch("")} aria-label="Clear search" className="shrink-0" style={mutedText}>
          <X size={14} />
        </button>
      ) : null}
    </label>
  );
  const renderSearchResults = (className: string, style: CSSProperties) =>
    searchResults.length ? (
      <div className={`space-y-4 border ${className}`} style={style}>
        {searchResults.map(({ category, option }) =>
          renderTypeRow(option, isPushNotificationCategoryEnabled(categoryChoices, category.id), category.label),
        )}
      </div>
    ) : (
      <p className="px-1 py-3 text-[12px]" style={subText}>No notifications match.</p>
    );

  // Phone (User Settings' sections): cards of rows, like the rest of the page there.
  if (layout === "rows") {
    const rowClass = "flex min-h-[52px] items-center gap-3 px-4 py-2.5";
    return (
      <div className="space-y-4">
        {showChoices ? renderSearchBar("h-10 rounded-[12px]", cardStyle) : null}
        <div className={ROWS_CARD_CLASS} style={cardStyle}>
          <div className={rowClass}>
            <Bell size={17} className="shrink-0" style={mutedText} />
            <p className="min-w-0 flex-1 truncate text-[14px] font-medium" style={{ color: "var(--text-main)" }}>Push Notifications</p>
            {deviceToggle}
          </div>
          {showChoices ? (
            <div className={rowClass}>
              <Timer size={17} className="shrink-0" style={mutedText} />
              <div className="min-w-0 flex-1">
                <p className="text-[14px] font-medium leading-tight" style={{ color: "var(--text-main)" }}>Time between notifications</p>
                {devGroupTests ? <div className="mt-1 flex flex-wrap gap-2">{devGroupTests}</div> : null}
              </div>
              <div className="w-[150px] shrink-0">{quietDropdown}</div>
            </div>
          ) : null}
        </div>
        {status === "needs-install" ? renderInstallSteps("") : null}
        {showChoices ? (
          <>
            {query ? (
              renderSearchResults("rounded-[18px] p-4", cardStyle)
            ) : (
              <div className={ROWS_CARD_CLASS} style={cardStyle}>
                {PUSH_NOTIFICATION_CATEGORIES.map((category) => {
                  const categoryOn = isPushNotificationCategoryEnabled(categoryChoices, category.id);
                  const Icon = PUSH_CATEGORY_ICONS[category.id] ?? Bell;
                  return (
                    <div key={category.id} className="flex min-h-[52px] items-center gap-3 px-4">
                      <button
                        type="button"
                        onClick={(e) => showCategory(category.id, e)}
                        className="flex min-w-0 flex-1 items-center gap-3 self-stretch text-left"
                      >
                        <Icon size={17} className="shrink-0" style={mutedText} />
                        <span className="min-w-0 flex-1 truncate text-[14px] font-medium" style={{ color: "var(--text-main)", opacity: categoryOn ? 1 : 0.55 }}>
                          {category.label}
                        </span>
                        <ChevronRight size={16} className="shrink-0" style={mutedText} />
                      </button>
                      <Toggle checked={categoryOn} onChange={(next) => onToggleCategory(category.id, next)} />
                    </div>
                  );
                })}
              </div>
            )}
          </>
        ) : null}
        {overlays}
      </div>
    );
  }

  return (
    <div className="rounded-[18px] border p-5" style={cardStyle}>
      <div className="flex items-center justify-between gap-3">
        <h3 className="text-[15px] font-extrabold uppercase tracking-[1px]" style={{ color: "var(--text-main)" }}>
          Push Notifications
        </h3>
        {deviceToggle}
      </div>

      {status === "needs-install" ? renderInstallSteps("mt-3") : null}

      {showChoices ? (
        <>
          <div className="mt-4 border-t pt-4" style={{ borderColor: "var(--glass-border)" }}>
            <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
              <div className="flex min-w-0 flex-1 flex-wrap items-center gap-x-2.5 gap-y-1">
                <p className="text-[13px] font-semibold" style={{ color: "var(--text-main)" }}>Time between notifications</p>
                {devGroupTests}
              </div>
              <div className="w-[190px] shrink-0">{quietDropdown}</div>
            </div>
            {renderSearchBar("mb-3 h-9 rounded-[10px]", { borderColor: "var(--glass-border)", backgroundColor: "var(--panel-bg)" })}
            {query ? (
              renderSearchResults("rounded-[12px] p-3", { borderColor: "var(--glass-border)", backgroundColor: "var(--panel-muted)" })
            ) : (
              <div className="space-y-1.5">
                {PUSH_NOTIFICATION_CATEGORIES.map((category) => {
                  const categoryOn = isPushNotificationCategoryEnabled(categoryChoices, category.id);
                  return (
                    <div
                      key={category.id}
                      className="flex items-center gap-3 rounded-[12px] border px-3 py-2.5"
                      style={{ borderColor: "var(--glass-border)", backgroundColor: "var(--panel-muted)" }}
                    >
                      <button
                        type="button"
                        onClick={(e) => showCategory(category.id, e)}
                        className="flex min-w-0 flex-1 items-center justify-between gap-2 text-left"
                      >
                        <span className="truncate text-[13px] font-semibold" style={{ color: "var(--text-main)", opacity: categoryOn ? 1 : 0.55 }}>
                          {category.label}
                        </span>
                        <ChevronRight size={15} className="shrink-0" style={mutedText} />
                      </button>
                      <Toggle checked={categoryOn} onChange={(next) => onToggleCategory(category.id, next)} />
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </>
      ) : null}

      {overlays}
    </div>
  );
}
