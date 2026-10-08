"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { Bell, CalendarDays, LayoutGrid, ListChecks, Receipt, Share2, SquareKanban, Target } from "lucide-react";

// The login screen's feature slider (desktop): a drawing of each part of CutSmart with a short line
// about it, moving on every SLIDE_MS. Each drawing plays when its slide comes up: anything marked
// data-at="<ms>" is switched on (data-on) that long after, and off again at data-until; a
// data-count element counts up to its number. Hovering pauses it (login-screen.css).

const SLIDE_MS = 6000;

type Slide = { key: string; label: string; icon: ReactNode; title: string; text: string; art: ReactNode };

const T = { fontSize: 11 } as const;
const PART_TEXT = "rgba(17,24,39,0.65)";

function BoardCard({ x, y, name, dot }: { x: number; y: number; name: string; dot: string }) {
  return (
    <g transform={`translate(${x},${y})`}>
      <rect width="80" height="40" rx="7" fill="var(--lg-card)" stroke="var(--lg-line)" />
      <text x="9" y="17" {...T} fill="var(--lg-ink)">{name}</text>
      <rect x="9" y="25" width="30" height="5" rx="2.5" fill="var(--lg-skel)" />
      <circle cx="68" cy="29" r="5" fill={dot} />
    </g>
  );
}

function DashboardArt() {
  return (
    <svg viewBox="0 0 320 200" role="img" aria-label="A job card dragged across the Quote, Build and Install columns">
      {[8, 112, 216].map((x) => (
        <rect key={x} x={x} y="8" width="96" height="184" rx="10" fill="var(--lg-sunk)" />
      ))}
      <rect x="16" y="16" width="46" height="18" rx="9" fill="var(--lg-blue-bg)" />
      <text x="39" y="29" textAnchor="middle" {...T} fill="var(--lg-blue-fg)">Quote</text>
      <rect x="120" y="16" width="42" height="18" rx="9" fill="var(--lg-purple-bg)" />
      <text x="141" y="29" textAnchor="middle" {...T} fill="var(--lg-purple-fg)">Build</text>
      <rect x="224" y="16" width="48" height="18" rx="9" fill="var(--lg-teal-bg)" />
      <text x="248" y="29" textAnchor="middle" {...T} fill="var(--lg-teal-fg)">Install</text>
      <BoardCard x={16} y={90} name="Bayview" dot="#B7A4EB" />
      <BoardCard x={120} y={42} name="Harper" dot="#C6E8AE" />
      <BoardCard x={120} y={90} name="Lee" dot="#B8D8F8" />
      <BoardCard x={224} y={42} name="Patel" dot="#F2D57A" />
      <g className="lg-kanban-move">
        <g transform="translate(16,42)">
          <rect width="80" height="40" rx="7" fill="var(--lg-card)" stroke="var(--brand)" strokeWidth="1.5" />
          <rect x="0" y="7" width="3" height="26" rx="1.5" fill="var(--brand)" />
          <text x="10" y="17" {...T} fill="var(--lg-ink)">J. Smith</text>
          <rect x="10" y="25" width="30" height="5" rx="2.5" fill="var(--lg-skel)" />
          <circle cx="68" cy="29" r="5" fill="#F2D57A" />
        </g>
      </g>
    </svg>
  );
}

const NEST_PARTS = [
  { x: 10, y: 10, w: 106, h: 72, fill: "#C6E8AE", label: "Side" },
  { x: 119, y: 10, w: 72, h: 98, fill: "#F2D57A", label: "Door" },
  { x: 10, y: 85, w: 106, h: 81, fill: "#C6E8AE", label: "Side" },
  { x: 194, y: 10, w: 54, h: 98, fill: "#F2D57A", label: "Door" },
  { x: 119, y: 111, w: 72, h: 55, fill: "#B8D8F8", label: "Drawer" },
  { x: 251, y: 10, w: 59, h: 58, fill: "#B7A4EB", label: "Shelf" },
  { x: 194, y: 111, w: 116, h: 55, fill: "#B8D8F8", label: "Drawer" },
  { x: 251, y: 71, w: 59, h: 37, fill: "#B7A4EB", label: "Rail" },
];

function NestingArt() {
  return (
    <svg viewBox="0 0 320 200" role="img" aria-label="Parts being nested onto a board">
      <rect x="6" y="6" width="308" height="164" rx="5" fill="var(--lg-sheet)" stroke="var(--lg-sheet-line)" />
      {NEST_PARTS.map((part, index) => (
        <g key={index} className="lg-sq lg-drop" data-at={300 + index * 350}>
          <rect x={part.x} y={part.y} width={part.w} height={part.h} rx="2" fill={part.fill} stroke="rgba(15,23,42,0.18)" />
          <text x={part.x + part.w / 2} y={part.y + part.h / 2 + 4} textAnchor="middle" {...T} fill={PART_TEXT}>
            {part.label}
          </text>
        </g>
      ))}
      <text x="8" y="190" {...T} fill="var(--lg-muted)">Sheet 1 of 3 · 16mm white</text>
      <rect x="196" y="184" width="86" height="6" rx="3" fill="var(--lg-faint)" />
      <rect className="lg-sq lg-wipe" data-at="300" style={{ transitionDuration: "2.8s" }} x="196" y="184" width="74" height="6" rx="3" fill="var(--brand)" />
      <text x="314" y="190" textAnchor="end" {...T} fill="var(--lg-ink)" data-at="300" data-count="86" data-suffix="%" data-dur="2800">86%</text>
    </svg>
  );
}

const CUT_ROWS = [
  { name: "Base side", color: "#C6E8AE", l: 720, w: 560, q: 2 },
  { name: "Shelf", color: "#B7A4EB", l: 764, w: 540, q: 3 },
  { name: "Door", color: "#F2D57A", l: 715, w: 397, q: 4 },
  { name: "Drawer front", color: "#B8D8F8", l: 764, w: 180, q: 3 },
  { name: "Back", color: "#C6E8AE", l: 740, w: 720, q: 1 },
];

function CutlistArt() {
  return (
    <svg viewBox="0 0 320 200" role="img" aria-label="A cutlist with parts being ticked off">
      <rect x="6" y="6" width="308" height="24" rx="7" fill="var(--lg-sunk)" />
      <text x="18" y="22" {...T} fill="var(--lg-muted)">Part</text>
      <text x="170" y="22" {...T} fill="var(--lg-muted)">Length</text>
      <text x="222" y="22" {...T} fill="var(--lg-muted)">Width</text>
      <text x="266" y="22" {...T} fill="var(--lg-muted)">Qty</text>
      {CUT_ROWS.map((row, index) => {
        const y = 36 + index * 32;
        const at = 400 + index * 600;
        return (
          <g key={row.name}>
            <rect x="6" y={y} width="308" height="28" rx="7" fill="var(--lg-card)" stroke="var(--lg-faint)" />
            <rect className="lg-sq" data-at={at} x="6" y={y} width="308" height="28" rx="7" fill="var(--lg-done-bg)" />
            <rect x="16" y={y + 9} width="10" height="10" rx="2" fill={row.color} />
            <text x="32" y={y + 18} fontSize="12" fill="var(--lg-ink)">{row.name}</text>
            <text x="170" y={y + 18} fontSize="12" fill="var(--lg-sub)">{row.l}</text>
            <text x="222" y={y + 18} fontSize="12" fill="var(--lg-sub)">{row.w}</text>
            <text x="266" y={y + 18} fontSize="12" fill="var(--lg-sub)">{row.q}</text>
            <g className="lg-sq lg-pop" data-at={at}>
              <circle cx="298" cy={y + 14} r="9" fill="#17B3A3" />
              <path d={`M293.5 ${y + 14.5}l3 3 5.5-6`} stroke="#fff" strokeWidth="2" fill="none" strokeLinecap="round" strokeLinejoin="round" />
            </g>
          </g>
        );
      })}
    </svg>
  );
}

const CAL_EVENTS = [
  { x: 41, y: 36, h: 40, bg: "var(--lg-blue-ev)", fg: "var(--lg-blue-fg)", a: "Measure" },
  { x: 97, y: 60, h: 64, bg: "var(--lg-teal-ev)", fg: "var(--lg-teal-fg)", a: "Install", b: "Smith" },
  { x: 153, y: 36, h: 150, bg: "var(--lg-amber-ev)", fg: "var(--lg-amber-fg)", a: "Install", b: "Bayview" },
  { x: 209, y: 96, h: 44, bg: "var(--lg-purple-ev)", fg: "var(--lg-purple-fg)", a: "Site visit" },
  { x: 265, y: 44, h: 56, bg: "var(--lg-blue-ev)", fg: "var(--lg-blue-fg)", a: "Delivery" },
  { x: 41, y: 120, h: 48, bg: "var(--lg-purple-ev)", fg: "var(--lg-purple-fg)", a: "Review" },
  { x: 209, y: 150, h: 32, bg: "var(--lg-teal-ev)", fg: "var(--lg-teal-fg)", a: "Fit-off" },
];

function CalendarArt() {
  return (
    <svg viewBox="0 0 320 200" role="img" aria-label="A week calendar filling with events">
      {["Mon", "Tue", "Wed", "Thu", "Fri"].map((day, index) => (
        <g key={day}>
          <text x={66 + index * 56} y="18" textAnchor="middle" {...T} fill="var(--lg-muted)">{day}</text>
          <rect x={40 + index * 56} y="26" width="52" height="168" rx="6" fill="var(--lg-sunk)" />
        </g>
      ))}
      {[36, 72, 108, 144, 180].map((y, index) => (
        <g key={y}>
          <line x1="36" y1={y} x2="316" y2={y} stroke="var(--lg-faint)" />
          <text x="32" y={y + 4} textAnchor="end" {...T} fill="var(--lg-muted)">{["8", "10", "12", "2", "4"][index]}</text>
        </g>
      ))}
      {CAL_EVENTS.map((event, index) => (
        <g key={index} className="lg-sq lg-grow" data-at={300 + index * 400}>
          <rect x={event.x} y={event.y} width="50" height={event.h} rx="6" fill={event.bg} />
          <text x={event.x + 5} y={event.y + 15} {...T} fill={event.fg}>{event.a}</text>
          {event.b ? (
            <text x={event.x + 5} y={event.y + 29} {...T} fill={event.fg} opacity="0.75">{event.b}</text>
          ) : null}
        </g>
      ))}
    </svg>
  );
}

const LEAD_STAGES = [
  { x: 40, label: "New", at: 200, until: 1300, w: 40, bg: "var(--lg-blue-bg)", fg: "var(--lg-blue-fg)" },
  { x: 120, label: "Contacted", at: 1300, until: 2400, w: 70, bg: "var(--lg-amber-bg)", fg: "var(--lg-amber-fg)" },
  { x: 200, label: "Quoted", at: 2400, until: 3500, w: 56, bg: "var(--lg-purple-bg)", fg: "var(--lg-purple-fg)" },
  { x: 280, label: "Won", at: 3500, until: 0, w: 44, bg: "var(--lg-teal-bg)", fg: "var(--lg-teal-fg)" },
];

function LeadsArt() {
  return (
    <svg viewBox="0 0 320 200" role="img" aria-label="A lead moving from New to Won">
      <rect x="40" y="38" width="240" height="4" rx="2" fill="var(--lg-faint)" />
      {LEAD_STAGES.slice(1).map((stage, index) => (
        <rect
          key={stage.label}
          className="lg-sq lg-wipe"
          data-at={stage.at - 600}
          style={{ transitionDuration: "0.6s" }}
          x={40 + index * 80}
          y="38"
          width="80"
          height="4"
          rx="2"
          fill={index === 2 ? "#17B3A3" : "var(--brand)"}
        />
      ))}
      {LEAD_STAGES.map((stage, index) => (
        <g key={stage.label}>
          <circle className={index === 3 ? "lg-lead-dot lg-lead-dot-won" : "lg-lead-dot"} data-at={stage.at} cx={stage.x} cy="40" r="9" />
          <text x={stage.x} y="66" textAnchor="middle" {...T} fill="var(--lg-muted)">{stage.label}</text>
        </g>
      ))}
      <rect x="40" y="84" width="240" height="98" rx="12" fill="var(--lg-card)" stroke="var(--lg-line)" />
      <circle cx="72" cy="116" r="16" fill="var(--lg-blue-bg)" />
      <text x="72" y="120" textAnchor="middle" fontSize="12" fill="var(--lg-blue-fg)">AW</text>
      <text x="98" y="112" fontSize="13" fill="var(--lg-ink)">Aroha Williams</text>
      <text x="98" y="129" {...T} fill="var(--lg-muted)">Kitchen renovation · Ponsonby</text>
      <text x="266" y="112" textAnchor="end" fontSize="12" fill="var(--lg-ink)">$18,900</text>
      {LEAD_STAGES.map((stage, index) => (
        <g key={stage.label} className={index === 3 ? "lg-sq lg-pop" : "lg-sq"} data-at={stage.at} data-until={stage.until || undefined}>
          <rect x="98" y="144" width={stage.w} height="20" rx="10" fill={stage.bg} />
          <text x={98 + stage.w / 2} y="158" textAnchor="middle" {...T} fill={stage.fg}>{stage.label}</text>
        </g>
      ))}
    </svg>
  );
}

const QUOTE_LINES = [
  { label: "Cabinetry", amount: "$8,240" },
  { label: "Benchtop", amount: "$3,150" },
  { label: "Hardware", amount: "$640" },
  { label: "Install", amount: "$450" },
];

function QuoteArt() {
  return (
    <svg viewBox="0 0 320 200" role="img" aria-label="A quote adding up and getting approved">
      <rect x="40" y="6" width="240" height="188" rx="10" fill="var(--lg-card)" stroke="var(--lg-line)" />
      <text x="58" y="32" fontSize="14" fill="var(--lg-ink)">Quote Q-1042</text>
      <text x="58" y="48" {...T} fill="var(--lg-muted)">Henderson laundry</text>
      {QUOTE_LINES.map((line, index) => {
        const y = 78 + index * 24;
        return (
          <g key={line.label} className="lg-sq lg-down" data-at={300 + index * 400}>
            <text x="58" y={y} fontSize="12" fill="var(--lg-sub)">{line.label}</text>
            <text x="262" y={y} textAnchor="end" fontSize="12" fill="var(--lg-sub)">{line.amount}</text>
            {index < 3 ? <line x1="58" y1={y + 8} x2="262" y2={y + 8} stroke="var(--lg-faint)" /> : null}
          </g>
        );
      })}
      <line x1="58" y1="160" x2="262" y2="160" stroke="var(--lg-line)" />
      <text x="58" y="182" fontSize="12" fill="var(--lg-muted)">Total</text>
      <text x="262" y="183" textAnchor="end" fontSize="18" fontWeight="500" fill="var(--lg-ink)" data-at="1900" data-count="12480" data-prefix="$" data-dur="1000">
        $12,480
      </text>
      <g transform="translate(222,36) rotate(-10)">
        <g className="lg-sq lg-pop" data-at="3000">
          <rect x="-38" y="-13" width="76" height="26" rx="6" fill="var(--lg-done-bg)" stroke="#17B3A3" strokeWidth="2" />
          <text x="0" y="4" textAnchor="middle" fontSize="12" fill="var(--lg-teal-fg)">Approved</text>
        </g>
      </g>
    </svg>
  );
}

const SPEC_ROWS = [
  { label: "Carcass", value: "16mm white" },
  { label: "Doors", value: "Thermo oak" },
  { label: "Handles", value: "Matte black" },
  { label: "Benchtop", value: "20mm stone" },
];

function SpecsArt() {
  return (
    <svg viewBox="0 0 320 200" role="img" aria-label="A specs page shared with a client and viewed">
      <rect x="10" y="6" width="300" height="188" rx="10" fill="var(--lg-card)" stroke="var(--lg-line)" />
      <path d="M10 34V16a10 10 0 0 1 10-10h280a10 10 0 0 1 10 10v18z" fill="var(--lg-sunk)" />
      <rect x="90" y="12" width="140" height="16" rx="8" fill="var(--lg-card)" />
      <text x="160" y="24" textAnchor="middle" {...T} fill="var(--lg-muted)">Client hub</text>
      <text x="26" y="56" fontSize="13" fill="var(--lg-ink)">Bayview vanity · specs</text>
      {SPEC_ROWS.map((row, index) => {
        const y = 80 + index * 24;
        return (
          <g key={row.label} className="lg-sq lg-down" data-at={200 + index * 250}>
            <text x="26" y={y} {...T} fill="var(--lg-muted)">{row.label}</text>
            <text x="120" y={y} fontSize="12" fill="var(--lg-ink)">{row.value}</text>
            {index < 3 ? <line x1="26" y1={y + 8} x2="294" y2={y + 8} stroke="var(--lg-faint)" /> : null}
          </g>
        );
      })}
      <g className="lg-sq lg-pop" data-at="1600">
        <rect x="26" y="164" width="104" height="22" rx="11" fill="var(--lg-blue-bg)" />
        <text x="78" y="179" textAnchor="middle" {...T} fill="var(--lg-blue-fg)">Sent to client</text>
      </g>
      <g className="lg-sq lg-pop" data-at="2900">
        <rect x="138" y="164" width="104" height="22" rx="11" fill="var(--lg-teal-bg)" />
        <text x="190" y="179" textAnchor="middle" {...T} fill="var(--lg-teal-fg)">Viewed just now</text>
      </g>
    </svg>
  );
}

const NOTES = [
  { color: "#17B3A3", title: "Quote approved", sub: "Henderson" },
  { color: "#007AFF", title: "New lead", sub: "Aroha W." },
  { color: "#7C6CF0", title: "Moved to Build", sub: "Smith kitchen" },
];

function NotificationsArt() {
  return (
    <svg viewBox="0 0 320 200" role="img" aria-label="Notifications arriving on a phone">
      <rect x="95" y="4" width="130" height="192" rx="20" fill="var(--lg-sunk)" stroke="var(--lg-line)" strokeWidth="2" />
      <rect x="140" y="12" width="40" height="5" rx="2.5" fill="var(--lg-line)" />
      <text x="160" y="36" textAnchor="middle" fontSize="12" fill="var(--lg-muted)">7:30</text>
      {NOTES.map((note, index) => {
        const y = 48 + index * 42;
        return (
          <g key={note.title} className="lg-sq lg-drop" data-at={300 + index * 1000}>
            <rect x="104" y={y} width="112" height="36" rx="8" fill="var(--lg-card)" stroke="var(--lg-line)" />
            <circle cx="118" cy={y + 18} r="8" fill={note.color} />
            <text x="131" y={y + 14} {...T} fill="var(--lg-ink)">{note.title}</text>
            <text x="131" y={y + 28} {...T} fill="var(--lg-muted)">{note.sub}</text>
          </g>
        );
      })}
      <rect x="140" y="184" width="40" height="4" rx="2" fill="var(--lg-line)" />
    </svg>
  );
}

const SLIDES: Slide[] = [
  { key: "dashboard", label: "Dashboard", icon: <SquareKanban size={12} />, title: "Move jobs through every stage", text: "Every project on one board. Drag a job along as the work gets done.", art: <DashboardArt /> },
  { key: "nesting", label: "Nesting", icon: <LayoutGrid size={12} />, title: "Nest parts onto sheets", text: "Parts are laid out on your boards to get the most out of every sheet.", art: <NestingArt /> },
  { key: "cutlists", label: "Cutlists", icon: <ListChecks size={12} />, title: "Cutlists from your specs", text: "Every part with its sizes and quantities, ready for the workshop.", art: <CutlistArt /> },
  { key: "calendar", label: "Calendar", icon: <CalendarDays size={12} />, title: "Plan the team's week", text: "Measures, installs and deliveries in one shared calendar.", art: <CalendarArt /> },
  { key: "leads", label: "Leads", icon: <Target size={12} />, title: "Follow every lead to won", text: "Track enquiries from first contact to a signed job.", art: <LeadsArt /> },
  { key: "quotes", label: "Quotes", icon: <Receipt size={12} />, title: "Quotes that add up", text: "Build a quote line by line, then send it to your client.", art: <QuoteArt /> },
  { key: "specs", label: "Client specs", icon: <Share2 size={12} />, title: "Share specs with clients", text: "Send a link and see when your client has viewed it.", art: <SpecsArt /> },
  { key: "notifications", label: "Notifications", icon: <Bell size={12} />, title: "Never miss an update", text: "Get notified about approvals, new leads and jobs on the move.", art: <NotificationsArt /> },
];

function countUp(el: Element, target: number, ms: number, prefix: string, suffix: string) {
  const start = performance.now();
  const step = (now: number) => {
    const progress = Math.min(1, (now - start) / ms);
    el.textContent = `${prefix}${Math.round(target * (1 - Math.pow(1 - progress, 3))).toLocaleString("en-NZ")}${suffix}`;
    if (progress < 1) requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
}

export function FeatureSlider({ className }: { className?: string }) {
  const [active, setActive] = useState(0);
  const slidesRef = useRef<Array<HTMLDivElement | null>>([]);

  // Plays the active slide's drawing from the start.
  useEffect(() => {
    const slide = slidesRef.current[active];
    if (!slide) return;
    const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const parts = Array.from(slide.querySelectorAll<SVGElement>("[data-at]"));
    const timers: number[] = [];
    for (const el of parts) {
      el.removeAttribute("data-on");
      const { count, prefix = "", suffix = "", at, until, dur } = el.dataset;
      if (count) el.textContent = `${prefix}0${suffix}`;
      const turnOn = () => {
        el.setAttribute("data-on", "");
        if (count) countUp(el, Number(count), reduceMotion ? 1 : Number(dur) || 1200, prefix, suffix);
      };
      timers.push(window.setTimeout(turnOn, reduceMotion ? 0 : Number(at) || 0));
      if (until && !reduceMotion) timers.push(window.setTimeout(() => el.removeAttribute("data-on"), Number(until)));
    }
    return () => timers.forEach((timer) => window.clearTimeout(timer));
  }, [active]);

  return (
    <div className={`lg-slider ${className ?? ""}`}>
      <div className="lg-stage">
        {SLIDES.map((slide, index) => (
          <div
            key={slide.key}
            ref={(el) => {
              slidesRef.current[index] = el;
            }}
            className="lg-slide"
            data-active={index === active ? "true" : undefined}
            aria-hidden={index === active ? undefined : true}
          >
            <div className="lg-art">{slide.art}</div>
            <span className="lg-tag">
              {slide.icon}
              {slide.label}
            </span>
            <p className="lg-slide-title">{slide.title}</p>
            <p className="lg-slide-text">{slide.text}</p>
          </div>
        ))}
      </div>
      <div className="lg-dots" role="tablist" aria-label="Features">
        {SLIDES.map((slide, index) => (
          <button
            key={slide.key}
            type="button"
            role="tab"
            aria-selected={index === active}
            aria-label={slide.label}
            className="lg-dot"
            data-active={index === active ? "true" : undefined}
            onClick={() => setActive(index)}
          >
            <span
              key={index === active ? `run-${active}` : "idle"}
              style={{ animationDuration: `${SLIDE_MS}ms` }}
              onAnimationEnd={() => setActive((current) => (current === index ? (index + 1) % SLIDES.length : current))}
            />
          </button>
        ))}
      </div>
    </div>
  );
}
