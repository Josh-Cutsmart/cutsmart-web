"use client";

import { useEffect, useRef, useState, type RefObject } from "react";
import { createPortal } from "react-dom";
import { Check, FileText, ListChecks, Mail, Phone, StickyNote, X } from "lucide-react";
import { modalCloseButtonClass } from "@/components/settings-ui";
import { CopyButton } from "@/components/copy-button";
import { authorizedFetch } from "@/lib/api-fetch";
import { activeDateTime } from "@/lib/company-formats";
import { fetchCompanyDoc, fetchCompanyLeadById, type CompanyLeadRow, type LeadNote } from "@/lib/firestore-data";
import { glassShineStyle } from "@/lib/glass-shine";
import { normalizeLeadForms } from "@/lib/lead-forms";
import {
  buildLeadProjectPrefill,
  getLeadDynamicFields,
  leadClientName,
  leadDetailFields,
  leadFieldLayoutFor,
  mergeLeadFieldLayout,
  normalizeLeadFieldLayout,
  normalizeLeadImageItems,
  resolveLeadColumnValue,
} from "@/lib/lead-project-prefill";
import type { ProjectChecklist } from "@/lib/types";
import { useGlassModalPopOrigin, type GlassModalOrigin } from "@/lib/use-glass-modal-pop-origin";
import { contrastTextForFill } from "@/lib/user-profile-format";
import { Skeleton } from "@/components/skeleton";
import { EmptyState } from "@/components/empty-state";

// The lead a project was made from (project.sourceLeadId — Leads › Create Project, or a column automation converting
// it), in its pop-up exactly as the Leads page lays it out — read only, the lead being archived once it became the
// project: its Checklists on its left and its Notes on its right (a wide enough screen; smaller, inside it, under its
// details), and in the middle its name and status, when and where it came in (and when it became the project), how to
// reach them, its photos, and its details (each answer beside its question). Opened from the project's General tab (its
// side tabs' Lead), growing out of that button, the page staying behind it.

type LeadView = {
  lead: CompanyLeadRow;
  statusColor: string;
  detailRows: Array<{ key: string; label: string; value: string }>;
  displayName: string;
  phone: string;
  email: string;
};

// A lead status's colour: the company's (Company Settings › Leads), else the Leads page's own defaults.
const DEFAULT_STATUS_COLORS: Record<string, string> = {
  new: "#3060D0",
  contacted: "#C77700",
  qualified: "#6B4FB3",
  converted: "#2A7A3B",
  archived: "#7F1D1D",
};

// The Leads page pop-up's white see-through boxes, and its status colour washed across it.
const BOX_STYLE = { borderColor: "var(--glass-border)", backgroundColor: "color-mix(in srgb, var(--panel-bg) 55%, transparent)" };
function tintStyle(color: string) {
  return {
    backgroundImage: [
      `radial-gradient(120% 70% at 0% 0%, color-mix(in srgb, ${color} 30%, transparent), transparent 70%)`,
      `radial-gradient(90% 60% at 100% 100%, color-mix(in srgb, ${color} 14%, transparent), transparent 70%)`,
      `linear-gradient(to bottom, color-mix(in srgb, ${color} 10%, transparent), color-mix(in srgb, ${color} 5%, transparent))`,
    ].join(", "),
  };
}

function sourceLabelOf(lead: CompanyLeadRow): string {
  const source = String(lead.source || "").trim();
  if (source === "web-form") return `Form: ${String(lead.formName || "").trim() || "Lead form"}`;
  if (source === "email") return "Leads email inbox";
  if (source === "manual") return `Added by hand${String(lead.sourceDetail || "").trim() ? ` — ${String(lead.sourceDetail).trim()}` : ""}`;
  return source && source !== "local-sample" ? "Zapier" : "";
}

// The lead, from the server (it reads archived leads too); else (the Preview, which has no server) as this browser has it.
async function loadLead(companyId: string, leadId: string): Promise<CompanyLeadRow | null> {
  const response = await authorizedFetch(
    `/api/leads?companyId=${encodeURIComponent(companyId)}&mode=detail&leadId=${encodeURIComponent(leadId)}`,
  ).catch(() => null);
  const json = (await response?.json().catch(() => null)) as { ok?: boolean; lead?: CompanyLeadRow } | null;
  if (response?.ok && json?.lead) return json.lead;
  return (await fetchCompanyLeadById(companyId, leadId)) ?? null;
}

const SECTION_TITLE = "text-[16px] font-semibold";

// Its checklists, ticked as they were.
function ChecklistsList({ checklists }: { checklists: ProjectChecklist[] }) {
  if (!checklists.length) {
    return <EmptyState compact className="pt-8" icon={<ListChecks size={16} />} title="No checklists on this lead" />;
  }
  return (
    <div className="space-y-2">
      {checklists.map((checklist) => {
        const done = checklist.items.filter((item) => item.checked).length;
        return (
          <div key={checklist.id} className="rounded-[14px] border px-3.5 py-2.5" style={BOX_STYLE}>
            <p className="flex items-center gap-2 text-[13.5px] font-semibold" style={{ color: "var(--text-main)" }}>
              <ListChecks size={14} className="shrink-0" />
              <span className="min-w-0 flex-1 truncate">{checklist.name}</span>
              <span className="shrink-0 text-[12px] font-medium">
                {done}/{checklist.items.length}
              </span>
            </p>
            <ul className="mt-1.5 space-y-1">
              {checklist.items.map((item) => (
                <li key={item.id} className="flex items-start gap-2 text-[13px] font-medium" style={{ color: "var(--text-main)" }}>
                  <span
                    className="mt-0.5 inline-flex h-4 w-4 shrink-0 items-center justify-center rounded-[5px] border"
                    style={
                      item.checked
                        ? { backgroundColor: "var(--brand)", borderColor: "var(--brand)", color: "#fff" }
                        : { borderColor: "var(--glass-border)", backgroundColor: "var(--panel-bg)" }
                    }
                  >
                    {item.checked ? <Check size={11} strokeWidth={3} /> : null}
                  </span>
                  <span className={item.checked ? "line-through opacity-70" : undefined}>{item.text}</span>
                </li>
              ))}
            </ul>
          </div>
        );
      })}
    </div>
  );
}

// Its notes, newest first — each with who wrote it and when.
function NotesList({ notes }: { notes: LeadNote[] }) {
  if (!notes.length) {
    return <EmptyState compact icon={<StickyNote size={16} />} title="No notes on this lead" hint="Notes written about this lead show here, newest first." />;
  }
  return (
    <div className="space-y-2">
      {[...notes].reverse().map((note) => (
        <div key={note.id} className="rounded-[14px] border px-3.5 py-2.5" style={BOX_STYLE}>
          <p className="whitespace-pre-wrap break-words text-[13.5px] font-medium" style={{ color: "var(--text-main)" }}>
            {note.text}
          </p>
          <p className="mt-1 text-[11.5px] font-medium" style={{ color: "var(--text-main)" }}>
            {note.createdByName || "A teammate"} · {activeDateTime(note.createdAtIso)}
          </p>
        </div>
      ))}
    </div>
  );
}

export function LeadDetailsModal({
  companyId,
  leadId,
  open,
  origin,
  originElRef,
  onClose,
}: {
  companyId: string;
  leadId: string;
  open: boolean;
  origin: GlassModalOrigin;
  originElRef?: RefObject<HTMLElement | null>;
  onClose: () => void;
}) {
  const panelRef = useRef<HTMLDivElement | null>(null);
  const shouldRender = useGlassModalPopOrigin(open, origin, panelRef, undefined, originElRef);
  const [view, setView] = useState<{ key: string; data: LeadView | null; failed: boolean } | null>(null);
  const viewKey = `${companyId}:${leadId}`;

  useEffect(() => {
    if (!open || !companyId || !leadId) return;
    let cancelled = false;
    void Promise.all([loadLead(companyId, leadId), fetchCompanyDoc(companyId).catch(() => null)]).then(([lead, companyDoc]) => {
      if (cancelled) return;
      if (!lead) {
        setView({ key: viewKey, data: null, failed: true });
        return;
      }
      // Laid out as the Leads page lays it out (its form's questions, the email inbox's, else the Zapier lead fields).
      const formsById = new Map(normalizeLeadForms(companyDoc?.leadForms).map((form) => [form.id, form] as const));
      const zapierLayout = normalizeLeadFieldLayout(
        ((companyDoc?.integrations as Record<string, unknown> | undefined)?.zapierLeads as Record<string, unknown> | undefined)?.fieldLayout,
      );
      const fields = getLeadDynamicFields(lead);
      const layout = leadFieldLayoutFor(lead, formsById, mergeLeadFieldLayout(fields.map((field) => ({ key: field.key, label: field.label })), zapierLayout));
      const statuses = Array.isArray(companyDoc?.leadStatuses) ? (companyDoc.leadStatuses as Array<Record<string, unknown>>) : [];
      const status = String(lead.status || "New").trim();
      const statusColor =
        String(statuses.find((row) => String(row?.name ?? "").trim().toLowerCase() === status.toLowerCase())?.color ?? "").trim() ||
        DEFAULT_STATUS_COLORS[status.toLowerCase()] ||
        "#64748B";
      const contact = buildLeadProjectPrefill(lead, layout);
      setView({
        key: viewKey,
        failed: false,
        data: {
          lead,
          statusColor,
          detailRows: leadDetailFields(layout).map((column) => ({ key: column.key, label: column.label, value: resolveLeadColumnValue(fields, column, layout) })),
          displayName: leadClientName(fields, layout) || lead.name || lead.email || lead.phone || "Lead",
          phone: String(contact.clientPhone || "").trim(),
          email: String(contact.clientEmail || "").trim(),
        },
      });
    });
    return () => {
      cancelled = true;
    };
  }, [companyId, leadId, open, viewKey]);

  // Escape closes it.
  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [onClose, open]);

  if (!shouldRender || typeof document === "undefined") return null;
  const current = view?.key === viewKey ? view : null;
  const data = current?.data ?? null;
  const lead = data?.lead;
  const receivedIso = lead ? lead.createdAtIso || lead.submittedAtIso || "" : "";
  const sourceLabel = lead ? sourceLabelOf(lead) : "";
  const photos = lead ? normalizeLeadImageItems(lead) : [];
  const notes = lead?.notes ?? [];
  const checklists = lead?.checklists ?? [];
  const tint = tintStyle(data?.statusColor ?? "#64748B");

  return createPortal(
    <div className="glass-modal-backdrop fixed inset-0 z-[1600] flex items-center justify-center px-4 py-4 max-sm:p-0" onClick={onClose}>
      {/* The pop-up, with its Checklists on its left and its Notes on its right — panels of the same look (a wide enough
          screen; smaller, they're inside it, under its details): all three open and close together. */}
      <div ref={panelRef} onClick={(e) => e.stopPropagation()} className="flex items-stretch gap-3 max-sm:h-full max-sm:w-full">
        <aside className="glass-modal-panel relative isolate hidden min-h-[440px] w-[320px] shrink-0 overflow-hidden xl:block" aria-label="Lead checklists">
          <div aria-hidden="true" className="pointer-events-none absolute inset-0 -z-10" style={tint} />
          <div className="absolute inset-0 flex flex-col">
            <p className={`shrink-0 px-5 pb-3 pt-5 ${SECTION_TITLE}`} style={{ color: "var(--text-main)" }}>
              Checklists
            </p>
            <div className="glass-scroll min-h-0 flex-1 overflow-y-auto px-5 pb-5">{data ? <ChecklistsList checklists={checklists} /> : null}</div>
          </div>
        </aside>
        <div
          role="dialog"
          aria-modal="true"
          aria-label="Lead"
          data-phone-fullscreen="true"
          className="glass-modal-panel relative isolate flex max-h-[min(720px,90vh)] w-[min(560px,96vw)] flex-col overflow-hidden max-sm:h-full max-sm:max-h-none max-sm:w-full max-sm:rounded-none! max-sm:border-0!"
        >
          <div aria-hidden="true" className="pointer-events-none absolute inset-0 -z-10" style={tint} />
          <div className="relative shrink-0 px-5 pb-3 pt-5 max-sm:pt-[calc(1.25rem+env(safe-area-inset-top))]">
            <button
              type="button"
              onClick={onClose}
              className={`${modalCloseButtonClass} absolute right-3 top-3 max-sm:top-[calc(0.75rem+env(safe-area-inset-top))]`}
              aria-label="Close lead"
            >
              <X size={16} />
            </button>
            <div className="flex items-start justify-between gap-3 pr-10">
              <h2 className="min-w-0 flex-1 pt-0.5 text-left text-[22px] font-semibold leading-tight" style={{ color: "var(--text-main)" }}>
                {data?.displayName ?? (current?.failed ? "Lead not found" : <Skeleton className="mt-1 h-6 w-48 rounded-[8px]" />)}
              </h2>
              {data ? (
                <span
                  className="glass-shine inline-flex h-9 shrink-0 items-center rounded-full border px-3 text-[12px] font-bold"
                  style={glassShineStyle(data.statusColor, { color: contrastTextForFill(data.statusColor, 0.75) })}
                >
                  {String(lead?.status || "New")}
                </span>
              ) : null}
            </div>
            {lead && (receivedIso || sourceLabel || lead.convertedAtIso) ? (
              <p className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[12.5px] font-medium" style={{ color: "var(--text-main)" }}>
                {receivedIso ? <span>Came in {activeDateTime(receivedIso)}</span> : null}
                {receivedIso && sourceLabel ? <span aria-hidden="true">·</span> : null}
                {sourceLabel ? <span>{sourceLabel}</span> : null}
                {lead.convertedAtIso ? (
                  <>
                    <span aria-hidden="true">·</span>
                    <span>Became this project {activeDateTime(lead.convertedAtIso)}</span>
                  </>
                ) : null}
              </p>
            ) : null}
            {data && (data.phone || data.email) ? (
              <div className="mt-3 flex flex-wrap gap-2">
                {data.phone ? (
                  // (The pill calls them; the copy beside it copies the number.)
                  <span className="inline-flex min-w-0 max-w-full items-center gap-0.5">
                  <a
                    href={`tel:${data.phone.replace(/[^\d+]/g, "")}`}
                    className="inline-flex h-9 min-w-0 items-center gap-1.5 rounded-full border px-3.5 text-[13px] font-medium transition hover:brightness-95"
                    style={{ ...BOX_STYLE, color: "var(--text-main)" }}
                    title={`Call ${data.phone}`}
                  >
                    <Phone size={14} className="shrink-0" style={{ color: "var(--brand-strong)" }} />
                    <span className="truncate">{data.phone}</span>
                  </a>
                  <CopyButton value={data.phone} label="phone number" />
                  </span>
                ) : null}
                {data.email ? (
                  <span className="inline-flex min-w-0 max-w-full items-center gap-0.5">
                  <a
                    href={`mailto:${data.email}`}
                    className="inline-flex h-9 min-w-0 max-w-full items-center gap-1.5 rounded-full border px-3.5 text-[13px] font-medium transition hover:brightness-95"
                    style={{ ...BOX_STYLE, color: "var(--text-main)" }}
                    title={`Email ${data.email}`}
                  >
                    <Mail size={14} className="shrink-0" style={{ color: "var(--brand-strong)" }} />
                    <span className="truncate">{data.email}</span>
                  </a>
                  <CopyButton value={data.email} label="email" />
                  </span>
                ) : null}
              </div>
            ) : null}
          </div>
          {photos.length ? (
            <div className="shrink-0 px-5 pb-3">
              <div className="hide-native-scrollbar flex h-[88px] gap-2 overflow-x-auto overflow-y-hidden">
                {photos.map((item, index) => (
                  <a
                    key={`${item.url}_${index}`}
                    href={item.url}
                    target="_blank"
                    rel="noreferrer"
                    className="aspect-[4/3] h-full shrink-0 overflow-hidden rounded-[12px] border transition hover:brightness-95"
                    style={BOX_STYLE}
                    title={item.name || `Photo ${index + 1}`}
                  >
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={item.url} alt="" loading="lazy" className="h-full w-full object-cover" />
                  </a>
                ))}
              </div>
            </div>
          ) : null}
          <div className="glass-scroll min-h-0 flex-1 overflow-y-auto px-5 pb-5">
            {current?.failed ? (
              <p className="rounded-[14px] border px-4 py-6 text-center text-[13px] font-medium" style={{ ...BOX_STYLE, color: "var(--text-main)" }}>
                This project&apos;s lead couldn&apos;t be found — it may have been deleted for good.
              </p>
            ) : null}
            {data ? (
              <section aria-label="Lead details">
                <p className={`mb-2 ${SECTION_TITLE}`} style={{ color: "var(--text-main)" }}>
                  Details
                </p>
                {data.detailRows.length ? (
                  <div className="overflow-hidden rounded-[14px] border" style={BOX_STYLE}>
                    {data.detailRows.map((row) => (
                      <div
                        key={row.key}
                        className="grid gap-0.5 border-t px-3.5 py-2.5 first:border-t-0 sm:grid-cols-[136px_minmax(0,1fr)] sm:gap-3"
                        style={{ borderTopColor: "var(--glass-border)" }}
                      >
                        <p className="text-[12.5px] font-medium leading-5" style={{ color: "var(--text-main)" }}>
                          {row.label}
                        </p>
                        <p className="min-h-5 whitespace-pre-wrap break-words text-[14px] font-medium leading-5" style={{ color: "var(--text-main)" }}>
                          {row.value}
                        </p>
                      </div>
                    ))}
                  </div>
                ) : (
                  <EmptyState compact icon={<FileText size={16} />} title="No details on this lead" />
                )}
              </section>
            ) : null}
            {/* Smaller than a wide screen: its Checklists and Notes here, under its details. */}
            {data ? (
              <div className="mt-5 space-y-5 xl:hidden">
                <section aria-label="Lead checklists">
                  <p className={`mb-2 ${SECTION_TITLE}`} style={{ color: "var(--text-main)" }}>
                    Checklists
                  </p>
                  <ChecklistsList checklists={checklists} />
                </section>
                <section aria-label="Lead notes">
                  <p className={`mb-2 ${SECTION_TITLE}`} style={{ color: "var(--text-main)" }}>
                    Notes
                  </p>
                  <NotesList notes={notes} />
                </section>
              </div>
            ) : null}
          </div>
        </div>
        <aside className="glass-modal-panel relative isolate hidden min-h-[440px] w-[320px] shrink-0 overflow-hidden xl:block" aria-label="Lead notes">
          <div aria-hidden="true" className="pointer-events-none absolute inset-0 -z-10" style={tint} />
          <div className="absolute inset-0 flex flex-col">
            <p className={`shrink-0 px-5 pb-3 pt-5 ${SECTION_TITLE}`} style={{ color: "var(--text-main)" }}>
              Notes
            </p>
            <div className="glass-scroll min-h-0 flex-1 overflow-y-auto px-5 pb-5">{data ? <NotesList notes={notes} /> : null}</div>
          </div>
        </aside>
      </div>
    </div>,
    document.body,
  );
}
