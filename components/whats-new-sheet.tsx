"use client";

import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { createPortal } from "react-dom";
import Image from "next/image";
import Link from "next/link";
import {
  Archive,
  Bell,
  CalendarClock,
  CalendarDays,
  Check,
  FolderKanban,
  Globe,
  Hammer,
  LayoutDashboard,
  LockOpen,
  Settings,
  Sparkles,
  UserCog,
  Users,
  X,
  type LucideIcon,
} from "lucide-react";
import { authorizedFetch } from "@/lib/api-fetch";
import { updateNotesToDisplayHtml, type WhatsNewHighlight } from "@/lib/update-notes-utils";

// The What's New page: slides up over the whole screen (like Chrome's), showing a version's feature cards
// (highlights — a picture or a looping video each) and its changes, section by section. Everyone sees it
// once per version after it's published; Dev users also see a version that isn't published yet, with the
// controls to publish it — now, or at a set date and time (app/api/app-version/publish).

// Opening a draft's preview from elsewhere (the Changelog page), and telling pages a version was published.
export const OPEN_WHATS_NEW_DRAFT_EVENT = "cutsmart:open-whats-new-draft";
export const APP_VERSION_PUBLISHED_EVENT = "cutsmart:app-version-published";

const decodeEntities = (value: string) =>
  value.replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'");

// The notes split at their underlined bold headings ("<u><b>Calendar</b></u>").
function whatsNewSections(html: string): Array<{ title: string; body: string }> {
  const parts = String(html || "").split(/<u>\s*<b>([\s\S]*?)<\/b>\s*<\/u>/i);
  const sections: Array<{ title: string; body: string }> = [];
  if (parts[0]?.trim()) sections.push({ title: "", body: parts[0] });
  for (let i = 1; i < parts.length; i += 2) sections.push({ title: decodeEntities(parts[i] ?? "").trim(), body: parts[i + 1] ?? "" });
  return sections.filter((section) => section.title || section.body.trim());
}

// Each section's icon and its colour.
const SECTION_ICONS: Array<[RegExp, LucideIcon, string]> = [
  [/notification/i, Bell, "#3B82F6"],
  [/unlock/i, LockOpen, "#F59E0B"],
  [/archive|finished/i, Archive, "#64748B"],
  [/calendar/i, CalendarDays, "#22C55E"],
  [/client portal/i, Globe, "#8B5CF6"],
  [/lead|contact/i, Users, "#14B8A6"],
  [/dashboard|board/i, LayoutDashboard, "#6366F1"],
  [/company settings/i, Settings, "#78716C"],
  [/user settings/i, UserCog, "#EC4899"],
  [/project|production/i, Hammer, "#F97316"],
  [/app-wide|general/i, Sparkles, "#2563EB"],
];
const sectionIcon = (title: string): { Icon: LucideIcon; color: string } => {
  const match = SECTION_ICONS.find(([pattern]) => pattern.test(title));
  return match ? { Icon: match[1], color: match[2] } : { Icon: FolderKanban, color: "#2563EB" };
};

// The playful part: every card leans a little (alternating, never more than ~1.5°), pops in after the one
// before it, then bobs at its own pace — so nothing lines up like a grid.
const TILTS = [-1.3, 1, -0.6, 1.4, -1, 0.7, -1.5, 0.9];
// The space between the section cards' columns.
const SECTION_GAP_PX = 28;
function floatingStyle(index: number, startMs: number): CSSProperties {
  const delay = startMs + index * 90;
  const bobSeconds = 4.2 + (index % 4) * 0.65;
  return {
    animation: `whats-new-pop-in 700ms cubic-bezier(0.22, 1, 0.36, 1) ${delay}ms both, whats-new-bob ${bobSeconds}s ease-in-out ${delay + 700}ms infinite`,
    ["--wn-bob-y" as string]: `${-4 - (index % 3) * 1.5}px`,
  };
}
const tiltStyle = (index: number): CSSProperties => ({ ["--wn-tilt" as string]: `${TILTS[index % TILTS.length]}deg` });

// The feature cards' colours, in turn.
const ACCENTS = ["#3B82F6", "#EC4899", "#22C55E", "#F59E0B", "#8B5CF6", "#14B8A6"];

// Soft colour blobs drifting behind the cards.
const BLOBS: Array<{ className: string; color: string; seconds: number; x: number; y: number }> = [
  { className: "-left-24 top-16 h-96 w-96", color: "rgba(59, 130, 246, 0.30)", seconds: 18, x: 70, y: 50 },
  { className: "-right-24 top-[22%] h-[28rem] w-[28rem]", color: "rgba(236, 72, 153, 0.24)", seconds: 23, x: -60, y: 40 },
  { className: "bottom-0 left-[28%] h-80 w-80", color: "rgba(34, 197, 94, 0.22)", seconds: 20, x: 50, y: -50 },
  { className: "-bottom-24 -right-10 h-96 w-96", color: "rgba(245, 158, 11, 0.22)", seconds: 26, x: -50, y: -40 },
  { className: "left-[45%] top-[45%] h-72 w-72", color: "rgba(139, 92, 246, 0.20)", seconds: 29, x: -70, y: 30 },
];

// A soft glow of a card's colour behind it, breathing slowly.
function CardGlow({ color, index, strength = "55" }: { color: string; index: number; strength?: string }) {
  return (
    <div
      aria-hidden="true"
      className="whats-new-motion pointer-events-none absolute -inset-7 -z-10 rounded-[48px]"
      style={{
        background: `radial-gradient(closest-side, ${color}${strength}, transparent)`,
        animation: `whats-new-glow ${3.8 + (index % 3) * 0.9}s ease-in-out ${index * -0.7}s infinite`,
      }}
    />
  );
}

const formatDay = (iso: string) => {
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? "" : new Intl.DateTimeFormat(undefined, { day: "numeric", month: "long", year: "numeric" }).format(date);
};
const formatWhen = (iso: string) => {
  const date = new Date(iso);
  return Number.isNaN(date.getTime())
    ? ""
    : new Intl.DateTimeFormat(undefined, { weekday: "short", day: "numeric", month: "short", hour: "numeric", minute: "2-digit" }).format(date);
};

const cardStyle = {
  borderColor: "var(--glass-border)",
  backgroundColor: "var(--glass-bg-strong)",
  boxShadow: "var(--shadow-glass)",
} as const;
const mutedText = { color: "var(--text-muted)" } as const;

function HighlightMedia({ highlight }: { highlight: WhatsNewHighlight }) {
  const media = highlight.media;
  if (/\.(mp4|webm)(\?.*)?$/i.test(media)) {
    return <video src={media} autoPlay muted loop playsInline className="h-full w-full object-cover" aria-label={highlight.title} />;
  }
  if (media) {
    // A picture or GIF from public/ — any size, so a plain <img>.
    // eslint-disable-next-line @next/next/no-img-element
    return <img src={media} alt={highlight.title} className="h-full w-full object-cover" />;
  }
  return (
    <div className="flex h-full w-full items-center justify-center" style={mutedText}>
      <Sparkles size={34} />
    </div>
  );
}

// ---- A draft's publish controls (Dev users only)

type PublishStatus = {
  published: boolean;
  schedule: { scheduledForIso: string; notify: boolean; status: string; error?: string } | null;
  deploy: { onVercel: boolean; isLive: boolean; canPromote: boolean; blockedReason: string };
};

// This deploy's version: published or scheduled yet, and whether it can be published from here.
const fetchPublishStatus = (): Promise<PublishStatus | null> =>
  authorizedFetch("/api/app-version/publish")
    .then((res) => res.json())
    .then((json: PublishStatus & { ok?: boolean }) => (json?.ok ? json : null))
    .catch(() => null);

const PUBLISH_ERRORS: Record<string, string> = {
  "already-published": "This version is already published.",
  "vercel-not-configured": "Vercel isn't connected — add VERCEL_API_TOKEN in Vercel's environment variables.",
  "vercel-unreachable": "Couldn't reach Vercel to make this deploy live. Try again.",
  "not-dev": "Only dev users can publish.",
  "no-version": "This deploy's update notes have no version.",
};

function DraftPublishControls({
  version,
  onPublished,
  onLocalNotice,
}: {
  version: string;
  onPublished: () => void;
  // Why it can't be published here, when it's a local server ("" otherwise) — shown in the middle of the bar.
  onLocalNotice: (notice: string) => void;
}) {
  const [status, setStatus] = useState<PublishStatus | null>(null);
  const [scheduling, setScheduling] = useState(false);
  const [notify, setNotify] = useState(true);
  const [date, setDate] = useState("");
  const [time, setTime] = useState("09:00");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [done, setDone] = useState("");

  const loadStatus = () =>
    fetchPublishStatus().then((next) => {
      if (next) setStatus(next);
    });
  useEffect(() => {
    let cancelled = false;
    void fetchPublishStatus().then((next) => {
      if (cancelled || !next) return;
      setStatus(next);
      onLocalNotice(next.deploy.onVercel ? "" : next.deploy.blockedReason);
    });
    return () => {
      cancelled = true;
    };
  }, [onLocalNotice]);

  const send = async (body: Record<string, unknown>) => {
    setBusy(true);
    setError("");
    try {
      const res = await authorizedFetch("/api/app-version/publish", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const json = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string; message?: string; promoted?: boolean; notified?: number };
      if (!json.ok) {
        setError(json.message || PUBLISH_ERRORS[json.error || ""] || `Couldn't do that (${json.error || res.status}).`);
        return null;
      }
      return json;
    } catch {
      setError("Couldn't reach CutSmart. Try again.");
      return null;
    } finally {
      setBusy(false);
    }
  };

  const publishNow = async () => {
    const json = await send({ action: "publish", notify });
    if (!json) return;
    setDone(`Published${json.promoted ? " and live" : ""}${notify ? ` · ${json.notified ?? 0} notified` : ""}`);
    onPublished();
  };
  const schedule = async () => {
    if (!date || !time) {
      setError("Pick a date and a time.");
      return;
    }
    const json = await send({ action: "schedule", notify, scheduledForIso: new Date(`${date}T${time}`).toISOString() });
    if (json) void loadStatus();
  };
  const cancelSchedule = async () => {
    const json = await send({ action: "cancel" });
    if (json) void loadStatus();
  };

  const chip = "inline-flex h-9 items-center gap-1.5 rounded-[10px] border px-3 text-[12.5px] font-medium";
  const chipStyle = { borderColor: "var(--glass-border)", backgroundColor: "var(--panel-bg)", color: "var(--text-main)" } as const;
  const primary = "inline-flex h-9 items-center rounded-[10px] border px-4 text-[12.5px] font-semibold text-white disabled:opacity-55";
  const primaryStyle = { backgroundImage: "var(--brand-gradient)", borderColor: "var(--brand-strong)" } as const;
  const note = (text: string, tone: "muted" | "error" = "muted") => (
    <p className="max-w-[460px] text-right text-[11.5px] leading-snug" style={{ color: tone === "error" ? "var(--danger-strong)" : "var(--text-muted)" }}>
      {text}
    </p>
  );

  if (done) {
    return (
      <span className={chip} style={{ ...chipStyle, color: "var(--success-strong)" }}>
        <Check size={15} />
        {done}
      </span>
    );
  }
  if (status?.published) return <span className={chip} style={chipStyle}>Already published</span>;

  const scheduled = status?.schedule?.status === "scheduled" ? status.schedule : null;
  if (scheduled) {
    return (
      <div className="flex flex-col items-end gap-1">
        <div className="flex flex-wrap items-center justify-end gap-2">
          <span className={chip} style={chipStyle}>
            <CalendarClock size={15} />
            Publishes {formatWhen(scheduled.scheduledForIso)}
            {scheduled.notify ? " · notifies everyone" : ""}
          </span>
          <button type="button" disabled={busy} onClick={() => void cancelSchedule()} className={`${chip} disabled:opacity-55`} style={chipStyle}>
            Cancel
          </button>
        </div>
        {error ? note(error, "error") : null}
      </div>
    );
  }

  const blocked = status?.deploy.blockedReason || "";
  const failed = status?.schedule?.status === "failed" ? status.schedule : null;
  // A local server can't publish (greyed out, with a plain note); a staged deploy becomes the live site.
  const isLocal = Boolean(status && !status.deploy.onVercel);
  const info = status && status.deploy.onVercel && !status.deploy.isLive ? "Publishing makes this deploy the live site." : "";
  return (
    <div className="flex flex-col items-end gap-1">
      <div className="flex flex-wrap items-center justify-end gap-2">
        <label className={`${chip} cursor-pointer`} style={chipStyle}>
          <input type="checkbox" checked={notify} onChange={(e) => setNotify(e.target.checked)} className="h-3.5 w-3.5" />
          Notify everyone
        </label>
        <button
          type="button"
          onClick={() => setScheduling((prev) => !prev)}
          aria-pressed={scheduling}
          title={scheduling ? "Publish now instead" : "Publish on a date"}
          aria-label={scheduling ? "Publish now instead" : "Publish on a date"}
          className="inline-flex h-9 w-9 items-center justify-center rounded-[10px] border"
          style={scheduling ? { borderColor: "var(--brand-strong)", backgroundColor: "var(--brand-soft)", color: "var(--brand-strong)" } : chipStyle}
        >
          <CalendarClock size={16} />
        </button>
        {scheduling ? (
          <>
            <input type="date" value={date} onChange={(e) => setDate(e.target.value)} aria-label="Publish on" className="h-9 rounded-[10px] border px-2 text-[12.5px]" style={chipStyle} />
            <input type="time" value={time} onChange={(e) => setTime(e.target.value)} aria-label="Publish at" className="h-9 rounded-[10px] border px-2 text-[12.5px]" style={chipStyle} />
          </>
        ) : null}
        <button
          type="button"
          disabled={busy || !status || Boolean(blocked)}
          onClick={() => void (scheduling ? schedule() : publishNow())}
          className={primary}
          style={primaryStyle}
        >
          {busy ? "Working…" : scheduling ? "Schedule" : `Publish ${version}`}
        </button>
      </div>
      {error
        ? note(error, "error")
        : blocked && !isLocal
          ? note(blocked, "error")
          : failed
            ? note(`The scheduled publish didn't go through: ${PUBLISH_ERRORS[failed.error || ""] || failed.error}`, "error")
            : info
              ? note(info)
              : null}
    </div>
  );
}

// ---- The page

export function WhatsNewSheet({
  version,
  dateIso,
  whatsNew,
  highlights,
  draft,
  onClose,
  onPublished,
}: {
  version: string;
  // When it was published ("" for a draft).
  dateIso: string;
  whatsNew: string;
  highlights: WhatsNewHighlight[];
  // A Dev user's preview of a version that isn't published yet — with the controls to publish it.
  draft: boolean;
  // Once it has slid away.
  onClose: () => void;
  onPublished?: () => void;
}) {
  const [closing, setClosing] = useState(false);
  const close = () => setClosing(true);
  // A draft opened on a local server: it can't be published here (a red pill in the middle of the bar).
  const [localNotice, setLocalNotice] = useState("");
  // A modal <dialog>: above everything on the page whatever its z-index, and everything behind it can't be
  // clicked, dragged, scrolled or typed into until it's closed. Escape slides it away (see onCancel).
  const dialogRef = useRef<HTMLDialogElement | null>(null);
  useEffect(() => {
    const dialog = dialogRef.current;
    if (dialog && !dialog.open) {
      try {
        dialog.showModal();
      } catch {
        // Already open elsewhere — it still shows.
      }
    }
    return () => {
      if (dialog?.open) dialog.close();
    };
  }, []);

  // The section cards' columns: as many as fit at 320px or wider (measured as the page resizes). They're laid
  // out as separate stacks rather than CSS columns, which could split a card between two columns.
  const sectionsRef = useRef<HTMLDivElement | null>(null);
  const [sectionColumnCount, setSectionColumnCount] = useState(1);
  useEffect(() => {
    const el = sectionsRef.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(() => {
      setSectionColumnCount(Math.max(1, Math.floor((el.clientWidth + SECTION_GAP_PX) / (320 + SECTION_GAP_PX))));
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  if (typeof document === "undefined") return null;
  const sections = whatsNewSections(whatsNew);
  const published = formatDay(dateIso);

  // The section cards start popping in after the feature cards.
  const sectionsStartMs = 380 + highlights.length * 90;
  const renderSection = (section: { title: string; body: string }, index: number): ReactNode => {
    const { Icon, color } = sectionIcon(section.title);
    return (
      <div key={`${section.title}-${index}`} className="whats-new-motion pb-8 pt-7" style={floatingStyle(index, sectionsStartMs)}>
        <div className="relative isolate">
        <CardGlow color={color} index={index} strength="40" />
        <div className="whats-new-card relative rounded-[20px] border p-4 pt-7 md:p-5 md:pt-8" style={{ ...cardStyle, ...tiltStyle(index + 3), borderColor: `${color}55` }}>
          {section.title ? (
            <>
              <span
                className="absolute -top-5 left-5 inline-flex h-11 w-11 items-center justify-center rounded-[14px] text-white"
                style={{
                  backgroundColor: color,
                  boxShadow: `0 8px 20px ${color}66`,
                  transform: `rotate(${TILTS[(index + 5) % TILTS.length] * 4}deg)`,
                }}
              >
                <Icon size={20} />
              </span>
              <p className="mb-2 text-[15.5px] font-semibold" style={{ color: "var(--text-main)" }}>
                {section.title}
              </p>
            </>
          ) : null}
          <div
            className="notes-rich text-[13.5px] leading-6"
            style={{ color: "var(--text-main)" }}
            dangerouslySetInnerHTML={{ __html: updateNotesToDisplayHtml(decodeEntities(section.body.trim())) }}
          />
        </div>
        </div>
      </div>
    );
  };

  return createPortal(
    <dialog
      ref={dialogRef}
      aria-label={`What's new in CutSmart ${version}`}
      onCancel={(event) => {
        event.preventDefault();
        close();
      }}
      className="fixed inset-0 m-0 h-full max-h-none w-full max-w-none overflow-hidden border-0 bg-transparent p-0 backdrop:bg-transparent"
    >
      <button
        type="button"
        aria-label="Close what's new"
        onClick={close}
        className={`glass-modal-backdrop absolute inset-0 ${closing ? "animate-[whats-new-fade-out_300ms_ease_both]" : "animate-[whats-new-fade-in_300ms_ease_both]"}`}
      />
      <div
        onAnimationEnd={(event) => {
          if (closing && event.target === event.currentTarget) onClose();
        }}
        className={`absolute inset-0 overflow-hidden ${
          closing
            ? "animate-[whats-new-sheet-down_340ms_cubic-bezier(0.55,0,0.75,0.2)_both]"
            : "animate-[whats-new-sheet-up_560ms_cubic-bezier(0.22,1,0.36,1)_both]"
        } motion-reduce:animate-none`}
        style={{ backgroundColor: "var(--bg-app, var(--panel-bg))" }}
      >
        <div aria-hidden="true" className="pointer-events-none absolute inset-0 overflow-hidden">
          {BLOBS.map((blob, index) => (
            <div
              key={index}
              className={`whats-new-motion absolute rounded-full ${blob.className}`}
              style={{
                background: `radial-gradient(circle, ${blob.color}, transparent 70%)`,
                animation: `whats-new-drift ${blob.seconds}s ease-in-out ${index * -4}s infinite`,
                ["--wn-drift-x" as string]: `${blob.x}px`,
                ["--wn-drift-y" as string]: `${blob.y}px`,
              }}
            />
          ))}
        </div>
        <div className="relative h-full overflow-y-auto overscroll-contain">
          {/* Clear of a phone's notch / status bar — the page covers the whole screen. */}
          <div className="glass-page-header sticky top-0 z-[2]" style={{ paddingTop: "env(safe-area-inset-top, 0px)" }}>
            <div className="flex flex-wrap items-center gap-x-3 gap-y-2.5 px-4 py-3.5 md:flex-nowrap md:px-8">
              <div className="order-1 flex min-w-0 flex-1 items-center gap-3 md:flex-initial">
                {/* The main CutSmart app icon. */}
                <Image
                  src="/icon-192.png"
                  alt=""
                  width={44}
                  height={44}
                  className="h-11 w-11 shrink-0 rounded-[12px] border"
                  style={{ borderColor: "var(--glass-border)", boxShadow: "var(--shadow-sm)" }}
                />
                <div className="flex min-w-0 items-center gap-2.5">
                  <p className="truncate text-[20px] font-semibold leading-tight md:text-[22px]" style={{ color: "var(--text-main)" }}>
                    What&apos;s new in CutSmart
                  </p>
                  {/* The version (when it was published shows on hover). */}
                  <span
                    className="shrink-0 rounded-full border px-3.5 py-1.5 text-[14px] font-bold leading-none md:text-[15px]"
                    style={{ borderColor: "var(--brand-strong)", backgroundColor: "var(--brand-soft)", color: "var(--brand-strong)" }}
                    title={published ? `Published ${published}` : undefined}
                  >
                    {version}
                  </span>
                </div>
              </div>
              {draft && localNotice ? (
                <div className="order-3 flex min-w-0 basis-full justify-center md:order-2 md:mx-auto md:basis-auto">
                  <span
                    className="inline-flex items-center rounded-full border px-3.5 py-1 text-center text-[12px] font-semibold"
                    style={{ borderColor: "var(--danger-border)", backgroundColor: "var(--danger-soft)", color: "var(--danger-strong)" }}
                  >
                    {localNotice}
                  </span>
                </div>
              ) : null}
              {draft ? (
                <div className={`order-4 w-full md:order-3 md:w-auto ${localNotice ? "" : "md:ml-auto"}`}>
                  <DraftPublishControls version={version} onPublished={() => onPublished?.()} onLocalNotice={setLocalNotice} />
                </div>
              ) : null}
              <button
                type="button"
                onClick={close}
                className={`glass-nav-arrow order-2 inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-full md:order-4 ${draft ? "" : "md:ml-auto"}`}
                aria-label="Close"
              >
                <X size={18} />
              </button>
            </div>
          </div>

          <div className="space-y-8 px-5 pb-[max(28px,env(safe-area-inset-bottom))] pt-7 md:px-10">
            {highlights.length ? (
              <div className="grid grid-cols-[repeat(auto-fill,minmax(min(100%,320px),1fr))] gap-x-7 gap-y-8 md:[&>*:nth-child(3n+2)]:mt-7 md:[&>*:nth-child(3n+3)]:mt-3">
                {highlights.map((highlight, index) => {
                  const accent = ACCENTS[index % ACCENTS.length];
                  return (
                  <div key={`${highlight.title}-${index}`} className="whats-new-motion relative isolate" style={floatingStyle(index, 380)}>
                    <CardGlow color={accent} index={index} />
                    <span
                      aria-hidden="true"
                      className={`absolute -top-4 z-[1] inline-flex h-10 w-10 items-center justify-center rounded-full text-white ${index % 2 ? "-left-3" : "-right-3"}`}
                      style={{ backgroundColor: accent, boxShadow: `0 8px 18px ${accent}77`, transform: `rotate(${index % 2 ? -14 : 12}deg)` }}
                    >
                      <Sparkles size={18} />
                    </span>
                    <div className="whats-new-card overflow-hidden rounded-[22px] border" style={{ ...cardStyle, ...tiltStyle(index), borderColor: `${accent}66` }}>
                      <div className="aspect-[16/9] w-full overflow-hidden" style={{ backgroundColor: "var(--panel-muted)" }}>
                        <HighlightMedia highlight={highlight} />
                      </div>
                      <div className="p-4 md:p-5">
                        <p className="text-[16px] font-semibold" style={{ color: "var(--text-main)" }}>{highlight.title}</p>
                        {highlight.description ? <p className="mt-1 text-[13.5px] leading-6" style={mutedText}>{highlight.description}</p> : null}
                      </div>
                    </div>
                  </div>
                  );
                })}
              </div>
            ) : null}

            <div ref={sectionsRef} className="flex items-start" style={{ gap: SECTION_GAP_PX }}>
              {(() => {
                const stacks: Array<Array<{ section: { title: string; body: string }; index: number }>> = Array.from(
                  { length: sectionColumnCount },
                  () => [],
                );
                const heights = new Array<number>(sectionColumnCount).fill(0);
                sections.forEach((section, index) => {
                  const shortest = heights.indexOf(Math.min(...heights));
                  stacks[shortest].push({ section, index });
                  heights[shortest] += 260 + section.body.replace(/<[^>]*>/g, "").length;
                });
                return stacks.map((stack, column) => (
                  <div key={column} className="flex min-w-0 flex-1 flex-col">
                    {stack.map(({ section, index }) => renderSection(section, index))}
                  </div>
                ));
              })()}
            </div>

            <div className="flex flex-wrap items-center justify-between gap-3 border-t pt-4" style={{ borderColor: "var(--glass-border)" }}>
              <Link href="/changelog" onClick={close} className="text-[13px] font-medium" style={{ color: "var(--brand-strong)" }}>
                See every version
              </Link>
              <button
                type="button"
                onClick={close}
                className="h-11 rounded-[12px] border px-8 text-[14px] font-semibold text-white transition-transform duration-300 ease-[cubic-bezier(0.34,1.56,0.64,1)] hover:-rotate-2 hover:scale-105"
                style={{ backgroundImage: "var(--brand-gradient)", borderColor: "var(--brand-strong)" }}
              >
                Got it
              </button>
            </div>
          </div>
        </div>
      </div>
    </dialog>,
    document.body,
  );
}
