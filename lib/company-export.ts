// Company Settings › Backup & Output › Full data export: everything the company has, in one JSON file to keep — its
// settings (the company document), its staff, contacts, leads, calendar events, the completed-projects record, its
// yearly figures, and every project with all that's kept under it (quote and specifications versions, comparisons,
// cutlists, checklists, sales grids, photos and files lists). Read from here, as its owner or an admin sees them (the
// database's company-member rules). Not in it: join invites (short-lived codes), and the files themselves (photos and
// documents are listed by their links). Dates come out as ISO text.

import { db } from "@/lib/firebase";
import { collection, doc, getDoc, getDocs } from "@/lib/firestore-client";

// Under the company, each one's own list.
const COMPANY_COLLECTIONS = ["memberships", "clients", "leads", "calendarEvents", "completedProjects", "companyStats"] as const;
// Under each project.
const PROJECT_COLLECTIONS = [
  "quoteGridVersions",
  "specificationsVersions",
  "productComparisons",
  "cutlistData",
  "checklists",
  "salesGrids",
  "projectMedia",
] as const;

type ExportedDoc = { id: string; data: unknown; collections?: Record<string, ExportedDoc[]> };
export type CompanyExportProgress = { step: string; done: number; total: number };

// A Firestore value as plain JSON: Timestamps as ISO text, references as their path, the rest as it is.
function plain(value: unknown): unknown {
  if (value === null || value === undefined) return value ?? null;
  if (Array.isArray(value)) return value.map(plain);
  if (typeof value === "object") {
    const v = value as { toDate?: () => Date; path?: string; latitude?: number; longitude?: number };
    if (typeof v.toDate === "function") {
      try {
        return v.toDate().toISOString();
      } catch {
        return null;
      }
    }
    if (typeof v.path === "string" && "firestore" in (value as object)) return v.path;
    const out: Record<string, unknown> = {};
    for (const [key, inner] of Object.entries(value as Record<string, unknown>)) out[key] = plain(inner);
    return out;
  }
  return value;
}

async function readCollection(path: string[]): Promise<ExportedDoc[]> {
  if (!db) return [];
  try {
    const snap = await getDocs(collection(db, path[0], ...path.slice(1)));
    return snap.docs.map((d) => ({ id: d.id, data: plain(d.data()) }));
  } catch {
    // Not readable (or not there): left out.
    return [];
  }
}

// Everything, as one object (and how far it's got, as it goes).
export async function buildCompanyExport(companyId: string, onProgress?: (progress: CompanyExportProgress) => void) {
  const cid = String(companyId || "").trim();
  if (!db || !cid) throw new Error("No company");
  const report = (step: string, done = 0, total = 0) => onProgress?.({ step, done, total });

  report("Company settings");
  const companySnap = await getDoc(doc(db, "companies", cid));
  const company = companySnap.exists() ? plain(companySnap.data()) : null;

  const collections: Record<string, ExportedDoc[]> = {};
  for (const name of COMPANY_COLLECTIONS) {
    report(name);
    collections[name] = await readCollection(["companies", cid, name]);
  }
  // The yearly figures' per-project contributions.
  for (const year of collections.companyStats ?? []) {
    year.collections = { projectContributions: await readCollection(["companies", cid, "companyStats", year.id, "projectContributions"]) };
  }

  const projects = await readCollection(["companies", cid, "jobs"]);
  for (let index = 0; index < projects.length; index += 1) {
    const project = projects[index];
    report("Projects", index, projects.length);
    const under: Record<string, ExportedDoc[]> = {};
    for (const name of PROJECT_COLLECTIONS) {
      const rows = await readCollection(["companies", cid, "jobs", project.id, name]);
      if (rows.length) under[name] = rows;
    }
    if (Object.keys(under).length) project.collections = under;
  }
  collections.jobs = projects;
  report("Projects", projects.length, projects.length);

  return {
    app: "CutSmart",
    kind: "company-export",
    version: 1,
    companyId: cid,
    exportedAtIso: new Date().toISOString(),
    counts: Object.fromEntries(Object.entries(collections).map(([name, rows]) => [name, rows.length])),
    company,
    collections,
  };
}

// The export, saved as a file: cutsmart-<company>-export-<date>.json.
export async function downloadCompanyExport(companyId: string, companyName: string, onProgress?: (progress: CompanyExportProgress) => void) {
  const data = await buildCompanyExport(companyId, onProgress);
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
  const slug = String(companyName || "company").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "company";
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `cutsmart-${slug}-export-${new Date().toISOString().slice(0, 10)}.json`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 2000);
  return data.counts;
}
