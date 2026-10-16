// A contact card's pieces shared by the Contacts page and the contact pop-up on a project
// (components/contact-card-popup.tsx): the initials badge, the text colour on it, every number and email held for
// the contact, and opening their address in a maps app.

import type { CompanyClientRow } from "@/lib/firestore-data";

export function lettersOnly(text: string) {
  return Array.from(text)
    .filter((ch) => /\p{L}/u.test(ch))
    .join("");
}

export function contactInitials(name: string, email: string) {
  const words = String(name || "")
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  let initials = "";
  if (words.length >= 2) initials = lettersOnly(`${words[0].charAt(0)}${words[words.length - 1].charAt(0)}`);
  else if (words.length === 1) initials = lettersOnly(words[0].slice(0, 2));
  if (initials) return initials.toUpperCase();
  // None there: the name's first letter anywhere in it, else the email's.
  const fallback = lettersOnly(String(name || "")).charAt(0) || lettersOnly(String(email || "")).charAt(0);
  return fallback ? fallback.toUpperCase() : "?";
}

// Dark text on a light category colour, white on a dark one, so the big initials stay legible.
export function readableTextOn(color: string) {
  const match = /^#?([0-9a-f]{6})$/i.exec(color.trim());
  if (!match) return "#FFFFFF";
  const value = parseInt(match[1], 16);
  const r = (value >> 16) & 255;
  const g = (value >> 8) & 255;
  const b = value & 255;
  const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  return luminance > 0.62 ? "#0F172A" : "#FFFFFF";
}

export type ContactReachOption = { key: string; name: string; value: string };

// Every distinct phone number / email we hold for a contact, each tagged with who it belongs to: the
// contact's own details first, then whatever each of their projects was entered with (a household or
// company often has a different person's number or email on different projects). Junk placeholders
// ("-", "345", "hjk") are skipped so they don't become options.
export function collectContactReach(contact: CompanyClientRow, field: "phone" | "email"): ContactReachOption[] {
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
  for (const row of contact.history ?? []) {
    add(row.customer, field === "phone" ? row.clientPhone : row.clientEmail);
  }
  return options;
}

// Opens an address in the device's own maps app: Apple Maps on iPhone/iPad, the default maps app via a
// geo: link on Android (the system picks/offers the installed app), and Google Maps in a new tab elsewhere.
export function openAddressInMaps(address: string) {
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
