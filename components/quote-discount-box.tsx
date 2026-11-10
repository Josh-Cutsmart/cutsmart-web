"use client";

import { useEffect, useRef, useState, type RefObject } from "react";
import { createPortal } from "react-dom";
import { BadgePercent } from "lucide-react";
import { GlassModalHeader } from "@/components/glass-modal-header";
import { activeMoney } from "@/lib/company-formats";
import { glassShineStyle } from "@/lib/glass-shine";
import {
  QUOTE_DISCOUNT_MODES,
  quoteDiscountAnswerText,
  quoteDiscountFigures,
  type QuoteDiscountAnswer,
  type QuoteDiscountMode,
} from "@/lib/quote-discount";

// A quote's discount, in pop-ups (lib/quote-discount.ts): asking for one or adding one (QuoteDiscountPrompt — the quote's
// bottom bar), and answering one (QuoteDiscountAnswerBox — a request, or a counter offer; from its notification, or the
// discount's card in Quote Extras). Only ever between staff.

const money = (value: number) => activeMoney(Math.max(0, value));
const NEUTRAL_BUTTON =
  "h-9 rounded-full border px-4 text-[13px] font-medium hover:brightness-95 disabled:opacity-55 max-lg:h-11 max-lg:px-5 max-lg:text-[14px]";
const NEUTRAL_STYLE = { borderColor: "var(--glass-border)", backgroundColor: "var(--panel-bg)", color: "var(--text-main)" } as const;
const SHINE_BUTTON =
  "glass-shine h-9 rounded-full border px-4 text-[13px] font-medium text-white hover:brightness-105 disabled:opacity-55 max-lg:h-11 max-lg:px-5 max-lg:text-[14px]";

// What a discount comes to, in the order it's worked out: the price before GST, the discount off it, GST on what's left,
// and the new total (the quote's total now under it, to compare). With no GST, just the total, the discount and the
// new total.
export function QuoteDiscountFigureRows({
  originalTotal,
  amountOff,
  amountOffBeforeGst,
  gstPercent = 0,
  newTotal,
  percent,
}: {
  originalTotal: number;
  amountOff: number | null;
  amountOffBeforeGst?: number | null;
  gstPercent?: number;
  newTotal: number | null;
  percent?: number | null;
}) {
  const shownPercent = percent ?? (amountOff !== null && originalTotal > 0 ? Math.round((amountOff / originalTotal) * 1000) / 10 : null);
  const hasGst = gstPercent > 0;
  const round2 = (value: number) => Math.round(value * 100) / 100;
  const discount = amountOff === null ? null : amountOffBeforeGst ?? (hasGst ? round2(amountOff / (1 + gstPercent / 100)) : amountOff);
  // (The price before GST, and the GST on what's left — so the lines add up to the new total exactly.)
  const priceBeforeGst = hasGst ? round2(originalTotal / (1 + gstPercent / 100)) : originalTotal;
  const gstAfter = hasGst && discount !== null && newTotal !== null ? round2(newTotal - (priceBeforeGst - discount)) : null;
  const row = "flex items-center justify-between gap-3 text-[13px] font-medium";
  return (
    <div className="space-y-1.5 rounded-[12px] border px-3.5 py-3" style={{ borderColor: "var(--glass-border)", backgroundColor: "var(--panel-muted)" }}>
      <div className={row} style={{ color: "var(--text-main)" }}>
        <span>{hasGst ? "Price (excl GST)" : "Quote total"}</span>
        <span className="tabular-nums">{money(priceBeforeGst)}</span>
      </div>
      <div className={row} style={{ color: "var(--danger-strong)" }}>
        <span>Discount{shownPercent !== null && amountOff !== null ? ` (${shownPercent}%)` : ""}</span>
        <span className="tabular-nums">{discount !== null ? `−${money(discount)}` : "—"}</span>
      </div>
      {hasGst ? (
        <div className={row} style={{ color: "var(--text-muted)" }}>
          <span>Plus GST ({Number(gstPercent.toFixed(2))}%)</span>
          <span className="tabular-nums">{gstAfter !== null ? `+${money(gstAfter)}` : "—"}</span>
        </div>
      ) : null}
      <div
        className="flex items-center justify-between gap-3 border-t pt-1.5 text-[14px] font-semibold"
        style={{ borderColor: "var(--glass-border)", color: "var(--text-main)" }}
      >
        <span>New total{hasGst ? " (incl GST)" : ""}</span>
        <span className="tabular-nums">{newTotal !== null ? money(newTotal) : "—"}</span>
      </div>
      <p className="text-right text-[11.5px] font-medium" style={{ color: "var(--text-muted)" }}>
        was {money(originalTotal)}
      </p>
    </div>
  );
}

// New total / Amount off / Percent off, the box to type it in, and what it comes to.
function DiscountEntry({
  originalTotal,
  gstPercent,
  mode,
  value,
  onMode,
  onValue,
  onEnter,
}: {
  originalTotal: number;
  gstPercent: number;
  mode: QuoteDiscountMode;
  value: string;
  onMode: (mode: QuoteDiscountMode) => void;
  onValue: (value: string) => void;
  onEnter?: () => void;
}) {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const figures = value.trim() ? quoteDiscountFigures(originalTotal, gstPercent, mode, value) : null;
  const invalid = Boolean(value.trim()) && !figures;
  return (
    <div className="space-y-3">
      <div className="flex rounded-full border p-0.5" style={{ borderColor: "var(--glass-border)", backgroundColor: "var(--panel-muted)" }} role="radiogroup" aria-label="Discount by">
        {QUOTE_DISCOUNT_MODES.map((option) => {
          const on = option.id === mode;
          return (
            <button
              key={option.id}
              type="button"
              role="radio"
              aria-checked={on}
              onClick={() => {
                onMode(option.id);
                inputRef.current?.focus();
              }}
              className="h-8 flex-1 rounded-full text-[12.5px] font-medium transition max-lg:h-10 max-lg:text-[13.5px]"
              style={on ? { backgroundColor: "var(--panel-bg)", color: "var(--text-main)", boxShadow: "0 1px 3px rgba(15,23,42,0.12)" } : { color: "var(--text-muted)" }}
            >
              {option.label}
            </button>
          );
        })}
      </div>
      <label className="block">
        <span className="sr-only">{QUOTE_DISCOUNT_MODES.find((option) => option.id === mode)?.label}</span>
        <div className="relative">
          <input
            ref={inputRef}
            autoFocus
            inputMode="decimal"
            value={value}
            onChange={(event) => onValue(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") onEnter?.();
            }}
            placeholder={mode === "percent" ? "10" : activeMoney(0)}
            className="h-10 w-full rounded-[10px] border px-3 pr-9 text-[14px] font-medium outline-none transition-colors focus:border-[var(--brand)] max-lg:h-11 max-lg:text-[15px]"
            style={{ borderColor: invalid ? "var(--danger-strong)" : "var(--glass-border)", backgroundColor: "var(--panel-bg)", color: "var(--text-main)" }}
          />
          {mode === "percent" ? (
            <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-[14px] font-medium" style={{ color: "var(--text-muted)" }}>
              %
            </span>
          ) : null}
        </div>
      </label>
      <QuoteDiscountFigureRows
        originalTotal={originalTotal}
        amountOff={figures?.amountOff ?? null}
        amountOffBeforeGst={figures?.amountOffBeforeGst ?? null}
        gstPercent={gstPercent}
        newTotal={figures?.newTotal ?? null}
        percent={figures?.percent ?? null}
      />
      {invalid ? (
        <p className="text-[12px] font-medium" style={{ color: "var(--danger-strong)" }}>
          It has to take something off, and less than the whole total.
        </p>
      ) : null}
    </div>
  );
}

function useEscape(onEscape: () => void) {
  const ref = useRef(onEscape);
  useEffect(() => {
    ref.current = onEscape;
  });
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") ref.current();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
}

// Request Discount (staff on their own project) / Add Discount (sales.discount): how much, then Send request / Add.
export function QuoteDiscountPrompt({
  kind,
  originalTotal,
  gstPercent,
  sending,
  error,
  onSubmit,
  onClose,
}: {
  kind: "request" | "add";
  originalTotal: number;
  gstPercent: number;
  sending: boolean;
  error: string;
  onSubmit: (mode: QuoteDiscountMode, value: string) => void;
  onClose: () => void;
}) {
  const [mode, setMode] = useState<QuoteDiscountMode>("total");
  const [value, setValue] = useState("");
  useEscape(onClose);
  const figures = value.trim() ? quoteDiscountFigures(originalTotal, gstPercent, mode, value) : null;
  const submit = () => {
    if (figures && !sending) onSubmit(mode, value);
  };
  if (typeof document === "undefined") return null;
  return createPortal(
    <div className="fixed inset-0 z-[2147483646] flex items-center justify-center px-4">
      <button type="button" aria-label="Close" onClick={onClose} className="glass-modal-backdrop absolute inset-0" />
      <div role="dialog" aria-modal="true" aria-label={kind === "add" ? "Add discount" : "Request discount"} className="glass-modal-panel relative z-[1] w-[min(440px,96vw)] overflow-hidden">
        <GlassModalHeader title={kind === "add" ? "Add discount" : "Request discount"} icon={<BadgePercent />} onClose={onClose} />
        <div className="space-y-3 px-5 py-4">
          <p className="text-[13px] font-medium leading-snug" style={{ color: "var(--text-muted)" }}>
            {kind === "add"
              ? "Takes it off the quote's total straight away. The client only ever sees the new total."
              : "Goes to whoever can answer discounts. The client only ever sees the new total, once it's accepted."}
          </p>
          <DiscountEntry originalTotal={originalTotal} gstPercent={gstPercent} mode={mode} value={value} onMode={setMode} onValue={setValue} onEnter={submit} />
          {error ? (
            <p role="alert" className="text-[12px] font-medium" style={{ color: "var(--danger-strong)" }}>
              {error}
            </p>
          ) : null}
          <div className="flex items-center justify-end gap-2 pt-1">
            <button type="button" onClick={onClose} className={NEUTRAL_BUTTON} style={NEUTRAL_STYLE}>
              Cancel
            </button>
            <button type="button" disabled={!figures || sending} onClick={submit} className={SHINE_BUTTON} style={glassShineStyle("var(--brand-strong)")}>
              {sending ? (kind === "add" ? "Adding..." : "Sending...") : kind === "add" ? "Add discount" : "Send request"}
            </button>
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}

// A request (to one who can answer it) or a counter offer (to who asked): what it comes to, Accept and Decline — and, for
// a request, Decline then offers a counter offer: send one, or just decline (closing it then is just declining too).
// Already answered: how.
export function QuoteDiscountAnswerBox({
  stage,
  personName,
  projectName,
  originalTotal,
  amountOff,
  amountOffBeforeGst,
  newTotal,
  percent,
  gstPercent,
  answer,
  answering,
  error,
  panelRef,
  onAccept,
  onDecline,
  onOpenProject,
  onClose,
  initialCountering = false,
}: {
  stage: "request" | "counter";
  personName: string;
  projectName?: string;
  originalTotal: number;
  amountOff: number;
  amountOffBeforeGst?: number;
  newTotal: number;
  percent?: number;
  gstPercent: number;
  answer?: QuoteDiscountAnswer;
  answering: "approve" | "deny" | "counter" | undefined;
  error: string;
  panelRef?: RefObject<HTMLDivElement | null>;
  onAccept: () => void;
  onDecline: (counter?: { mode: QuoteDiscountMode; value: string }) => void;
  onOpenProject?: () => void;
  onClose: () => void;
  // Opened from a notification's Decline: straight to the counter offer (send one, or just decline).
  initialCountering?: boolean;
}) {
  const [countering, setCountering] = useState(initialCountering && stage === "request");
  const [mode, setMode] = useState<QuoteDiscountMode>("total");
  const [value, setValue] = useState("");
  const canAnswer = !answer;
  // (Making a counter offer, closing it is declining without one.)
  const close = () => {
    if (countering && canAnswer && !answering) onDecline();
    else onClose();
  };
  useEscape(close);
  const counterFigures = value.trim() ? quoteDiscountFigures(originalTotal, gstPercent, mode, value) : null;
  const sendCounter = () => {
    if (counterFigures && !answering) onDecline({ mode, value });
  };
  if (typeof document === "undefined") return null;
  const asked =
    stage === "counter"
      ? `${personName || "Someone"} offered this instead${projectName ? ` on "${projectName}"` : ""}.`
      : `${personName || "Someone"} asked for a discount${projectName ? ` on "${projectName}"` : ""}.`;
  return createPortal(
    <div className="fixed inset-0 z-[2147483646] flex items-center justify-center px-4">
      <button type="button" aria-label="Close" onClick={close} className="glass-modal-backdrop absolute inset-0" />
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label={stage === "counter" ? "Counter offer" : "Discount request"}
        data-phone-keep-box="true"
        className="glass-modal-panel relative z-[1] w-[min(440px,96vw)] overflow-hidden"
      >
        <GlassModalHeader
          title={countering ? "Counter offer" : stage === "counter" ? "Counter offer" : "Discount request"}
          icon={<BadgePercent />}
          onClose={close}
          closeLabel={countering ? "Decline without a counter offer" : "Close"}
        />
        <div className="space-y-3 px-5 py-4">
          {countering ? (
            <>
              <p className="text-[13px] font-medium leading-snug" style={{ color: "var(--text-muted)" }}>
                Offer {personName || "them"} a different discount instead. Closing this declines it without one.
              </p>
              <DiscountEntry originalTotal={originalTotal} gstPercent={gstPercent} mode={mode} value={value} onMode={setMode} onValue={setValue} onEnter={sendCounter} />
            </>
          ) : (
            <>
              <p className="text-[14px] font-medium leading-snug max-lg:text-[15px]" style={{ color: "var(--text-main)" }}>
                {asked}
              </p>
              <QuoteDiscountFigureRows
                originalTotal={originalTotal}
                amountOff={amountOff}
                amountOffBeforeGst={amountOffBeforeGst}
                gstPercent={gstPercent}
                newTotal={newTotal}
                percent={percent}
              />
              {answer ? (
                <p className="text-[13px] font-medium max-lg:text-[14px]" style={{ color: "var(--text-main)" }}>
                  {quoteDiscountAnswerText(answer, money)}
                </p>
              ) : null}
            </>
          )}
          {error ? (
            <p role="alert" className="text-[12px] font-medium max-lg:text-[13px]" style={{ color: "var(--danger-strong)" }}>
              {error}
            </p>
          ) : null}
          <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
            {onOpenProject && !countering ? (
              <button
                type="button"
                onClick={onOpenProject}
                className="h-9 rounded-full px-1 text-[13px] font-medium hover:underline max-lg:h-11 max-lg:text-[14px]"
                style={{ color: "var(--text-muted)" }}
              >
                Open project
              </button>
            ) : (
              <span />
            )}
            {!canAnswer ? (
              <button type="button" onClick={onClose} className={NEUTRAL_BUTTON} style={NEUTRAL_STYLE}>
                Close
              </button>
            ) : countering ? (
              <div className="flex items-center gap-2">
                <button type="button" disabled={Boolean(answering)} onClick={() => onDecline()} className={NEUTRAL_BUTTON} style={NEUTRAL_STYLE}>
                  {answering === "deny" ? "Declining..." : "Just decline"}
                </button>
                <button
                  type="button"
                  disabled={!counterFigures || Boolean(answering)}
                  onClick={sendCounter}
                  className={SHINE_BUTTON}
                  style={glassShineStyle("var(--brand-strong)")}
                >
                  {answering === "counter" ? "Sending..." : "Send counter offer"}
                </button>
              </div>
            ) : (
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  disabled={Boolean(answering)}
                  onClick={() => (stage === "request" ? setCountering(true) : onDecline())}
                  className={NEUTRAL_BUTTON}
                  style={NEUTRAL_STYLE}
                >
                  {answering === "deny" ? "Declining..." : "Decline"}
                </button>
                <button type="button" disabled={Boolean(answering)} onClick={onAccept} className={SHINE_BUTTON} style={glassShineStyle("var(--brand-strong)")}>
                  {answering === "approve" ? "Accepting..." : "Accept"}
                </button>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}
