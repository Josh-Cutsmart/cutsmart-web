"use client";

// A contact's card as a pop-up — opened from a project's client details (the initials badge) without leaving the
// project. The Contacts page's card at a glance: the initials badge in the contact's category colour, their name and
// category, Call / Text / Email and Maps, and their details; Open in Contacts for everything else (editing, their
// projects, sharing).

import { useRef, type CSSProperties, type RefObject } from "react";
import { createPortal } from "react-dom";
import { ExternalLink, Mail, MapPin, MessageSquare, Phone, X } from "lucide-react";
import { GlassActionMenu, type GlassActionMenuItem } from "@/components/glass-dropdown";
import { modalCloseButtonClass, secondaryButtonClass } from "@/components/settings-ui";
import { collectContactReach, contactInitials, openAddressInMaps, readableTextOn } from "@/lib/contact-card";
import type { CompanyClientRow } from "@/lib/firestore-data";
import { useGlassModalPopOrigin, type GlassModalOrigin } from "@/lib/use-glass-modal-pop-origin";

const roundButtonClass =
  "glass-nav-arrow inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-full transition hover:brightness-95 disabled:opacity-40";
// Each detail in a white see-through box (the lead and Calendar event pop-ups').
const boxStyle: CSSProperties = {
  borderColor: "var(--glass-border)",
  backgroundColor: "color-mix(in srgb, var(--panel-bg) 55%, transparent)",
};

function mix(color: string, percent: number) {
  return `color-mix(in srgb, ${color} ${percent}%, transparent)`;
}

export function ContactCardPopup({
  contact,
  open,
  onClose,
  origin,
  originElRef,
  categoryColor,
  onOpenInContacts,
}: {
  contact: CompanyClientRow | null;
  open: boolean;
  onClose: () => void;
  // Where it grows out of (and goes back into) — the badge that opened it.
  origin: GlassModalOrigin;
  originElRef: RefObject<HTMLElement | null>;
  categoryColor: string;
  // Open the full card on the Contacts page — left out when this contact has no card of its own there yet.
  onOpenInContacts?: () => void;
}) {
  const panelRef = useRef<HTMLDivElement | null>(null);
  const shouldRender = useGlassModalPopOrigin(open, origin, panelRef, undefined, originElRef);
  if (!shouldRender || !contact || typeof document === "undefined") return null;

  const reach = (field: "phone" | "email", scheme: "tel" | "sms" | "mailto"): GlassActionMenuItem[] =>
    collectContactReach(contact, field).map((option) => ({
      key: option.key,
      label: option.name,
      detail: option.value,
      onSelect: () => {
        window.location.href = `${scheme}:${scheme === "mailto" ? option.value : option.value.replace(/[^\d+]/g, "")}`;
      },
    }));
  const callItems = reach("phone", "tel");
  const textItems = reach("phone", "sms");
  const emailItems = reach("email", "mailto");
  const details = [
    { label: "Phone", value: contact.phone },
    { label: "Email", value: contact.email },
    { label: "Address", value: contact.address },
    { label: "Notes", value: contact.notes },
  ].filter((row) => String(row.value || "").trim());

  return createPortal(
    <div className="glass-modal-backdrop fixed inset-0 z-[1700] flex items-center justify-center px-4 py-4" onClick={onClose}>
      <div
        ref={panelRef}
        onClick={(e) => e.stopPropagation()}
        className="glass-modal-panel relative isolate flex max-h-[min(720px,90vh)] w-[min(420px,96vw)] flex-col overflow-hidden"
        role="dialog"
        aria-label={`${contact.name || "Contact"} — contact card`}
      >
        {/* The contact's category colour washed across it, as on the Contacts page. */}
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-0 -z-10"
          style={{
            backgroundImage: [
              `radial-gradient(380px 300px at 50% 60px, ${mix(categoryColor, 26)}, transparent 100%)`,
              `linear-gradient(to bottom, ${mix(categoryColor, 12)}, ${mix(categoryColor, 5)})`,
            ].join(", "),
          }}
        />
        <button type="button" onClick={onClose} className={`${modalCloseButtonClass} absolute right-3 top-3 z-[1]`} aria-label="Close contact card">
          <X size={16} />
        </button>
        <div className="glass-scroll min-h-0 flex-1 overflow-y-auto px-5 pb-5 pt-7">
          <div className="flex flex-col items-center text-center">
            <span
              className="inline-flex h-20 w-20 items-center justify-center rounded-full text-[28px] font-medium leading-none"
              style={{
                background: `linear-gradient(145deg, color-mix(in srgb, ${categoryColor} 78%, white), ${categoryColor})`,
                color: readableTextOn(categoryColor),
                border: "1px solid rgba(255,255,255,0.4)",
                boxShadow: `0 10px 26px ${mix(categoryColor, 30)}, inset 0 1px 0 rgba(255,255,255,0.5)`,
              }}
            >
              {contactInitials(contact.name, contact.email)}
            </span>
            <p className="mt-3 max-w-full truncate text-[22px] font-medium leading-tight" style={{ color: "var(--text-main)" }}>
              {contact.name || "Contact"}
            </p>
            {contact.category ? (
              <span
                className="mt-1.5 inline-flex items-center rounded-full border px-3 py-0.5 text-[12px] font-medium"
                style={{ borderColor: mix(categoryColor, 45), backgroundColor: mix(categoryColor, 16), color: "var(--text-main)" }}
              >
                {contact.category}
              </span>
            ) : null}
            <div className="mt-4 flex items-center justify-center gap-3">
              <GlassActionMenu items={callItems} ariaLabel="Call" triggerClassName={roundButtonClass} menuMinWidth={300}>
                <Phone size={18} />
              </GlassActionMenu>
              <GlassActionMenu items={textItems} ariaLabel="Text" triggerClassName={roundButtonClass} menuMinWidth={300}>
                <MessageSquare size={18} />
              </GlassActionMenu>
              <GlassActionMenu items={emailItems} ariaLabel="Email" triggerClassName={roundButtonClass} menuMinWidth={320}>
                <Mail size={18} />
              </GlassActionMenu>
              <button
                type="button"
                onClick={() => openAddressInMaps(contact.address)}
                disabled={!String(contact.address || "").trim()}
                className={roundButtonClass}
                aria-label="Open address in Maps"
                title="Open address in Maps"
              >
                <MapPin size={18} />
              </button>
            </div>
          </div>
          <div className="mt-5 space-y-2">
            {details.length === 0 ? (
              <p className="text-center text-[13px] font-medium" style={{ color: "var(--text-main)" }}>
                No contact details yet.
              </p>
            ) : (
              details.map((row) => (
                <div key={row.label} className="rounded-[14px] border px-3 py-2.5" style={boxStyle}>
                  <p className="text-[11.5px] font-medium" style={{ color: "var(--text-main)" }}>
                    {row.label}
                  </p>
                  <p className="mt-0.5 select-text whitespace-pre-wrap break-words text-[14px] font-medium" style={{ color: "var(--text-main)" }}>
                    {row.value}
                  </p>
                </div>
              ))
            )}
          </div>
          {onOpenInContacts ? (
            <div className="mt-4 flex justify-center">
              <button type="button" onClick={onOpenInContacts} className={secondaryButtonClass}>
                <ExternalLink size={14} /> Open in Contacts
              </button>
            </div>
          ) : null}
        </div>
      </div>
    </div>,
    document.body,
  );
}
