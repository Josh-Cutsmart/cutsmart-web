"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useRouter } from "next/navigation";
import { History } from "lucide-react";
import { GlassModalHeader } from "@/components/glass-modal-header";
import { ProjectEventsTimeline, type TimelineItem } from "@/components/project-timeline";
import { Skeleton, SkeletonGroup } from "@/components/skeleton";
import { authorizedFetch } from "@/lib/api-fetch";
import { fetchCompanyLeads, fetchGridVersions, type CompanyClientRow, type CompanyLeadRow } from "@/lib/firestore-data";
import { isPreviewMode } from "@/lib/preview-mode";
import type { Project } from "@/lib/types";
import { useGlassModalPopOrigin, type GlassModalOrigin } from "@/lib/use-glass-modal-pop-origin";

// A contact's timeline (the subtle Timeline button at the foot of their card — app/(staff)/(app)/contacts/page.tsx): every
// project, quote and lead they've had, along the same line as a project's Schedule (components/project-timeline.tsx) —
// each where it happened, as far apart as they are in time. A project at when it was made; a quote at when it was sent
// to them (and whether they accepted or declined it); a lead at when it came in. A card opens what it's for.
//
// Their projects are the contact's own record of them (its history); their quotes, each of those projects' sent ones;
// their leads (for someone who can see leads — the Leads page's rules), those with the same email or phone, or that
// became one of their projects.

type Kind = "project" | "quote" | "lead";
type ContactTimelineItem = TimelineItem & { kind: Kind; href: string; detail: string };

const DAY_MS = 24 * 60 * 60 * 1000;
const KINDS: Record<Kind, { name: string; color: string }> = {
  project: { name: "Project", color: "#2563EB" },
  quote: { name: "Quote", color: "#D97706" },
  lead: { name: "Lead", color: "#7C3AED" },
};

const str = (value: unknown) => String(value ?? "").trim();
const digits = (value: unknown) => str(value).replace(/\D+/g, "");
// Two phone numbers the same: their last 8 digits (so +64 21 … and 021 … match).
const samePhone = (a: unknown, b: unknown) => {
  const x = digits(a);
  const y = digits(b);
  return x.length >= 7 && y.length >= 7 && x.slice(-8) === y.slice(-8);
};
const sameEmail = (a: unknown, b: unknown) => Boolean(str(a)) && str(a).toLowerCase() === str(b).toLowerCase();
// A day, all day long (so its card reads as a date, not a time).
const dayItem = (iso: string) => {
  const ms = Date.parse(iso);
  if (!Number.isFinite(ms)) return null;
  const start = new Date(ms);
  start.setHours(0, 0, 0, 0);
  return { startMs: start.getTime(), endMs: start.getTime() + DAY_MS, allDay: true };
};

export function ContactTimelineModal({
  open,
  onClose,
  origin,
  contact,
  companyId,
  viewerUid,
  canSeeLeads,
  canViewOtherLeads,
}: {
  open: boolean;
  onClose: () => void;
  origin: GlassModalOrigin;
  contact: CompanyClientRow | null;
  companyId: string;
  viewerUid: string;
  canSeeLeads: boolean;
  canViewOtherLeads: boolean;
}) {
  const router = useRouter();
  const panelRef = useRef<HTMLDivElement | null>(null);
  const shouldRender = useGlassModalPopOrigin(open, origin, panelRef);
  // Their quotes and leads as looked up, with whose they are (another contact's, or none yet: still looking).
  const [quotesFound, setQuotes] = useState<{ key: string; items: ContactTimelineItem[] } | null>(null);
  const [leadsFound, setLeads] = useState<{ key: string; items: ContactTimelineItem[] } | null>(null);
  const contactKey = contact?.id ?? "";
  const quotes = quotesFound?.key === contactKey ? quotesFound.items : null;
  const leads = !canSeeLeads ? [] : leadsFound?.key === contactKey ? leadsFound.items : null;

  // Their projects: straight from the contact's own record of them.
  const projects = useMemo<ContactTimelineItem[]>(() => {
    if (!contact) return [];
    return contact.history.flatMap((row) => {
      const day = dayItem(row.createdAtIso);
      if (!day || !row.projectId) return [];
      const status = row.deleted ? "Deleted" : row.archived ? `${row.statusLabel || "Archived"} · archived` : row.statusLabel;
      return [
        {
          id: `project:${row.projectId}`,
          kind: "project" as const,
          title: row.projectName || "Project",
          ...day,
          href: row.deleted ? "" : `/projects/${encodeURIComponent(row.projectId)}`,
          detail: status ? `Project made · ${status}` : "Project made",
        },
      ];
    });
  }, [contact]);

  // Their quotes (each project's sent ones) and leads — looked up as it opens.
  useEffect(() => {
    if (!open || !contact || !companyId) return;
    let cancelled = false;
    const live = contact.history.filter((row) => row.projectId && !row.deleted);
    void Promise.all(
      live.map(async (row) => {
        const versions = await fetchGridVersions({ id: row.projectId, companyId } as Project, "quoteGridVersions").catch(() => []);
        return versions
          .filter((version) => version.sentToClient)
          .flatMap((version) => {
            const day = dayItem(version.savedAtIso);
            if (!day) return [];
            const outcome = version.acceptedAtIso
              ? `Accepted${version.acceptedByName ? ` by ${version.acceptedByName}` : ""}`
              : version.declinedAtIso
                ? `Declined${version.declinedByName ? ` by ${version.declinedByName}` : ""}`
                : "Sent — no answer yet";
            return [
              {
                id: `quote:${row.projectId}:${version.id}`,
                kind: "quote" as const,
                title: `${row.projectName || "Project"} — ${version.name || "Quote"}`,
                ...day,
                href: `/projects/${encodeURIComponent(row.projectId)}?tab=sales`,
                detail: outcome,
              },
            ];
          });
      }),
    ).then((lists) => {
      if (!cancelled) setQuotes({ key: contactKey, items: lists.flat() });
    });
    if (canSeeLeads) {
      void (async () => {
        let rows: CompanyLeadRow[] = [];
        try {
          if (isPreviewMode()) rows = await fetchCompanyLeads(companyId);
          else {
            const response = await authorizedFetch(`/api/leads?companyId=${encodeURIComponent(companyId)}&mode=summary`, { cache: "no-store" });
            const json = (await response.json().catch(() => null)) as { ok?: boolean; leads?: CompanyLeadRow[] } | null;
            rows = response.ok && json?.ok && Array.isArray(json.leads) ? json.leads : await fetchCompanyLeads(companyId);
          }
        } catch {
          rows = await fetchCompanyLeads(companyId).catch(() => []);
        }
        const projectIds = new Set(contact.history.map((row) => row.projectId));
        const theirs = rows
          .filter((lead) => !lead.isDeleted)
          // (As the Leads page: without "view others' leads", only their own.)
          .filter((lead) => canViewOtherLeads || str(lead.assignedToUid) === viewerUid)
          .filter(
            (lead) =>
              (lead.convertedProjectId && projectIds.has(lead.convertedProjectId)) ||
              sameEmail(lead.email, contact.email) ||
              samePhone(lead.phone, contact.phone),
          );
        const items = theirs.flatMap((lead) => {
          const day = dayItem(lead.submittedAtIso || lead.createdAtIso);
          if (!day) return [];
          return [
            {
              id: `lead:${lead.id}`,
              kind: "lead" as const,
              title: lead.name || lead.formName || "Lead",
              ...day,
              href: `/leads?lead=${encodeURIComponent(lead.id)}`,
              detail: lead.convertedProjectId ? "Lead · became a project" : `Lead · ${lead.status || "New"}`,
            },
          ];
        });
        if (!cancelled) setLeads({ key: contactKey, items });
      })();
    }
    return () => {
      cancelled = true;
    };
    // (Once each time it opens, for this contact.)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, contactKey, companyId, canSeeLeads, canViewOtherLeads, viewerUid]);

  if (!shouldRender || typeof document === "undefined") return null;
  const loaded = quotes !== null && leads !== null;
  const items = [...projects, ...(quotes ?? []), ...(leads ?? [])];
  const byId = new Map(items.map((item) => [item.id, item]));
  const counts = (["project", "quote", "lead"] as const).map((kind) => ({ kind, count: items.filter((item) => item.kind === kind).length }));

  return createPortal(
    <div className="glass-modal-backdrop fixed inset-0 z-[220] flex items-center justify-center p-4" onClick={onClose}>
      <div
        ref={panelRef}
        // (Part of the contact's card — a press in it isn't "off the contact": app/(staff)/(app)/contacts/page.tsx.)
        data-contact-timeline="true"
        className="glass-modal-panel flex max-h-[min(640px,calc(100svh-32px))] w-full max-w-[880px] flex-col overflow-hidden rounded-[22px]"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-label={`${contact?.name || "Contact"}'s timeline`}
      >
        <GlassModalHeader title="Timeline" icon={<History />} onClose={onClose} />
        <div className="glass-scroll min-h-0 flex-1 overflow-y-auto px-5 pb-2 pt-4">
          <p className="truncate text-[15px] font-medium" style={{ color: "var(--text-main)" }}>
            {contact?.name || "Contact"}
          </p>
          {/* What's on it, in their colours (how many of each). */}
          <div className="mb-3 mt-2 flex flex-wrap gap-2">
            {counts.map(({ kind, count }) => (
              <span
                key={kind}
                className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-[3px] text-[12px] font-medium"
                style={{ backgroundColor: `color-mix(in srgb, ${KINDS[kind].color} 14%, transparent)`, color: "var(--text-main)" }}
              >
                <span className="h-2 w-2 rounded-full" style={{ backgroundColor: KINDS[kind].color }} />
                {count} {KINDS[kind].name.toLowerCase()}
                {count === 1 ? "" : "s"}
              </span>
            ))}
          </div>
          {!loaded && !items.length ? (
            <SkeletonGroup label="Loading the timeline" className="py-6">
              <Skeleton className="h-[3px] w-full rounded-full" />
              <div className="mt-4 flex justify-between gap-3">
                {[0, 1, 2, 3].map((index) => (
                  <Skeleton key={index} className="h-12 w-[132px] rounded-[12px]" />
                ))}
              </div>
            </SkeletonGroup>
          ) : items.length ? (
            <ProjectEventsTimeline<ContactTimelineItem>
              events={items}
              collapsible={false}
              categoryOf={(item) => KINDS[item.kind]}
              detailOf={(item) => item.detail}
              openTitle="Open it"
              untitled="Untitled"
              onOpenEvent={(id) => {
                const item = byId.get(id);
                if (!item?.href) return;
                onClose();
                router.push(item.href);
              }}
            />
          ) : (
            <p className="rounded-[14px] border border-dashed border-[var(--glass-border)] px-4 py-8 text-center text-[13px] font-medium" style={{ color: "var(--text-main)" }}>
              Nothing yet — their projects, quotes and leads will show here.
            </p>
          )}
          {/* (Still looking up quotes or leads after the projects are on it.) */}
          {!loaded && items.length ? (
            <p className="pb-3 text-[12px] font-medium" style={{ color: "var(--text-muted)" }}>
              Finding their quotes and leads…
            </p>
          ) : null}
        </div>
      </div>
    </div>,
    document.body,
  );
}
