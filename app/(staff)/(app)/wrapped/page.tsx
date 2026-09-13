"use client";

import { useEffect, useMemo, useState } from "react";
import {
  Archive,
  CheckCircle2,
  DoorOpen,
  Layers,
  PanelsTopLeft,
  Palette,
  PartyPopper,
  Ruler,
  Sparkles,
  Trophy,
  Wrench,
} from "lucide-react";
import { useAuth } from "@/lib/auth-context";
import {
  fetchProjects,
  fetchCompanyStatsDoc,
  fetchCompanyStatsYears,
  fetchAllProjectStatsContributions,
  type CompanyStatsDoc,
} from "@/lib/firestore-data";
import { readThemeMode, THEME_MODE_UPDATED_EVENT, type ThemeMode } from "@/lib/theme-mode";
import { retryAsync } from "@/lib/load-retry";

const ACTIVE_COMPANY_STORAGE_KEY = "cutsmart_active_company_id";

// Mirrors dashboard/page.tsx's own local isCompletedStatus() so "Jobs complete this year" agrees
// with the "Completed" count staff already see on the Dashboard for the same underlying projects.
function isCompletedStatus(status: string) {
  const token = String(status || "").toLowerCase().replace(/[^a-z]/g, "");
  return token === "done" || token.startsWith("complete");
}

const EMPTY_STATS: CompanyStatsDoc = {
  year: new Date().getFullYear(),
  doorsQuantity: 0,
  drawersQuantity: 0,
  panelsQuantity: 0,
  materialUsage: {},
  materialUsageDisplay: {},
  hingeUsage: {},
  hingeUsageDisplay: {},
  updatedAt: null,
  updatedAtIso: "",
};

function topLeaderboardRows(usage: Record<string, number>, display: Record<string, string>, limit = 5) {
  return Object.entries(usage)
    .map(([key, count]) => ({ key, count, label: display[key] || key }))
    .filter((row) => row.count > 0)
    .sort((a, b) => b.count - a.count)
    .slice(0, limit);
}

function formatWrappedNumber(value: number): string {
  const rounded = Math.round(Math.max(0, value) * 100) / 100;
  return rounded % 1 === 0 ? String(rounded) : rounded.toFixed(2).replace(/0+$/, "").replace(/\.$/, "");
}

export default function CompanyWrappedPage() {
  const { user } = useAuth();
  const [themeMode, setThemeMode] = useState<ThemeMode>("light");
  const [companyId, setCompanyId] = useState("");
  const [year, setYear] = useState(() => new Date().getFullYear());
  const [availableYears, setAvailableYears] = useState<number[]>([]);
  const [stats, setStats] = useState<CompanyStatsDoc>(EMPTY_STATS);
  const [nestingTotals, setNestingTotals] = useState({ sheets: 0, edgeTapeMeters: 0, lacquerSqm: 0 });
  const [jobsCompleteCount, setJobsCompleteCount] = useState(0);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    setThemeMode(readThemeMode());
    if (typeof window === "undefined") return;
    const onThemeUpdated = (event: Event) => {
      const detail = (event as CustomEvent<{ mode?: ThemeMode }>).detail;
      setThemeMode(detail?.mode === "dark" ? "dark" : "light");
    };
    window.addEventListener(THEME_MODE_UPDATED_EVENT, onThemeUpdated as EventListener);
    return () => window.removeEventListener(THEME_MODE_UPDATED_EVENT, onThemeUpdated as EventListener);
  }, []);

  useEffect(() => {
    const storedCompanyId =
      typeof window !== "undefined" ? String(window.localStorage.getItem(ACTIVE_COMPANY_STORAGE_KEY) || "").trim() : "";
    setCompanyId(storedCompanyId || String(user?.companyId || "").trim());
  }, [user?.companyId]);

  useEffect(() => {
    if (!companyId) return;
    let cancelled = false;
    const load = async () => {
      setIsLoading(true);
      try {
        const preferredCompanyIds = [companyId, String(user?.companyId || "").trim()].filter(Boolean);
        const [statsDoc, years, projects, contributions] = await Promise.all([
          retryAsync(() => fetchCompanyStatsDoc(companyId, year), { attempts: 2, delayMs: 250 }),
          retryAsync(() => fetchCompanyStatsYears(companyId), { attempts: 2, delayMs: 250 }),
          retryAsync(() => fetchProjects(user?.uid, preferredCompanyIds), { attempts: 2, delayMs: 350 }),
          // Sheets used / edge tape used / lacquer m² aren't a single running total — each project
          // reports its own current value, summed here live (same shape as "Jobs complete this
          // year" below), since a client-side delta can double-count across tabs/reseeds.
          retryAsync(() => fetchAllProjectStatsContributions(companyId, year), { attempts: 2, delayMs: 250 }),
        ]);
        if (cancelled) return;
        setStats(statsDoc ?? { ...EMPTY_STATS, year });
        setAvailableYears(years.length ? years : [new Date().getFullYear()]);
        setNestingTotals(
          contributions.reduce(
            (sum, row) => ({
              sheets: sum.sheets + row.sheets,
              edgeTapeMeters: sum.edgeTapeMeters + row.edgeTapeMeters,
              lacquerSqm: sum.lacquerSqm + row.lacquerSqm,
            }),
            { sheets: 0, edgeTapeMeters: 0, lacquerSqm: 0 },
          ),
        );
        const completeThisYear = projects.filter(
          (project) =>
            isCompletedStatus(project.statusLabel) &&
            project.completedAtIso &&
            new Date(project.completedAtIso).getFullYear() === year,
        ).length;
        setJobsCompleteCount(completeThisYear);
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    };
    void load();
    return () => {
      cancelled = true;
    };
  }, [companyId, year, user?.uid, user?.companyId]);

  const isDarkMode = themeMode === "dark";
  const palette = isDarkMode
    ? {
        pageBg: "#0f0f0f",
        panelBg: "#212121",
        panelMuted: "#272727",
        border: "#3f3f46",
        text: "#f1f1f1",
        textMuted: "#aaaaaa",
        textSoft: "#c9d1d9",
      }
    : {
        pageBg: "#ffffff",
        panelBg: "#ffffff",
        panelMuted: "#F5F7FA",
        border: "#D7DEE8",
        text: "#111827",
        textMuted: "#64748B",
        textSoft: "#475467",
      };

  const statTiles = useMemo(
    () => [
      { label: "Sheets Used", value: formatWrappedNumber(nestingTotals.sheets), icon: Layers, iconFrom: "#6EB4FF", iconTo: "#3577E0" },
      { label: "Edge Tape Used (m)", value: formatWrappedNumber(nestingTotals.edgeTapeMeters), icon: Ruler, iconFrom: "#F3CD6C", iconTo: "#DC9A1F" },
      { label: "Lacquer Used (m²)", value: formatWrappedNumber(nestingTotals.lacquerSqm), icon: Sparkles, iconFrom: "#F0A5E0", iconTo: "#C23DA0" },
      { label: "Doors Used", value: formatWrappedNumber(stats.doorsQuantity), icon: DoorOpen, iconFrom: "#A796F0", iconTo: "#6E56D9" },
      { label: "Drawers Used", value: formatWrappedNumber(stats.drawersQuantity), icon: Archive, iconFrom: "#F3A08A", iconTo: "#D0552F" },
      { label: "Panels Used", value: formatWrappedNumber(stats.panelsQuantity), icon: PanelsTopLeft, iconFrom: "#8FD6C2", iconTo: "#2E8C6E" },
      { label: "Jobs Complete", value: formatWrappedNumber(jobsCompleteCount), icon: CheckCircle2, iconFrom: "#6BC79A", iconTo: "#2E8C5C" },
    ],
    [stats, nestingTotals, jobsCompleteCount],
  );

  const topMaterials = useMemo(() => topLeaderboardRows(stats.materialUsage, stats.materialUsageDisplay), [stats]);
  const topHinges = useMemo(() => topLeaderboardRows(stats.hingeUsage, stats.hingeUsageDisplay), [stats]);

  const rankAccent = (index: number) => (index === 0 ? "#D4A017" : index === 1 ? "#8A8F98" : index === 2 ? "#B0692A" : palette.textMuted);

  return (
    <div className="space-y-5 pb-8" style={{ color: palette.text }}>
      <div
        className="rounded-[18px] px-6 py-8 text-white sm:px-10 sm:py-10"
        style={{ backgroundImage: "var(--brand-gradient)", boxShadow: "var(--shadow-glass)" }}
      >
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <PartyPopper size={30} />
            <div>
              <p className="text-[13px] font-semibold uppercase tracking-[1.5px] text-white/80">Company Wrapped</p>
              <h1 className="text-[28px] font-bold leading-tight sm:text-[34px]">Your year in the workshop</h1>
            </div>
          </div>
          {availableYears.length > 1 && (
            <select
              value={year}
              onChange={(e) => setYear(Number(e.target.value))}
              className="h-10 rounded-[10px] border border-white/30 bg-white/15 px-3 text-[14px] font-semibold text-white outline-none"
            >
              {availableYears.map((y) => (
                <option key={y} value={y} className="text-[#111827]">
                  {y}
                </option>
              ))}
            </select>
          )}
        </div>
        <p className="mt-4 text-[15px] text-white/90">
          You completed <b>{jobsCompleteCount}</b> {jobsCompleteCount === 1 ? "job" : "jobs"} in {year}.
        </p>
      </div>

      {isLoading ? (
        <div className="rounded-[18px] border px-5 py-10 text-center text-[14px]" style={{ borderColor: palette.border, backgroundColor: palette.panelMuted, color: palette.textMuted }}>
          Loading your {year} stats...
        </div>
      ) : (
        <>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
            {statTiles.map((tile) => {
              const Icon = tile.icon;
              return (
                <div
                  key={tile.label}
                  className="rounded-[16px] border px-5 py-4"
                  style={{ borderColor: palette.border, backgroundColor: palette.panelBg, boxShadow: "var(--shadow-sm)" }}
                >
                  <div className="mb-3 flex items-center gap-2.5">
                    <div
                      className="inline-flex h-9 w-9 items-center justify-center rounded-full text-white shadow-[0_4px_10px_rgba(0,0,0,0.14)]"
                      style={{ backgroundImage: `linear-gradient(135deg, ${tile.iconFrom} 0%, ${tile.iconTo} 100%)` }}
                    >
                      <Icon size={17} strokeWidth={2.4} />
                    </div>
                    <p className="text-[13px] font-semibold" style={{ color: palette.textSoft }}>{tile.label}</p>
                  </div>
                  <p className="text-[32px] font-semibold leading-none sm:text-[36px]" style={{ color: palette.text }}>{tile.value}</p>
                </div>
              );
            })}
          </div>

          <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
            <div className="rounded-[16px] border px-5 py-4" style={{ borderColor: palette.border, backgroundColor: palette.panelBg, boxShadow: "var(--shadow-sm)" }}>
              <div className="mb-3 flex items-center gap-2.5">
                <div className="inline-flex h-9 w-9 items-center justify-center rounded-full text-white shadow-[0_4px_10px_rgba(0,0,0,0.14)]" style={{ backgroundImage: "linear-gradient(135deg, #8FD6C2 0%, #2E8C6E 100%)" }}>
                  <Palette size={17} strokeWidth={2.4} />
                </div>
                <p className="text-[14px] font-semibold" style={{ color: palette.text }}>Top Materials &amp; Board Colours</p>
              </div>
              {topMaterials.length ? (
                <div className="space-y-2">
                  {topMaterials.map((row, index) => (
                    <div key={row.key} className="flex items-center justify-between gap-3 rounded-[10px] px-3 py-2" style={{ backgroundColor: palette.panelMuted }}>
                      <div className="flex items-center gap-2.5">
                        <Trophy size={15} style={{ color: rankAccent(index) }} />
                        <span className="text-[13px] font-semibold" style={{ color: palette.text }}>{row.label}</span>
                      </div>
                      <span className="text-[13px] font-bold" style={{ color: palette.textMuted }}>{row.count}</span>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-[13px]" style={{ color: palette.textMuted }}>No board colour usage recorded yet for {year}.</p>
              )}
              <p className="mt-3 text-[11px]" style={{ color: palette.textMuted }}>
                A sheet material and its board colour are the same thing in CutSmart, so this list covers both.
              </p>
            </div>

            <div className="rounded-[16px] border px-5 py-4" style={{ borderColor: palette.border, backgroundColor: palette.panelBg, boxShadow: "var(--shadow-sm)" }}>
              <div className="mb-3 flex items-center gap-2.5">
                <div className="inline-flex h-9 w-9 items-center justify-center rounded-full text-white shadow-[0_4px_10px_rgba(0,0,0,0.14)]" style={{ backgroundImage: "linear-gradient(135deg, #A796F0 0%, #6E56D9 100%)" }}>
                  <Wrench size={17} strokeWidth={2.4} />
                </div>
                <p className="text-[14px] font-semibold" style={{ color: palette.text }}>Top Hinge Types</p>
              </div>
              {topHinges.length ? (
                <div className="space-y-2">
                  {topHinges.map((row, index) => (
                    <div key={row.key} className="flex items-center justify-between gap-3 rounded-[10px] px-3 py-2" style={{ backgroundColor: palette.panelMuted }}>
                      <div className="flex items-center gap-2.5">
                        <Trophy size={15} style={{ color: rankAccent(index) }} />
                        <span className="text-[13px] font-semibold" style={{ color: palette.text }}>{row.label}</span>
                      </div>
                      <span className="text-[13px] font-bold" style={{ color: palette.textMuted }}>{row.count}</span>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-[13px]" style={{ color: palette.textMuted }}>No hinge order quantities recorded yet for {year}.</p>
              )}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
