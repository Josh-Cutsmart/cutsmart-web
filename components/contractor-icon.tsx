"use client";

// A contractor's icon: picked for each contractor in Company Settings › Production › Contractors (saved on the company
// as contractorIcons — the contractor's name → the icon's key), and shown wherever the contractor is: the cutlist's
// Notes bar and its Contractors menu, their notes drawers, the phone's Notes sheet. One not picked yet gets one guessed
// from its name ("Electrician" a lightning bolt…), or the hard hat.

import { useCallback, useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from "react";
import { createPortal } from "react-dom";
import {
  AppWindow,
  Bath,
  Blinds,
  BrickWall,
  Cctv,
  Cog,
  DoorOpen,
  Drill,
  Droplets,
  Ellipsis,
  Fan,
  Fence,
  Flame,
  Gem,
  Grid3x3,
  Hammer,
  HardHat,
  Layers,
  Lightbulb,
  Package,
  Paintbrush,
  PaintRoller,
  PencilRuler,
  Pickaxe,
  Plug,
  Refrigerator,
  Ruler,
  Shovel,
  ShowerHead,
  Snowflake,
  Sofa,
  Sparkles,
  SprayCan,
  Trash2,
  TreePine,
  Truck,
  User,
  Wifi,
  Wrench,
  Zap,
  type LucideIcon,
} from "lucide-react";
import { swallowNextClick } from "@/lib/swallow-dismiss-click";

// `match`: words in a contractor's name that guess this icon for it (the first icon with a match wins).
const CONTRACTOR_ICONS: Array<{ key: string; label: string; Icon: LucideIcon; match?: string[] }> = [
  { key: "hard-hat", label: "Builder", Icon: HardHat, match: ["build", "construct", "site"] },
  { key: "hammer", label: "Carpenter", Icon: Hammer, match: ["carpent", "joiner", "install", "fitter"] },
  { key: "drill", label: "Drill", Icon: Drill },
  { key: "wrench", label: "Maintenance", Icon: Wrench, match: ["maint", "handy", "mechanic"] },
  { key: "zap", label: "Electrician", Icon: Zap, match: ["electric", "sparky"] },
  { key: "plug", label: "Power", Icon: Plug, match: ["power"] },
  { key: "lightbulb", label: "Lighting", Icon: Lightbulb, match: ["light"] },
  { key: "droplets", label: "Plumber", Icon: Droplets, match: ["plumb", "water", "drain"] },
  { key: "shower", label: "Shower", Icon: ShowerHead, match: ["shower"] },
  { key: "bath", label: "Bathroom", Icon: Bath, match: ["bath"] },
  { key: "flame", label: "Gas", Icon: Flame, match: ["gas"] },
  { key: "fan", label: "Ventilation", Icon: Fan, match: ["vent", "extract", "rangehood", "hvac"] },
  { key: "snowflake", label: "Heating & cooling", Icon: Snowflake, match: ["heat pump", "air con", "aircon", "refrig", "cool"] },
  { key: "paint-roller", label: "Painter", Icon: PaintRoller, match: ["paint", "decorat"] },
  { key: "paintbrush", label: "Brush", Icon: Paintbrush },
  { key: "spray-can", label: "Spray finish", Icon: SprayCan, match: ["spray", "lacquer", "2pac", "2 pac", "polyurethane", "finish"] },
  { key: "tiles", label: "Tiler", Icon: Grid3x3, match: ["tile", "tiling"] },
  { key: "gem", label: "Stone", Icon: Gem, match: ["stone", "bench", "granite", "marble", "quartz"] },
  { key: "brick", label: "Bricklayer", Icon: BrickWall, match: ["brick", "mason", "block"] },
  { key: "layers", label: "Plasterer", Icon: Layers, match: ["plaster", "gib", "drywall", "laminat"] },
  { key: "glass", label: "Glazier", Icon: AppWindow, match: ["glass", "glaz", "window", "splash"] },
  { key: "blinds", label: "Blinds", Icon: Blinds, match: ["blind", "curtain"] },
  { key: "door", label: "Doors", Icon: DoorOpen, match: ["door"] },
  { key: "ruler", label: "Measurer", Icon: Ruler, match: ["measur", "survey"] },
  { key: "pencil-ruler", label: "Designer", Icon: PencilRuler, match: ["design", "draught", "draft", "architect"] },
  { key: "refrigerator", label: "Appliances", Icon: Refrigerator, match: ["applian", "whiteware"] },
  { key: "sofa", label: "Upholsterer", Icon: Sofa, match: ["upholst", "furnitur"] },
  { key: "truck", label: "Delivery", Icon: Truck, match: ["deliver", "transport", "freight", "courier"] },
  { key: "pickaxe", label: "Demolition", Icon: Pickaxe, match: ["demo"] },
  { key: "trash", label: "Rubbish", Icon: Trash2, match: ["rubbish", "skip", "waste"] },
  { key: "shovel", label: "Earthworks", Icon: Shovel, match: ["excavat", "earth", "dig"] },
  { key: "tree", label: "Landscaper", Icon: TreePine, match: ["landscap", "garden"] },
  { key: "fence", label: "Fencing", Icon: Fence, match: ["fenc"] },
  { key: "cctv", label: "Security", Icon: Cctv, match: ["secur", "alarm"] },
  { key: "wifi", label: "Data & AV", Icon: Wifi, match: ["data", "network", "audio", "av "] },
  { key: "sparkles", label: "Cleaner", Icon: Sparkles, match: ["clean"] },
  { key: "cog", label: "Machinist", Icon: Cog, match: ["cnc", "machin"] },
  { key: "package", label: "Supplier", Icon: Package, match: ["suppl", "hardware"] },
  { key: "user", label: "Person", Icon: User },
  { key: "ellipsis", label: "Other", Icon: Ellipsis, match: ["other"] },
];

const ICON_BY_KEY = new Map(CONTRACTOR_ICONS.map((item) => [item.key, item]));

// The company's contractorIcons as saved: only known icons kept.
export function normalizeContractorIcons(raw: unknown): Record<string, string> {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  const out: Record<string, string> = {};
  for (const [name, key] of Object.entries(raw as Record<string, unknown>)) {
    const trimmed = String(name ?? "").trim();
    if (trimmed && typeof key === "string" && ICON_BY_KEY.has(key)) out[trimmed] = key;
  }
  return out;
}

// The icon a contractor shows: the one picked for it, else one guessed from its name, else the hard hat.
export function contractorIconKey(name: string, icons?: Record<string, string> | null): string {
  const picked = icons?.[String(name ?? "").trim()];
  if (picked && ICON_BY_KEY.has(picked)) return picked;
  const lower = ` ${String(name ?? "").toLowerCase()} `;
  return CONTRACTOR_ICONS.find((item) => item.match?.some((word) => lower.includes(word)))?.key ?? "hard-hat";
}

export function ContractorIcon({
  name,
  icons,
  iconKey,
  size = 14,
  className,
  strokeWidth,
  style,
}: {
  name?: string;
  icons?: Record<string, string> | null;
  // Shown as is (the picker's own); otherwise worked out from `name` and `icons`.
  iconKey?: string;
  size?: number;
  className?: string;
  strokeWidth?: number;
  style?: CSSProperties;
}) {
  const key = iconKey ?? contractorIconKey(name ?? "", icons);
  const Icon = ICON_BY_KEY.get(key)?.Icon ?? HardHat;
  return <Icon size={size} className={className} strokeWidth={strokeWidth} style={style} />;
}

// Company Settings: the contractor's icon as a round button — pressed, a pop-over of the icons to pick from.
export function ContractorIconPicker({
  name,
  value,
  onChange,
  disabled,
}: {
  name: string;
  // The one picked ("" — none yet: the guess from its name shows, ringed as such in the pop-over).
  value: string;
  onChange: (key: string) => void;
  disabled?: boolean;
}) {
  const btnRef = useRef<HTMLButtonElement | null>(null);
  const [anchor, setAnchor] = useState<DOMRect | null>(null);
  const close = useCallback(() => setAnchor(null), []);
  const shown = value && ICON_BY_KEY.has(value) ? value : contractorIconKey(name);
  const label = `Icon for ${name.trim() || "this contractor"}`;
  return (
    <>
      <button
        ref={btnRef}
        type="button"
        title={label}
        aria-label={label}
        aria-haspopup="dialog"
        aria-expanded={Boolean(anchor)}
        disabled={disabled}
        onClick={() => setAnchor((prev) => (prev ? null : (btnRef.current?.getBoundingClientRect() ?? null)))}
        className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full transition hover:bg-[var(--brand-soft)] disabled:cursor-not-allowed disabled:opacity-50"
        style={{ color: "var(--text-main)", backgroundColor: anchor ? "var(--brand-soft)" : undefined }}
      >
        <ContractorIcon iconKey={shown} size={14} />
      </button>
      {anchor && typeof document !== "undefined" ? (
        <ContractorIconPopover
          anchor={anchor}
          value={shown}
          onPick={(key) => {
            onChange(key);
            setAnchor(null);
          }}
          onClose={close}
        />
      ) : null}
    </>
  );
}

// The pop-over (as settings-ui's colour pop-over is): a grid of the icons, the contractor's ringed; its name on hover.
function ContractorIconPopover({
  anchor,
  value,
  onPick,
  onClose,
}: {
  anchor: DOMRect;
  value: string;
  onPick: (key: string) => void;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDivElement | null>(null);
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const place = () => {
      const viewport = window.visualViewport;
      const visibleTop = viewport ? viewport.offsetTop : 0;
      const visibleBottom = viewport ? viewport.offsetTop + viewport.height : window.innerHeight;
      const w = el.offsetWidth;
      const h = el.offsetHeight;
      const below = anchor.bottom + 8 + h <= visibleBottom - 8;
      const top = below ? anchor.bottom + 8 : anchor.top - 8 - h;
      setPos({
        left: Math.max(8, Math.min(anchor.left - 8, window.innerWidth - w - 8)),
        top: Math.max(visibleTop + 8, Math.min(top, visibleBottom - h - 8)),
      });
    };
    place();
    const viewport = window.visualViewport;
    viewport?.addEventListener("resize", place);
    viewport?.addEventListener("scroll", place);
    return () => {
      viewport?.removeEventListener("resize", place);
      viewport?.removeEventListener("scroll", place);
    };
  }, [anchor]);
  useEffect(() => {
    const onDown = (e: Event) => {
      if (ref.current?.contains(e.target as Node)) return;
      // (This press only closes it — not also acting on what it landed on, nor reopening it from its button.)
      swallowNextClick();
      onClose();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("pointerdown", onDown, true);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onDown, true);
      document.removeEventListener("keydown", onKey);
    };
  }, [onClose]);
  const [hoverKey, setHoverKey] = useState("");
  const caption = ICON_BY_KEY.get(hoverKey || value)?.label ?? "";
  return createPortal(
    <div
      ref={ref}
      role="dialog"
      aria-label="Pick an icon"
      data-glass-dropdown-menu="true"
      className="glass-bubble-pop fixed z-[3000] grid w-[284px] gap-2 rounded-[16px] border p-3"
      style={{
        left: pos?.left ?? -9999,
        top: pos?.top ?? -9999,
        borderColor: "var(--glass-border)",
        backgroundColor: "var(--glass-bg-strong)",
        backdropFilter: "blur(24px) saturate(180%)",
        WebkitBackdropFilter: "blur(24px) saturate(180%)",
        boxShadow: "var(--shadow-glass), 0 18px 40px rgba(15,23,42,0.2)",
      }}
    >
      <div className="grid grid-cols-7 gap-1" onPointerLeave={() => setHoverKey("")}>
        {CONTRACTOR_ICONS.map(({ key, label, Icon }) => {
          const on = key === value;
          return (
            <button
              key={key}
              type="button"
              title={label}
              aria-label={label}
              aria-pressed={on}
              onPointerEnter={() => setHoverKey(key)}
              onFocus={() => setHoverKey(key)}
              onClick={() => onPick(key)}
              className={`inline-flex aspect-square items-center justify-center rounded-[10px] transition ${on ? "text-white" : "hover:bg-[var(--brand-soft)]"}`}
              style={on ? { backgroundColor: "var(--brand)" } : { color: "var(--text-main)" }}
            >
              <Icon size={17} />
            </button>
          );
        })}
      </div>
      <p className="h-4 truncate text-center text-[12px] font-medium" style={{ color: "var(--text-muted)" }}>
        {caption}
      </p>
    </div>,
    document.body,
  );
}
