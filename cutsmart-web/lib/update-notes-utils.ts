export const UPDATE_CHANGELOG_HISTORY_STORAGE_KEY_PREFIX = "cutsmart_update_changelog_history_";

export type UpdateChangelogEntry = {
  version: string;
  whatsNew: string;
  capturedAtIso: string;
};

function escapeHtml(value: string): string {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export function updateNotesToDisplayHtml(value: string): string {
  const escaped = escapeHtml(String(value || "").replace(/\r\n/g, "\n"));
  const tagMap: Array<[RegExp, string]> = [
    [/&lt;b&gt;/gi, "<b>"],
    [/&lt;\/b&gt;/gi, "</b>"],
    [/&lt;strong&gt;/gi, "<strong>"],
    [/&lt;\/strong&gt;/gi, "</strong>"],
    [/&lt;i&gt;/gi, "<i>"],
    [/&lt;\/i&gt;/gi, "</i>"],
    [/&lt;em&gt;/gi, "<em>"],
    [/&lt;\/em&gt;/gi, "</em>"],
    [/&lt;u&gt;/gi, "<u>"],
    [/&lt;\/u&gt;/gi, "</u>"],
    [/&lt;br\s*\/?&gt;/gi, "<br />"],
    [/&lt;ul&gt;/gi, "<ul>"],
    [/&lt;\/ul&gt;/gi, "</ul>"],
    [/&lt;ol&gt;/gi, "<ol>"],
    [/&lt;\/ol&gt;/gi, "</ol>"],
    [/&lt;li&gt;/gi, "<li>"],
    [/&lt;\/li&gt;/gi, "</li>"],
  ];
  let html = escaped;
  for (const [pattern, replacement] of tagMap) {
    html = html.replace(pattern, replacement);
  }
  return html.replace(/\n/g, "<br />");
}

export function parseUpdateNotesText(raw: string): { version: string; whatsNew: string } {
  const text = String(raw || "");
  const versionMatch = text.match(/^\s*(?:version|verison)\s*:\s*(.+?)\s*$/im);
  const version = String(versionMatch?.[1] || "").trim();

  const bracketMatch = text.match(/^\s*whatsnew\s*:\s*\[([\s\S]*?)\]\s*$/im);
  if (bracketMatch) {
    return { version, whatsNew: String(bracketMatch[1] || "").trim() };
  }

  const whatLineMatch = text.match(/^\s*whatsnew\s*:\s*(.+?)\s*$/im);
  if (whatLineMatch) {
    return { version, whatsNew: String(whatLineMatch[1] || "").trim() };
  }

  return { version, whatsNew: "" };
}

export function normalizeChangelogHistory(raw: unknown): UpdateChangelogEntry[] {
  if (!Array.isArray(raw)) return [];
  const rows = raw
    .filter((row) => row && typeof row === "object")
    .map((row) => {
      const item = row as Record<string, unknown>;
      return {
        version: String(item.version || "").trim(),
        whatsNew: String(item.whatsNew || ""),
        capturedAtIso: String(item.capturedAtIso || ""),
      } as UpdateChangelogEntry;
    })
    .filter((row) => row.version);

  // Safety fallback: keep a single canonical entry per version.
  const dedupedByVersion = new Map<string, UpdateChangelogEntry>();
  for (const row of rows) {
    const key = String(row.version || "").trim().toLowerCase();
    if (!key) continue;
    const existing = dedupedByVersion.get(key);
    if (!existing) {
      dedupedByVersion.set(key, row);
      continue;
    }
    const existingTime = Date.parse(existing.capturedAtIso || "");
    const rowTime = Date.parse(row.capturedAtIso || "");
    const pickRow =
      Number.isFinite(rowTime) && (!Number.isFinite(existingTime) || rowTime > existingTime);
    if (pickRow) {
      dedupedByVersion.set(key, {
        ...row,
        whatsNew: String(row.whatsNew || existing.whatsNew || ""),
      });
    } else if (!String(existing.whatsNew || "").trim() && String(row.whatsNew || "").trim()) {
      dedupedByVersion.set(key, {
        ...existing,
        whatsNew: row.whatsNew,
      });
    }
  }

  const normalized = Array.from(dedupedByVersion.values());
  normalized.sort((a, b) => {
    const at = Date.parse(a.capturedAtIso || "");
    const bt = Date.parse(b.capturedAtIso || "");
    if (Number.isFinite(at) && Number.isFinite(bt)) return bt - at;
    if (Number.isFinite(at)) return -1;
    if (Number.isFinite(bt)) return 1;
    return b.version.localeCompare(a.version);
  });
  return normalized;
}

export function readChangelogHistory(uid: string): UpdateChangelogEntry[] {
  if (typeof window === "undefined") return [];
  const userId = String(uid || "").trim();
  if (!userId) return [];
  const key = `${UPDATE_CHANGELOG_HISTORY_STORAGE_KEY_PREFIX}${userId}`;
  try {
    const raw = window.localStorage.getItem(key);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    const rows = parsed
      .filter((row) => row && typeof row === "object")
      .map((row) => {
        const item = row as Record<string, unknown>;
        return {
          version: String(item.version || "").trim(),
          whatsNew: String(item.whatsNew || ""),
          capturedAtIso: String(item.capturedAtIso || ""),
        } as UpdateChangelogEntry;
      })
      .filter((row) => row.version);
    rows.sort((a, b) => {
      const at = Date.parse(a.capturedAtIso || "");
      const bt = Date.parse(b.capturedAtIso || "");
      if (Number.isFinite(at) && Number.isFinite(bt)) return bt - at;
      if (Number.isFinite(at)) return -1;
      if (Number.isFinite(bt)) return 1;
      return b.version.localeCompare(a.version);
    });
    return rows;
  } catch {
    return [];
  }
}

export function upsertChangelogEntry(uid: string, version: string, whatsNew: string): void {
  if (typeof window === "undefined") return;
  const userId = String(uid || "").trim();
  const v = String(version || "").trim();
  if (!userId || !v) return;
  const key = `${UPDATE_CHANGELOG_HISTORY_STORAGE_KEY_PREFIX}${userId}`;
  const nextWhatsNew = String(whatsNew || "").trim();
  const nowIso = new Date().toISOString();
  const history = readChangelogHistory(userId);
  const idx = history.findIndex((row) => String(row.version || "").trim() === v);
  if (idx >= 0) {
    if (history[idx].whatsNew !== nextWhatsNew) {
      history[idx] = {
        ...history[idx],
        whatsNew: nextWhatsNew,
      };
    }
  } else {
    history.push({ version: v, whatsNew: nextWhatsNew, capturedAtIso: nowIso });
  }
  history.sort((a, b) => {
    const at = Date.parse(a.capturedAtIso || "");
    const bt = Date.parse(b.capturedAtIso || "");
    if (Number.isFinite(at) && Number.isFinite(bt)) return bt - at;
    if (Number.isFinite(at)) return -1;
    if (Number.isFinite(bt)) return 1;
    return b.version.localeCompare(a.version);
  });
  window.localStorage.setItem(key, JSON.stringify(history));
}
