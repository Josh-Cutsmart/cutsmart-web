// Small Jobs (the sidebar's /small-jobs): quick jobs for old clients and small fixes — "Replace toekick", "Change
// hinges" — that don't need a whole project. Each is a project like any other (companies/{companyId}/jobs), flagged
// isSmallJob: its page just the project's title bar, its client details, notes and images; kept off the Dashboard and
// out of Reports; with statuses of its own (Company Settings › Small Jobs — Open and Closed to start with). One can be
// turned into a full project later (convertSmallJobToProject in lib/firestore-data.ts).

import type { GlassModalOrigin } from "@/lib/use-glass-modal-pop-origin";

export type SmallJobStatus = { name: string; color: string };

// Small Jobs' own colour: its title bar, and New Small Job (the New Project pop-up's Small Job switch).
export const SMALL_JOB_COLOR = "#EA580C";

export const DEFAULT_SMALL_JOB_STATUSES: SmallJobStatus[] = [
  { name: "Open", color: "#16A34A" },
  { name: "Closed", color: "#DC2626" },
];

// A company's small-job statuses (its doc's smallJobStatuses), in order — Open and Closed when it hasn't set any.
export function normalizeSmallJobStatuses(raw: unknown): SmallJobStatus[] {
  const rows = Array.isArray(raw)
    ? raw
        .filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === "object")
        .map((row) => ({ name: String(row.name ?? "").trim(), color: String(row.color ?? "").trim() || "#64748B" }))
        .filter((row) => row.name)
    : [];
  return rows.length ? rows : DEFAULT_SMALL_JOB_STATUSES;
}

// Opens the New Project pop-up as a New Small Job (components/app-shell.tsx) — the same window event as the Dashboard's
// New Project, with smallJob set. `origin`: the button pressed (captureGlassModalOrigin), for the pop-up to grow out of
// it and back into it.
export const NEW_PROJECT_EVENT = "cutsmart:new-project";
export function openNewSmallJob(origin: GlassModalOrigin = null) {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent(NEW_PROJECT_EVENT, { detail: { origin, smallJob: true } }));
}
