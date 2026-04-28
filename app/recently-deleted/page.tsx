"use client";

import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Check, RotateCcw, Search, Trash2 } from "lucide-react";
import { AppShell } from "@/components/app-shell";
import { ProtectedRoute } from "@/components/protected-route";
import { useAuth } from "@/lib/auth-context";
import {
  fetchCompanyDoc,
  fetchDeletedProjects,
  fetchUserColorMapByUids,
  permanentlyDeleteProject,
  purgeExpiredDeletedProjects,
  restoreDeletedProject,
} from "@/lib/firestore-data";
import type { Project } from "@/lib/types";

function formatDeletedDate(value: string) {
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return "-";
  const day = d.toLocaleDateString(undefined, { day: "2-digit" });
  const month = d.toLocaleDateString(undefined, { month: "long" });
  const year = d.toLocaleDateString(undefined, { year: "numeric" });
  const time = d
    .toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit", hour12: true })
    .replace(" ", "")
    .toLowerCase();
  return `${day} ${month} ${year}  |  ${time}`;
}

function formatDateOnly(value: string) {
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return "-";
  const day = d.toLocaleDateString(undefined, { day: "2-digit" });
  const month = d.toLocaleDateString(undefined, { month: "long" });
  const year = d.toLocaleDateString(undefined, { year: "numeric" });
  return `${day} ${month} ${year}`;
}

function toSafeInt(value: unknown) {
  const num = Number.parseInt(String(value ?? "0"), 10);
  return Number.isFinite(num) ? num : 0;
}

function getProjectProductSummary(project: Project) {
  const settings = (project.projectSettings ?? {}) as Record<string, unknown>;
  const rowsSources: unknown[] = [
    (settings.cutlist as Record<string, unknown> | undefined)?.rows,
    settings.cutlistRows,
    settings.productionCutlistRows,
    (settings.production as Record<string, unknown> | undefined)?.rows,
  ];
  const rows = rowsSources.find((src) => Array.isArray(src)) as unknown[] | undefined;
  const piecesFromRows = Array.isArray(rows)
    ? rows.reduce<number>((sum, row) => {
        const item = (row ?? {}) as Record<string, unknown>;
        const qty = toSafeInt(item.Quantity ?? item.quantity ?? item.qty ?? 1);
        return sum + (qty > 0 ? qty : 1);
      }, 0)
    : 0;

  const piecesHints = [
    settings.totalPieces,
    settings.piecesCount,
    (settings.cutlistSummary as Record<string, unknown> | undefined)?.totalPieces,
  ];
  const hintedPieces = piecesHints.map(toSafeInt).find((v) => v > 0) ?? 0;
  const pieces = piecesFromRows > 0 ? piecesFromRows : hintedPieces;

  const sheetHints = [
    project.estimatedSheets,
    settings.totalSheets,
    settings.sheetsCount,
    (settings.nestingSummary as Record<string, unknown> | undefined)?.sheets,
  ];
  const sheets = sheetHints.map(toSafeInt).find((v) => v > 0) ?? 0;

  return { pieces, sheets };
}

function formatRemaining(ms: number) {
  if (ms <= 0) return "Deleting...";
  const totalMinutes = Math.floor(ms / (1000 * 60));
  const totalHours = Math.floor(totalMinutes / 60);
  const totalDays = Math.floor(totalHours / 24);

  if (totalDays >= 30) {
    const months = Math.floor(totalDays / 30);
    const remDaysAfterMonths = totalDays % 30;
    const weeks = Math.floor(remDaysAfterMonths / 7);
    const days = remDaysAfterMonths % 7;
    return `${months}m ${weeks}w ${days}d`;
  }

  if (totalDays >= 7) {
    const weeks = Math.floor(totalDays / 7);
    const days = totalDays % 7;
    return `${weeks}w ${days}d`;
  }

  if (totalDays >= 1) {
    const days = totalDays;
    const hours = totalHours % 24;
    return `${days}d ${hours}hr`;
  }

  if (totalHours >= 1) {
    return `${totalHours}hr`;
  }

  const rounded10 = Math.floor(totalMinutes / 10) * 10;
  return `${Math.max(0, rounded10)}m`;
}

function getRemainingRefreshMs(ms: number) {
  if (ms <= 0) return 10 * 60 * 1000;
  const oneHour = 60 * 60 * 1000;
  const oneDay = 24 * oneHour;
  const oneWeek = 7 * oneDay;
  if (ms < oneHour) return 10 * 60 * 1000;
  if (ms < oneWeek) return oneHour;
  return oneDay;
}

function initialsFromName(name: string) {
  const cleaned = String(name || "").trim();
  if (!cleaned) return "CU";
  const parts = cleaned.split(/\s+/).filter(Boolean);
  if (parts.length === 1) {
    return parts[0].slice(0, 2).toUpperCase();
  }
  return `${parts[0][0] ?? ""}${parts[1][0] ?? ""}`.toUpperCase();
}

export default function RecentlyDeletedPage() {
  const ACTIVE_COMPANY_STORAGE_KEY = "cutsmart_active_company_id";
  const { user } = useAuth();
  const [search, setSearch] = useState("");
  const [deletedProjects, setDeletedProjects] = useState<Project[]>([]);
  const [retentionDaysByCompany, setRetentionDaysByCompany] = useState<Record<string, number>>({});
  const [creatorColorByUid, setCreatorColorByUid] = useState<Record<string, string>>({});
  const [companyThemeColor, setCompanyThemeColor] = useState("#2F6BFF");
  const [companyName, setCompanyName] = useState("Company");
  const [isLoading, setIsLoading] = useState(true);
  const [restoringId, setRestoringId] = useState("");
  const [deletingId, setDeletingId] = useState("");
  const [confirmRestoreId, setConfirmRestoreId] = useState("");
  const [confirmDeleteId, setConfirmDeleteId] = useState("");
  const [hoveredRestoreId, setHoveredRestoreId] = useState("");
  const [hoveredDeleteId, setHoveredDeleteId] = useState("");
  const [hoveredRowId, setHoveredRowId] = useState("");
  const [nowMs, setNowMs] = useState(Date.now());
  const [expandedProjectId, setExpandedProjectId] = useState("");
  const confirmResetTimeoutRef = useRef<number | null>(null);
  const confirmDeleteTimeoutRef = useRef<number | null>(null);

  const clearConfirmRestoreTimeout = () => {
    if (confirmResetTimeoutRef.current !== null) {
      window.clearTimeout(confirmResetTimeoutRef.current);
      confirmResetTimeoutRef.current = null;
    }
  };

  const clearConfirmDeleteTimeout = () => {
    if (confirmDeleteTimeoutRef.current !== null) {
      window.clearTimeout(confirmDeleteTimeoutRef.current);
      confirmDeleteTimeoutRef.current = null;
    }
  };

  const load = useCallback(async () => {
    setIsLoading(true);
    const storedCompanyId =
      typeof window !== "undefined" ? String(window.localStorage.getItem(ACTIVE_COMPANY_STORAGE_KEY) || "").trim() : "";
    const directCompanyId = String(user?.companyId || "").trim();
    const preferredCompanyIds = Array.from(new Set([storedCompanyId, directCompanyId].filter(Boolean)));
    await purgeExpiredDeletedProjects(user?.uid, preferredCompanyIds);
    const rows = await fetchDeletedProjects(user?.uid, preferredCompanyIds);
    setDeletedProjects(rows);
    const creatorUids = rows.map((row) => String(row.createdByUid || "").trim()).filter(Boolean);
    const userColorMap = await fetchUserColorMapByUids(creatorUids);
    setCreatorColorByUid(userColorMap);

    const companyIds = Array.from(new Set(rows.map((row) => String(row.companyId || "").trim()).filter(Boolean)));

    const selectedCompanyId = storedCompanyId || companyIds[0] || "";
    if (selectedCompanyId) {
      const selectedCompanyDoc = await fetchCompanyDoc(selectedCompanyId);
      const selectedDoc = (selectedCompanyDoc as Record<string, unknown> | null) ?? null;
      const appPrefs =
        selectedDoc && typeof selectedDoc.applicationPreferences === "object" && selectedDoc.applicationPreferences !== null
          ? (selectedDoc.applicationPreferences as Record<string, unknown>)
          : null;
      const selectedName = String(
        selectedDoc?.name ??
          selectedDoc?.companyName ??
          appPrefs?.companyName ??
          "",
      ).trim();
      if (selectedName) setCompanyName(selectedName);
      const selectedThemeColor = String(selectedDoc?.themeColor ?? "").trim();
      if (selectedThemeColor) setCompanyThemeColor(selectedThemeColor);
    }

    if (!companyIds.length) {
      setRetentionDaysByCompany({});
      setIsLoading(false);
      return;
    }

    const entries = await Promise.all(
      companyIds.map(async (companyId) => {
        const doc = await fetchCompanyDoc(companyId);
        const themeColor = String((doc as Record<string, unknown> | null)?.themeColor ?? "").trim();
        if (themeColor) setCompanyThemeColor(themeColor);
        const raw = Number((doc as Record<string, unknown> | null)?.deletedRetentionDays ?? 90);
        const days = Number.isFinite(raw) && raw > 0 ? raw : 90;
        return [companyId, days] as const;
      }),
    );
    setRetentionDaysByCompany(Object.fromEntries(entries));
    setIsLoading(false);
  }, [user?.uid]);

  useEffect(() => {
    void load();
  }, [load]);

  const nextRefreshMs = useMemo(() => {
    const oneDay = 24 * 60 * 60 * 1000;
    let refreshMs = oneDay;

    for (const project of deletedProjects) {
      const deletedAt = String(project.deletedAt || project.updatedAt || project.createdAt || "").trim();
      const deletedAtMs = new Date(deletedAt).getTime();
      if (!Number.isFinite(deletedAtMs)) continue;
      const retentionDays = retentionDaysByCompany[String(project.companyId || "").trim()] ?? 90;
      const remainingMs = deletedAtMs + retentionDays * oneDay - nowMs;
      refreshMs = Math.min(refreshMs, getRemainingRefreshMs(remainingMs));
    }
    return refreshMs;
  }, [deletedProjects, retentionDaysByCompany, nowMs]);

  useEffect(() => {
    const id = window.setTimeout(() => setNowMs(Date.now()), nextRefreshMs);
    return () => window.clearTimeout(id);
  }, [nextRefreshMs]);

  const filtered = useMemo(() => {
    const q = String(search || "").trim().toLowerCase();
    if (!q) return deletedProjects;
    return deletedProjects.filter((project) => `${project.name} ${project.createdByName}`.toLowerCase().includes(q));
  }, [deletedProjects, search]);

  const onRestore = async (project: Project) => {
    if (restoringId || deletingId) return;
    clearConfirmRestoreTimeout();
    clearConfirmDeleteTimeout();
    setRestoringId(project.id);
    const ok = await restoreDeletedProject(project);
    if (ok) {
      setDeletedProjects((prev) => prev.filter((row) => row.id !== project.id));
      setConfirmRestoreId((prev) => (prev === project.id ? "" : prev));
      setExpandedProjectId((prev) => (prev === project.id ? "" : prev));
    }
    setRestoringId("");
  };

  const onRestoreClick = async (project: Project) => {
    if (restoringId || deletingId) return;
    if (confirmRestoreId !== project.id) {
      setConfirmRestoreId(project.id);
      setConfirmDeleteId((prev) => (prev === project.id ? "" : prev));
      clearConfirmRestoreTimeout();
      confirmResetTimeoutRef.current = window.setTimeout(() => {
        setConfirmRestoreId((prev) => (prev === project.id ? "" : prev));
        confirmResetTimeoutRef.current = null;
      }, 5000);
      return;
    }
    await onRestore(project);
  };

  const onPermanentDelete = async (project: Project) => {
    if (restoringId || deletingId) return;
    clearConfirmRestoreTimeout();
    clearConfirmDeleteTimeout();
    setDeletingId(project.id);
    const ok = await permanentlyDeleteProject(project);
    if (ok) {
      setDeletedProjects((prev) => prev.filter((row) => row.id !== project.id));
      setConfirmDeleteId((prev) => (prev === project.id ? "" : prev));
      setExpandedProjectId((prev) => (prev === project.id ? "" : prev));
    }
    setDeletingId("");
  };

  const onPermanentDeleteClick = async (project: Project) => {
    if (restoringId || deletingId) return;
    if (confirmDeleteId !== project.id) {
      setConfirmDeleteId(project.id);
      setConfirmRestoreId((prev) => (prev === project.id ? "" : prev));
      clearConfirmDeleteTimeout();
      confirmDeleteTimeoutRef.current = window.setTimeout(() => {
        setConfirmDeleteId((prev) => (prev === project.id ? "" : prev));
        confirmDeleteTimeoutRef.current = null;
      }, 5000);
      return;
    }
    await onPermanentDelete(project);
  };

  const toggleProjectExpand = (project: Project) => {
    setExpandedProjectId((prev) => (prev === project.id ? "" : project.id));
  };

  useEffect(() => {
    return () => {
      clearConfirmRestoreTimeout();
      clearConfirmDeleteTimeout();
    };
  }, []);

  return (
    <ProtectedRoute>
      <AppShell>
        <section className="-mx-4 -mb-4 -mt-4 min-h-screen bg-white pb-4 pt-0 md:-mx-5">
          <div className="flex h-[56px] flex-wrap items-center justify-between gap-2 border-b border-[#D7DEE8] bg-white px-4 md:px-5">
            <div className="inline-flex items-center gap-2">
              <Trash2 size={16} color="#12345B" strokeWidth={2.1} />
              <p className="text-[14px] font-extrabold uppercase tracking-[1px]" style={{ color: "#12345B" }}>
                <span style={{ color: "#12345B" }}>Recently Deleted</span>
                <span className="px-2" style={{ color: "#6B7280" }}>|</span>
                <span style={{ color: "#334155" }}>{companyName}</span>
              </p>
            </div>
            <div
              className="inline-flex h-9 items-center gap-2 rounded-[10px] border border-[#D8DEE8] bg-[#F7F9FC] px-2"
              style={{ width: 340, minWidth: 340 }}
            >
              <Search size={14} className="text-[#6B7280]" />
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search deleted projects..."
                className="h-8 w-full bg-transparent text-[12px] outline-none"
              />
            </div>
          </div>

          <div className="mt-3 overflow-auto">
            <table className="w-full min-w-[920px] text-[12px]">
              <thead>
                <tr>
                  <th className="border-b pb-2 pl-[10px] text-left text-[11px] font-bold text-[#7F93AE]" style={{ borderColor: "#D7E1EE" }}>Project Name</th>
                  <th className="border-b pb-2 pl-[10px] text-left text-[11px] font-bold text-[#7F93AE]" style={{ borderColor: "#D7E1EE" }}>Creator</th>
                  <th className="border-b pb-2 text-center text-[11px] font-bold text-[#7F93AE]" style={{ borderColor: "#D7E1EE" }}>Deleted</th>
                  <th className="border-b pb-2 text-center text-[11px] font-bold text-[#7F93AE]" style={{ borderColor: "#D7E1EE" }}>Permanent Delete</th>
                  <th className="w-[180px] border-b pb-2 text-center text-[11px] font-bold text-[#7F93AE]" style={{ borderColor: "#D7E1EE" }}>Action</th>
                </tr>
              </thead>
              <tbody>
                {isLoading && (
                  <tr>
                    <td className="py-3 pl-[10px] pr-[10px] text-[#6B7280]" colSpan={5}>Loading deleted projects...</td>
                  </tr>
                )}

                {!isLoading && filtered.length === 0 && (
                  <tr>
                    <td className="py-4 pl-[10px] pr-[10px] text-[#6B7280]" colSpan={5}>No deleted projects.</td>
                  </tr>
                )}

                {filtered.map((project) => {
                  const deletedAt = String(project.deletedAt || project.updatedAt || project.createdAt || "").trim();
                  const deletedAtMs = new Date(deletedAt).getTime();
                  const retentionDays = retentionDaysByCompany[String(project.companyId || "").trim()] ?? 90;
                  const remainingMs =
                    Number.isFinite(deletedAtMs)
                      ? deletedAtMs + retentionDays * 24 * 60 * 60 * 1000 - nowMs
                      : Number.POSITIVE_INFINITY;
                  const isConfirming = confirmRestoreId === project.id;
                  const isDeleteConfirming = confirmDeleteId === project.id;
                  const isExpanded = expandedProjectId === project.id;
                  const productSummary = getProjectProductSummary(project);
                  const clientAddressCombined = [String(project.clientAddress || "").trim(), String(project.region || "").trim()]
                    .filter(Boolean)
                    .join(", ");
                  return (
                    <Fragment key={`recently_deleted_${project.id}`}>
                      <tr
                        onMouseEnter={() => setHoveredRowId(project.id)}
                        onMouseLeave={() => setHoveredRowId((prev) => (prev === project.id ? "" : prev))}
                        onClick={() => toggleProjectExpand(project)}
                        className="cursor-pointer [&>td]:transition-colors"
                      >
                        <td
                          className="border-b py-[7px] pl-[10px] font-bold text-[#111827]"
                          style={{ backgroundColor: hoveredRowId === project.id ? "#EEF4FF" : "#FFFFFF", borderColor: "#D7E1EE" }}
                        >
                          {project.name}
                        </td>
                        <td className="border-b py-[7px] pl-[10px] text-[#344054]" style={{ backgroundColor: hoveredRowId === project.id ? "#EEF4FF" : "#FFFFFF", borderColor: "#D7E1EE" }}>
                          <div className="inline-flex items-center gap-2">
                            <span
                              className="inline-flex h-5 w-5 items-center justify-center rounded-full text-[10px] font-bold text-white"
                              style={{
                                backgroundColor:
                                  creatorColorByUid[String(project.createdByUid || "").trim()] || companyThemeColor,
                              }}
                            >
                              {initialsFromName(project.createdByName || "")}
                            </span>
                            <span>{project.createdByName || "-"}</span>
                          </div>
                        </td>
                        <td className="border-b py-[7px] text-center text-[#344054]" style={{ backgroundColor: hoveredRowId === project.id ? "#EEF4FF" : "#FFFFFF", borderColor: "#D7E1EE" }}>{formatDeletedDate(deletedAt)}</td>
                        <td className="border-b py-[7px] text-center" style={{ backgroundColor: hoveredRowId === project.id ? "#EEF4FF" : "#FFFFFF", borderColor: "#D7E1EE" }}>
                          <span
                            className="inline-flex min-w-[94px] items-center justify-center rounded-[999px] border border-[#F3B8BF] bg-[#FDECEC] px-2 py-[3px] text-[11px] font-bold"
                            style={{ color: "#7F1D1D" }}
                          >
                            {formatRemaining(remainingMs)}
                          </span>
                        </td>
                        <td className="w-[180px] border-b py-[7px]" style={{ backgroundColor: hoveredRowId === project.id ? "#EEF4FF" : "#FFFFFF", borderColor: "#D7E1EE" }}>
                          <div className="flex w-full justify-center">
                            <button
                              type="button"
                              disabled={restoringId === project.id || deletingId === project.id}
                              onMouseEnter={() => setHoveredRestoreId(project.id)}
                              onMouseLeave={() => setHoveredRestoreId((prev) => (prev === project.id ? "" : prev))}
                              onClick={(e) => {
                                e.stopPropagation();
                                void onRestoreClick(project);
                              }}
                              className="inline-flex w-[132px] items-center justify-center gap-1 rounded-[8px] px-2 py-1 text-[11px] font-bold transition-all duration-150 disabled:opacity-55"
                              style={{
                                width: 132,
                                minWidth: 132,
                                maxWidth: 132,
                                color: isConfirming ? "#14532D" : "#1E3A8A",
                                border: `1px solid ${
                                  isConfirming
                                    ? hoveredRestoreId === project.id
                                      ? "#86EFAC"
                                      : "#BBF7D0"
                                    : hoveredRestoreId === project.id
                                      ? "#94B8F0"
                                      : "#BFD4F6"
                                }`,
                                background: isConfirming
                                  ? hoveredRestoreId === project.id
                                    ? "#DCFCE7"
                                    : "#ECFDF3"
                                  : hoveredRestoreId === project.id
                                    ? "#CFE0FF"
                                    : "#EAF2FF",
                                boxShadow:
                                  hoveredRestoreId === project.id ? "0 1px 0 rgba(30,58,138,0.15)" : "none",
                              }}
                            >
                              {isConfirming ? <Check size={12} /> : <RotateCcw size={12} />}
                              {restoringId === project.id ? "Restoring..." : isConfirming ? "Confirm" : "Restore"}
                            </button>
                          </div>
                        </td>
                      </tr>
                      {isExpanded && (
                        <tr>
                          <td colSpan={5} className="relative border-b px-[10px] py-[8px]" style={{ borderColor: "#D7E1EE", backgroundColor: "#F8FBFF" }}>
                              <div className="grid grid-cols-4 text-[12px]">
                              <div className="px-3 py-2">
                                <p className="mb-2 text-[11px] font-extrabold uppercase tracking-[0.6px] text-[#6B7D94]">Client</p>
                                <div className="space-y-1.5">
                                  <div><span className="text-[#64748B]">Client Name: </span><span className="font-semibold text-[#1F2937]">{project.customer || "-"}</span></div>
                                  <div><span className="text-[#64748B]">Phone: </span><span className="font-semibold text-[#1F2937]">{project.clientPhone || "-"}</span></div>
                                  <div><span className="text-[#64748B]">Email: </span><span className="font-semibold text-[#1F2937]">{project.clientEmail || "-"}</span></div>
                                  <div><span className="text-[#64748B]">Address: </span><span className="font-semibold text-[#1F2937]">{clientAddressCombined || "-"}</span></div>
                                </div>
                              </div>
                              <div className="border-l px-3 py-2" style={{ borderLeftColor: "#D7E1EE" }}>
                                <p className="mb-2 text-[11px] font-extrabold uppercase tracking-[0.6px] text-[#6B7D94]">Overview</p>
                                <div className="space-y-1.5">
                                  <div><span className="text-[#64748B]">Status: </span><span className="font-semibold text-[#1F2937]">{project.statusLabel || "-"}</span></div>
                                  <div><span className="text-[#64748B]">Creator: </span><span className="font-semibold text-[#1F2937]">{project.createdByName || "-"}</span></div>
                                  <div><span className="text-[#64748B]">Assigned To: </span><span className="font-semibold text-[#1F2937]">{project.assignedTo || "-"}</span></div>
                                </div>
                              </div>
                              <div className="border-l px-3 py-2" style={{ borderLeftColor: "#D7E1EE" }}>
                                <p className="mb-2 text-[11px] font-extrabold uppercase tracking-[0.6px] text-[#6B7D94]">Dates</p>
                                <div className="space-y-1.5">
                                  <div><span className="text-[#64748B]">Created: </span><span className="font-semibold text-[#1F2937]">{formatDateOnly(project.createdAt || "")}</span></div>
                                  <div><span className="text-[#64748B]">Modified: </span><span className="font-semibold text-[#1F2937]">{formatDateOnly(project.updatedAt || "")}</span></div>
                                  <div><span className="text-[#64748B]">Deleted: </span><span className="font-semibold text-[#1F2937]">{formatDateOnly(project.deletedAt || "")}</span></div>
                                </div>
                              </div>
                              <div className="border-l px-3 py-2" style={{ borderLeftColor: "#D7E1EE" }}>
                                <p className="mb-2 text-[11px] font-extrabold uppercase tracking-[0.6px] text-[#6B7D94]">Product</p>
                                <div className="space-y-1.5">
                                  <div><span className="text-[#64748B]">Pieces in job: </span><span className="font-semibold text-[#1F2937]">{productSummary.pieces}</span></div>
                                  <div><span className="text-[#64748B]">Sheets: </span><span className="font-semibold text-[#1F2937]">{productSummary.sheets}</span></div>
                                </div>
                              </div>
                              </div>
                              <div className="absolute inset-0 z-20 flex items-end justify-end pr-[20px] pb-[10px]">
                                <button
                                  type="button"
                                  disabled={deletingId === project.id || restoringId === project.id}
                                  onMouseEnter={() => setHoveredDeleteId(project.id)}
                                  onMouseLeave={() => setHoveredDeleteId((prev) => (prev === project.id ? "" : prev))}
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    void onPermanentDeleteClick(project);
                                  }}
                                  className="inline-flex w-[132px] items-center justify-center gap-1 rounded-[8px] px-2 py-1 text-[11px] font-bold transition-all duration-150 disabled:opacity-55"
                                  style={{
                                    width: 132,
                                    minWidth: 132,
                                    maxWidth: 132,
                                    transform: "translateX(-10px)",
                                    color: isDeleteConfirming ? "#14532D" : "#991B1B",
                                    border: `1px solid ${
                                      isDeleteConfirming
                                        ? hoveredDeleteId === project.id
                                          ? "#86EFAC"
                                          : "#BBF7D0"
                                        : hoveredDeleteId === project.id
                                          ? "#F5B4BC"
                                          : "#F8CDD2"
                                    }`,
                                    background: isDeleteConfirming
                                      ? hoveredDeleteId === project.id
                                        ? "#DCFCE7"
                                        : "#ECFDF3"
                                      : hoveredDeleteId === project.id
                                        ? "#FDECEC"
                                        : "#FFF5F6",
                                  }}
                                >
                                  {isDeleteConfirming ? <Check size={12} /> : <Trash2 size={12} />}
                                  {deletingId === project.id ? "Deleting..." : isDeleteConfirming ? "Confirm" : "Permanent Delete"}
                                </button>
                              </div>
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
        </section>
      </AppShell>
    </ProtectedRoute>
  );
}
