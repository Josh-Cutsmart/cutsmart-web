"use client";

// Building blocks for the redesigned Company Settings page (app/(staff)/(app)/company-settings/page.tsx):
// glass cards with a title + description, label/hint setting rows, a glass switch, a segmented control, a
// colour-circle picker (the hex only appears inside its pop-over), and a glass replacement for
// window.prompt. Everything is styled from the app's CSS variables so light/dark both work.

import { useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { Check } from "lucide-react";
import { captureGlassModalOrigin, useGlassModalPopOrigin, type GlassModalOrigin } from "@/lib/use-glass-modal-pop-origin";

// Glass text field. cs-glass-field (globals.css) supplies the frosted fill + border, including the
// dark-mode overrides that out-rank the blanket dark input rules.
export const glassFieldClass =
  "cs-glass-field h-9 w-full rounded-[11px] border px-3 text-[13px] font-medium text-[var(--text-main)] outline-none transition focus:border-[var(--brand)] disabled:opacity-60";
// The same field, compact, for inside list rows/tables.
export const glassFieldSmClass =
  "cs-glass-field h-8 w-full rounded-[9px] border px-2.5 text-[12.5px] font-medium text-[var(--text-main)] outline-none transition focus:border-[var(--brand)] disabled:opacity-60";
// A chromeless in-row field: reads as text until hovered/focused.
export const rowFieldClass =
  "h-8 w-full appearance-none rounded-[8px] border border-transparent bg-transparent px-2 text-[13px] font-medium text-[var(--text-main)] outline-none transition hover:border-[var(--glass-border)] focus:border-[var(--brand)] focus:bg-[var(--panel-bg)] disabled:opacity-60";
// A list row (status, category, product, ...).
export const listRowClass =
  "flex items-center gap-2 rounded-[12px] border border-[var(--glass-border)] bg-[color-mix(in_srgb,var(--panel-bg)_55%,transparent)] px-2 py-1.5 transition";
export const secondaryButtonClass =
  "inline-flex h-9 shrink-0 items-center justify-center gap-1.5 rounded-[11px] border border-[var(--glass-border)] bg-[color-mix(in_srgb,var(--panel-bg)_60%,transparent)] px-3.5 text-[12.5px] font-semibold text-[var(--text-main)] transition hover:brightness-95 disabled:opacity-60";
export const smallButtonClass =
  "inline-flex h-8 shrink-0 items-center justify-center gap-1.5 rounded-[10px] border border-[var(--glass-border)] bg-[color-mix(in_srgb,var(--panel-bg)_60%,transparent)] px-3 text-[12px] font-semibold text-[var(--text-main)] transition hover:brightness-95 disabled:opacity-60";
export const primaryButtonClass =
  "inline-flex h-9 shrink-0 items-center justify-center gap-1.5 rounded-[11px] px-4 text-[12.5px] font-semibold text-white transition hover:brightness-105 disabled:opacity-60";
export const primaryButtonStyle = { backgroundImage: "var(--brand-gradient)", boxShadow: "0 6px 16px rgba(0,100,214,0.22)" } as const;
export const iconRemoveButtonClass =
  "inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-[8px] text-[var(--text-muted)] transition hover:bg-[var(--danger-soft)] hover:text-[var(--danger)] disabled:opacity-40";
export const gripClass =
  "inline-flex h-7 w-6 shrink-0 cursor-grab items-center justify-center rounded-[7px] text-[var(--text-muted)] transition hover:bg-[color-mix(in_srgb,var(--text-main)_6%,transparent)] hover:text-[var(--text-main)] active:cursor-grabbing";
export const chipClass =
  "inline-flex h-8 items-center gap-1.5 rounded-full border border-[var(--glass-border)] bg-[color-mix(in_srgb,var(--panel-bg)_60%,transparent)] pl-3 pr-1 text-[12.5px] font-semibold text-[var(--text-main)]";
export const chipAddClass =
  "inline-flex h-8 items-center gap-1 rounded-full border border-dashed border-[color-mix(in_srgb,var(--text-main)_22%,transparent)] px-3 text-[12.5px] font-semibold text-[var(--brand-strong)] transition hover:bg-[var(--brand-soft)] disabled:opacity-50";
export const countPillClass =
  "inline-flex shrink-0 items-center rounded-full bg-[color-mix(in_srgb,var(--text-main)_7%,transparent)] px-2 py-0.5 text-[11px] font-semibold text-[var(--text-muted)]";
export const columnHeadClass = "text-[10.5px] font-bold uppercase tracking-[0.6px] text-[var(--text-muted)]";

export function SettingsCard({
  title,
  description,
  icon: Icon,
  headerRight,
  badge,
  children,
  className = "",
  allowOverflow = false,
}: {
  title: string;
  description?: ReactNode;
  icon?: React.ComponentType<{ size?: number; strokeWidth?: number }>;
  headerRight?: ReactNode;
  badge?: string;
  children: ReactNode;
  className?: string;
  allowOverflow?: boolean;
}) {
  return (
    <section
      data-settings-card={title}
      className={`glass-panel-settle-in ${allowOverflow ? "overflow-visible" : "overflow-hidden"} rounded-[20px] border ${className}`}
      style={{
        borderColor: "var(--glass-border)",
        backgroundColor: "var(--glass-bg-strong)",
        backdropFilter: "blur(20px) saturate(180%)",
        WebkitBackdropFilter: "blur(20px) saturate(180%)",
        boxShadow: "inset 0 1px 0 var(--glass-highlight), var(--shadow-glass)",
      }}
    >
      <div className="flex items-start gap-3 px-[18px] pb-3 pt-4">
        {Icon ? (
          <span
            className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-[10px]"
            style={{ backgroundColor: "var(--brand-soft)", color: "var(--brand-strong)" }}
          >
            <Icon size={16} strokeWidth={2.1} />
          </span>
        ) : null}
        <div className="min-w-0 flex-1">
          <h2 className="flex flex-wrap items-center gap-2 text-[15px] font-semibold" style={{ color: "var(--text-main)" }}>
            {title}
            {badge ? (
              <span
                className="rounded-full px-2 py-0.5 text-[10.5px] font-bold"
                style={{ backgroundColor: "color-mix(in srgb, #7c6cf0 16%, transparent)", color: "color-mix(in srgb, var(--accent-purple) 85%, var(--text-main))" }}
              >
                {badge}
              </span>
            ) : null}
          </h2>
          {description ? (
            <p className="mt-0.5 text-[12.5px] leading-[1.45]" style={{ color: "var(--text-muted)" }}>
              {description}
            </p>
          ) : null}
        </div>
        {headerRight ? <div className="shrink-0">{headerRight}</div> : null}
      </div>
      <div className={`${allowOverflow ? "overflow-visible" : ""} px-[18px] pb-[18px] pt-1`}>{children}</div>
    </section>
  );
}

// One setting: label (+ optional hint) on the left, the control on the right; stacks on narrow screens.
// Consecutive rows get a hairline between them.
export function SettingRow({
  label,
  hint,
  children,
  align = "center",
  id,
}: {
  label: ReactNode;
  hint?: ReactNode;
  children: ReactNode;
  align?: "center" | "start";
  id?: string;
}) {
  return (
    <div
      data-setting-id={id}
      className={`grid grid-cols-1 gap-x-5 gap-y-2 border-t border-[var(--glass-border)] py-3.5 first:border-t-0 first:pt-1 sm:grid-cols-[minmax(170px,260px)_1fr] ${
        align === "start" ? "sm:items-start" : "sm:items-center"
      }`}
    >
      <div>
        <p className="text-[13px] font-semibold" style={{ color: "var(--text-main)" }}>{label}</p>
        {hint ? <p className="mt-0.5 text-[12px] leading-[1.45]" style={{ color: "var(--text-muted)" }}>{hint}</p> : null}
      </div>
      <div className="flex min-w-0 flex-wrap items-center gap-2.5">{children}</div>
    </div>
  );
}

export function GlassSwitch({
  checked,
  onChange,
  disabled,
  size = "md",
  title,
  ariaLabel,
}: {
  checked: boolean;
  onChange: (next: boolean) => void;
  disabled?: boolean;
  size?: "sm" | "md";
  title?: string;
  ariaLabel?: string;
}) {
  const w = size === "sm" ? 36 : 44;
  const h = size === "sm" ? 22 : 26;
  const knob = h - 6;
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={ariaLabel}
      title={title}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className="relative shrink-0 rounded-full transition-[background] duration-200 disabled:cursor-not-allowed disabled:opacity-50"
      style={{
        width: w,
        height: h,
        background: checked ? "var(--brand-gradient)" : "rgba(120,120,128,0.32)",
      }}
    >
      <span
        className="absolute left-[3px] top-[3px] rounded-full shadow-[0_2px_6px_rgba(0,0,0,0.22)]"
        style={{
          // Inline, not the bg-white class: globals.css repaints .bg-white as the dark panel colour in
          // dark mode, which would turn the knob into a dark dot on the dark off-track.
          backgroundColor: "#FFFFFF",
          width: knob,
          height: knob,
          transform: checked ? `translateX(${w - knob - 6}px)` : "translateX(0)",
          transition: "transform 220ms cubic-bezier(0.34,1.56,0.64,1)",
        }}
      />
    </button>
  );
}

// A segmented control with a sliding thumb.
export function Segmented<T extends string>({
  value,
  options,
  onChange,
  size = "md",
  disabled,
  tone = "neutral",
}: {
  value: T;
  options: Array<{ value: T; label: ReactNode }>;
  onChange: (next: T) => void;
  size?: "sm" | "md";
  disabled?: boolean;
  // "brand": the selected option is the blue brand fill with white text (like the switches), instead
  // of a plain raised white thumb.
  tone?: "neutral" | "brand";
}) {
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const [thumb, setThumb] = useState<{ left: number; width: number } | null>(null);
  useLayoutEffect(() => {
    const wrap = wrapRef.current;
    if (!wrap) return;
    const measure = () => {
      const el = wrap.querySelector<HTMLElement>(`[data-seg-value="${CSS.escape(String(value))}"]`);
      setThumb(el ? { left: el.offsetLeft, width: el.offsetWidth } : null);
    };
    measure();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(measure);
    observer.observe(wrap);
    return () => observer.disconnect();
  }, [value, options.length]);
  return (
    <div
      ref={wrapRef}
      role="radiogroup"
      className={`relative inline-flex shrink-0 rounded-[12px] border border-[var(--glass-border)] bg-[color-mix(in_srgb,var(--panel-bg)_55%,transparent)] p-[3px] ${disabled ? "opacity-60" : ""}`}
    >
      {thumb ? (
        <span
          aria-hidden
          className="absolute bottom-[3px] top-[3px] rounded-[9px] shadow-[0_1px_4px_rgba(0,0,0,0.12)]"
          style={{
            left: thumb.left,
            width: thumb.width,
            // White in light mode (white mixed with white); in dark, a step lighter than the panel so the
            // thumb doesn't vanish into the track.
            backgroundColor: tone === "brand" ? undefined : "color-mix(in srgb, var(--panel-bg) 85%, #ffffff)",
            backgroundImage: tone === "brand" ? "var(--brand-gradient)" : undefined,
            transition: "left 250ms cubic-bezier(0.32,0.72,0,1), width 250ms cubic-bezier(0.32,0.72,0,1)",
          }}
        />
      ) : null}
      {options.map((opt) => {
        const on = opt.value === value;
        return (
          <button
            key={opt.value}
            type="button"
            role="radio"
            aria-checked={on}
            data-seg-value={opt.value}
            disabled={disabled}
            onClick={() => onChange(opt.value)}
            className={`relative z-[1] rounded-[9px] font-semibold transition-colors ${size === "sm" ? "h-[26px] px-2.5 text-[12px]" : "h-[30px] px-3.5 text-[12.5px]"}`}
            style={{ color: on ? (tone === "brand" ? "#FFFFFF" : "var(--text-main)") : "var(--text-muted)" }}
          >
            {opt.label}
          </button>
        );
      })}
    </div>
  );
}

export const COLOR_PALETTE = [
  "#2F6BFF", "#007AFF", "#0EA5E9", "#14B8A6", "#16A34A", "#84CC16",
  "#EAB308", "#F2A33C", "#E8721C", "#DC2626", "#E11D48", "#D946EF",
  "#8B5CF6", "#6B4FB3", "#1E293B", "#64748B", "#7D99B3", "#A16207",
];

const HEX_RE = /^#[0-9a-f]{6}$/i;

// The pop-over the colour circles open: a palette, plus a custom colour (native picker + hex field).
function ColorPopover({
  anchor,
  value,
  onPick,
  onClose,
}: {
  anchor: DOMRect;
  value: string;
  onPick: (hex: string) => void;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDivElement | null>(null);
  const customInputRef = useRef<HTMLInputElement | null>(null);
  const [hexDraft, setHexDraft] = useState(HEX_RE.test(value) ? value.toUpperCase() : "");
  // The custom colour (the browser's own colour chooser): React's onChange is really the native
  // "input" event, which fires on every move while you drag around the chooser — picking (and so
  // closing this pop-over, which unmounts the input and shuts the chooser) on that made it vanish the
  // moment you clicked in it. The colour is only picked on the native "change" event instead, which
  // fires once, when you're done with the chooser; while dragging, only the hex field below follows.
  useEffect(() => {
    const el = customInputRef.current;
    if (!el) return;
    const onCommit = () => onPick(el.value.toUpperCase());
    el.addEventListener("change", onCommit);
    return () => el.removeEventListener("change", onCommit);
  }, [onPick]);
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const w = el.offsetWidth;
    const h = el.offsetHeight;
    const below = anchor.bottom + 8 + h <= window.innerHeight - 8;
    setPos({
      left: Math.max(8, Math.min(anchor.left - 8, window.innerWidth - w - 8)),
      top: below ? anchor.bottom + 8 : Math.max(8, anchor.top - 8 - h),
    });
  }, [anchor]);
  useEffect(() => {
    const onDown = (e: Event) => {
      if (ref.current?.contains(e.target as Node)) return;
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
  return createPortal(
    <div
      ref={ref}
      data-glass-dropdown-menu="true"
      className="glass-bubble-pop fixed z-[3000] grid w-[248px] gap-2.5 rounded-[16px] border p-3"
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
      <div className="grid grid-cols-6 gap-2">
        {COLOR_PALETTE.map((c) => {
          const on = c.toLowerCase() === value.toLowerCase();
          return (
            <button
              key={c}
              type="button"
              aria-label={c}
              onClick={() => onPick(c)}
              className="relative aspect-square rounded-full transition hover:scale-110"
              style={{ backgroundColor: c, boxShadow: "inset 0 0 0 1px rgba(0,0,0,0.08)", outline: on ? "2px solid var(--text-main)" : undefined, outlineOffset: 2 }}
            >
              {on ? <Check size={13} className="absolute inset-0 m-auto" style={{ color: "#fff" }} /> : null}
            </button>
          );
        })}
      </div>
      <div className="flex items-center gap-2">
        <input
          type="color"
          aria-label="Custom colour"
          ref={customInputRef}
          defaultValue={HEX_RE.test(value) ? value : "#2F6BFF"}
          onChange={(e) => setHexDraft(e.target.value.toUpperCase())}
          className="h-8 w-10 shrink-0 cursor-pointer rounded-[8px] border-0 bg-transparent p-0"
        />
        <input
          value={hexDraft}
          onChange={(e) => setHexDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              const next = hexDraft.startsWith("#") ? hexDraft : `#${hexDraft}`;
              if (HEX_RE.test(next)) onPick(next.toUpperCase());
            }
          }}
          onBlur={() => {
            const next = hexDraft.startsWith("#") ? hexDraft : `#${hexDraft}`;
            if (HEX_RE.test(next) && next.toLowerCase() !== value.toLowerCase()) onPick(next.toUpperCase());
          }}
          placeholder="#HEX"
          className={glassFieldSmClass}
        />
      </div>
    </div>,
    document.body,
  );
}

// A colour circle; tapping it opens the palette pop-over. The hex code only shows inside the pop-over.
export function ColorCircle({
  value,
  onChange,
  size = 28,
  disabled,
  title = "Change colour",
}: {
  value: string;
  onChange: (hex: string) => void;
  size?: number;
  disabled?: boolean;
  title?: string;
}) {
  const btnRef = useRef<HTMLButtonElement | null>(null);
  const [anchor, setAnchor] = useState<DOMRect | null>(null);
  const close = useCallback(() => setAnchor(null), [setAnchor]);
  return (
    <>
      <button
        ref={btnRef}
        type="button"
        title={title}
        aria-label={title}
        disabled={disabled}
        onClick={() => setAnchor((prev) => (prev ? null : btnRef.current?.getBoundingClientRect() ?? null))}
        className="shrink-0 rounded-full transition hover:scale-[1.08] disabled:cursor-not-allowed disabled:opacity-50"
        style={{
          width: size,
          height: size,
          backgroundColor: HEX_RE.test(value) ? value : "#7D99B3",
          border: "2px solid var(--panel-bg)",
          boxShadow: "0 0 0 1px var(--glass-border), 0 2px 6px rgba(0,0,0,0.12)",
        }}
      />
      {anchor && typeof document !== "undefined" ? (
        <ColorPopover
          anchor={anchor}
          value={value}
          onPick={(hex) => {
            onChange(hex);
            setAnchor(null);
          }}
          onClose={close}
        />
      ) : null}
    </>
  );
}

// The Theme colour picker: a row of large circles plus a rainbow "custom" circle (which opens the
// same pop-over). No hex shown here.
export function ThemeColorPicker({ value, onChange, disabled }: { value: string; onChange: (hex: string) => void; disabled?: boolean }) {
  const presets = COLOR_PALETTE.slice(0, 11);
  const isPreset = presets.some((c) => c.toLowerCase() === value.toLowerCase());
  const customRef = useRef<HTMLButtonElement | null>(null);
  const [anchor, setAnchor] = useState<DOMRect | null>(null);
  const close = useCallback(() => setAnchor(null), [setAnchor]);
  const ring = (on: boolean) => (on ? "0 0 0 2px var(--panel-bg), 0 0 0 4px var(--text-main)" : "inset 0 0 0 1px rgba(0,0,0,0.08)");
  return (
    <div className="flex flex-wrap items-center gap-2.5">
      {presets.map((c) => (
        <button
          key={c}
          type="button"
          aria-label={`Theme colour ${c}`}
          disabled={disabled}
          onClick={() => onChange(c)}
          className="h-9 w-9 rounded-full transition hover:scale-110 disabled:opacity-50"
          style={{ backgroundColor: c, boxShadow: ring(c.toLowerCase() === value.toLowerCase()) }}
        />
      ))}
      <button
        ref={customRef}
        type="button"
        aria-label="Custom theme colour"
        title="Custom colour"
        disabled={disabled}
        onClick={() => setAnchor((prev) => (prev ? null : customRef.current?.getBoundingClientRect() ?? null))}
        className="relative h-9 w-9 rounded-full transition hover:scale-110 disabled:opacity-50"
        style={{
          background: isPreset ? "conic-gradient(#f43f5e, #f59e0b, #84cc16, #06b6d4, #6366f1, #d946ef, #f43f5e)" : value,
          boxShadow: ring(!isPreset),
        }}
      />
      {anchor && typeof document !== "undefined" ? (
        <ColorPopover
          anchor={anchor}
          value={value}
          onPick={(hex) => {
            onChange(hex);
            setAnchor(null);
          }}
          onClose={close}
        />
      ) : null}
    </div>
  );
}

// A glass replacement for window.prompt(): `const ask = useGlassPrompt();` then
// `const value = await ask.prompt({ title, label, placeholder }, event)` and render `{ask.element}`.
export function useGlassPrompt() {
  const [request, setRequest] = useState<{
    title: string;
    label?: string;
    placeholder?: string;
    initialValue?: string;
    confirmLabel?: string;
    inputMode?: "text" | "email" | "decimal";
    resolve: (value: string | null) => void;
  } | null>(null);
  const [isOpen, setIsOpen] = useState(false);
  const [origin, setOrigin] = useState<GlassModalOrigin>(null);
  const [draft, setDraft] = useState("");
  const panelRef = useRef<HTMLDivElement | null>(null);
  const originElRef = useRef<HTMLElement | null>(null);
  const shouldRender = useGlassModalPopOrigin(isOpen, origin, panelRef, undefined, originElRef);

  const prompt = useCallback(
    (
      options: { title: string; label?: string; placeholder?: string; initialValue?: string; confirmLabel?: string; inputMode?: "text" | "email" | "decimal" },
      event?: React.MouseEvent<HTMLElement>,
    ) =>
      new Promise<string | null>((resolve) => {
        if (event) {
          originElRef.current = event.currentTarget;
          setOrigin(captureGlassModalOrigin(event));
        } else {
          originElRef.current = null;
          setOrigin(null);
        }
        setDraft(options.initialValue ?? "");
        setRequest({ ...options, resolve });
        setIsOpen(true);
      }),
    [],
  );

  const finish = (value: string | null) => {
    request?.resolve(value);
    setIsOpen(false);
  };

  const element =
    shouldRender && request && typeof document !== "undefined"
      ? createPortal(
          <div className="fixed inset-0 z-[2400] flex items-center justify-center px-4 py-4">
            <button type="button" aria-label="Cancel" onClick={() => finish(null)} className="glass-modal-backdrop absolute inset-0" />
            <div ref={panelRef} className="glass-modal-panel relative z-[2401] w-full max-w-[440px] overflow-hidden">
            <form
              onSubmit={(e) => {
                e.preventDefault();
                finish(draft.trim() ? draft.trim() : null);
              }}
            >
              <div className="glass-modal-header px-4 py-3">
                <p className="text-[13px] font-extrabold uppercase tracking-[0.8px]" style={{ color: "var(--text-main)" }}>{request.title}</p>
              </div>
              <label className="grid gap-1.5 px-4 py-4 text-[12px] font-semibold" style={{ color: "var(--text-main)" }}>
                {request.label}
                <input
                  autoFocus
                  value={draft}
                  inputMode={request.inputMode === "decimal" ? "decimal" : undefined}
                  type={request.inputMode === "email" ? "email" : "text"}
                  onChange={(e) => setDraft(e.target.value)}
                  placeholder={request.placeholder}
                  className={glassFieldClass}
                />
              </label>
              <div className="flex justify-end gap-2 border-t px-4 py-3" style={{ borderColor: "var(--glass-border)" }}>
                <button type="button" onClick={() => finish(null)} className={secondaryButtonClass}>Cancel</button>
                <button type="submit" className={primaryButtonClass} style={primaryButtonStyle}>{request.confirmLabel || "Add"}</button>
              </div>
            </form>
            </div>
          </div>,
          document.body,
        )
      : null;

  return { prompt, element };
}

// A length entry that shows the value in the company's unit (mm or inches) but always reads/writes
// millimetres, so stored data never changes meaning when the unit setting is switched.
export function LengthField({
  valueMm,
  onChangeMm,
  unit,
  className = glassFieldSmClass,
  placeholder,
  disabled,
  width = 96,
  showUnit = true,
  onBlur,
  style,
}: {
  valueMm: string;
  onChangeMm: (mm: string) => void;
  onBlur?: () => void;
  style?: React.CSSProperties;
  unit: "mm" | "in";
  className?: string;
  placeholder?: string;
  disabled?: boolean;
  width?: number;
  showUnit?: boolean;
}) {
  const toDisplay = (mm: string) => {
    const n = Number(String(mm ?? "").replace(/,/g, ""));
    if (!String(mm ?? "").trim() || !Number.isFinite(n)) return String(mm ?? "");
    return unit === "in" ? String(Math.round((n / 25.4) * 1000) / 1000) : String(mm);
  };
  const [draft, setDraft] = useState<string | null>(null);
  return (
    <span className="relative inline-flex shrink-0 items-center" style={{ width }}>
      <input
        value={draft ?? toDisplay(valueMm)}
        inputMode="decimal"
        placeholder={placeholder}
        disabled={disabled}
        onFocus={() => setDraft(toDisplay(valueMm))}
        onChange={(e) => {
          const text = e.target.value;
          setDraft(text);
          const n = Number(text.replace(/,/g, ""));
          if (!text.trim()) onChangeMm("");
          else if (Number.isFinite(n)) onChangeMm(unit === "in" ? String(Math.round(n * 25.4 * 100) / 100) : text);
        }}
        onBlur={() => {
          setDraft(null);
          onBlur?.();
        }}
        style={style}
        className={`${className} ${showUnit ? "pr-8" : ""} text-center`}
      />
      {showUnit ? (
        <span className="pointer-events-none absolute right-2.5 text-[11.5px]" style={{ color: "var(--text-muted)" }}>
          {unit}
        </span>
      ) : null}
    </span>
  );
}
