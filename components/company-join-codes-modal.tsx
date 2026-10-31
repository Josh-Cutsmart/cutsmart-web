"use client";

import { useState } from "react";
import { createPortal } from "react-dom";
import { GlassModalHeader } from "@/components/glass-modal-header";
import { Check, Copy, Eye, EyeOff, KeyRound, Pencil, Plus, Search, Trash2 } from "lucide-react";
import { glassFieldClass, primaryButtonClass, primaryButtonStyle, smallButtonClass } from "@/components/settings-ui";
import { activeDateTime } from "@/lib/company-formats";
import { Skeleton, SkeletonGroup } from "@/components/skeleton";
import { EmptyState } from "@/components/empty-state";
import { useUndo } from "@/components/undo-bar";
import {
  changeMasterJoinCode,
  createTemporaryJoinCode,
  deleteJoinCode,
  renameTemporaryJoinCode,
  revokeTemporaryJoinCode,
  type JoinCodeRecord,
  type JoinCodesState,
} from "@/lib/company-join-codes";

// Company Settings > Company > Join key: the company's master code (with a way to change it) and its
// Access codes — one-person codes (create, copy, revoke, and delete once revoked; "temporary" codes on the
// server — see lib/company-join-codes-server.ts). Inviting someone (Staff > Add staff) makes them one too,
// shown with who it was sent to; they never type it — accepting the invite uses it up.
// The Access codes on their own (AccessCodesList) are in Staff & Permissions too.
// Revoking a code someone has already used means removing them, which the page does (its Remove Staff
// pop-up, then the revoke) through onRevokeUsedCode.
// A code with a role its person starts in (Add staff's Role) shows it as a pill in that role's colour, given roleFor —
// the page's own role names and colours.

export type AccessCodeRoleLookup = (roleId: string) => { name: string; color: string } | null;

const STATUS_STYLE: Record<string, { bg: string; fg: string }> = {
  waiting: { bg: "color-mix(in srgb, var(--accent-amber) 18%, transparent)", fg: "var(--text-main)" },
  used: { bg: "color-mix(in srgb, var(--accent-teal) 18%, transparent)", fg: "var(--text-main)" },
  revoked: { bg: "color-mix(in srgb, var(--text-main) 8%, transparent)", fg: "var(--text-muted)" },
};

function CopyButton({ value }: { value: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      className={smallButtonClass}
      onClick={() => {
        void navigator.clipboard?.writeText(value).then(() => {
          setCopied(true);
          window.setTimeout(() => setCopied(false), 1500);
        });
      }}
    >
      {copied ? <Check size={14} /> : <Copy size={14} />}
      {copied ? "Copied" : "Copy"}
    </button>
  );
}

export function CompanyJoinCodesModal({
  companyId,
  companyName,
  data,
  loading,
  loadError,
  onReload,
  onClose,
  onRevokeUsedCode,
  roleFor,
}: {
  companyId: string;
  companyName: string;
  data: JoinCodesState | null;
  loading: boolean;
  loadError: string;
  onReload: () => void;
  onClose: () => void;
  onRevokeUsedCode: (record: JoinCodeRecord) => void;
  roleFor?: AccessCodeRoleLookup;
}) {
  const [showMaster, setShowMaster] = useState(false);
  const [changing, setChanging] = useState(false);
  const [nextMaster, setNextMaster] = useState("");
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");

  const saveMaster = async () => {
    if (nextMaster.trim().length < 4) {
      setError("Use at least 4 characters.");
      return;
    }
    setBusy("master");
    setError("");
    const result = await changeMasterJoinCode(companyId, nextMaster);
    setBusy("");
    if (!result.ok) {
      setError(result.error);
      return;
    }
    setChanging(false);
    setNextMaster("");
    setShowMaster(true);
    onReload();
  };

  return createPortal(
    <div className="fixed inset-0 z-[1650] flex items-center justify-center px-4 py-4">
      <button type="button" aria-label="Close join codes" onClick={onClose} className="glass-modal-backdrop absolute inset-0" />
      <div role="dialog" aria-label="Join codes" className="glass-modal-panel relative z-[1651] flex max-h-[calc(100svh-32px)] w-full max-w-[600px] flex-col overflow-hidden">
        <GlassModalHeader title="Join codes" icon={<KeyRound size={16} />} onClose={onClose} />

        <div className="min-h-0 flex-1 space-y-5 overflow-y-auto px-4 py-4">
          {loading && !data ? (
            <SkeletonGroup label="Loading join codes" className="space-y-3">
              <Skeleton className="h-3 w-40" />
              <Skeleton className="h-12 w-full rounded-[14px]" />
              <Skeleton className="h-12 w-full rounded-[14px]" />
            </SkeletonGroup>
          ) : loadError && !data ? (
            <p className="text-[13px] font-medium" style={{ color: "var(--danger)" }}>{loadError}</p>
          ) : (
            <>
              <section className="space-y-2">
                <p className="text-[15px] font-semibold" style={{ color: "var(--text-main)" }}>Master code</p>
                <p className="text-[12.5px] leading-[1.5]" style={{ color: "var(--text-muted)" }}>
                  Anyone with this code can join {companyName || "your company"}. Changing it doesn&apos;t remove anyone — people already in the company
                  stay; only new people need the new code.
                </p>
                {changing ? (
                  <div className="flex flex-wrap items-center gap-2">
                    <input
                      value={nextMaster}
                      onChange={(event) => setNextMaster(event.target.value)}
                      placeholder="New master code"
                      className={`${glassFieldClass} min-w-0 flex-1 font-mono`}
                      autoComplete="off"
                      autoFocus
                      data-1p-ignore=""
                      data-lpignore="true"
                    />
                    <button type="button" className={primaryButtonClass} style={primaryButtonStyle} disabled={busy === "master"} onClick={() => void saveMaster()}>
                      {busy === "master" ? "Saving…" : "Save"}
                    </button>
                    <button
                      type="button"
                      className={smallButtonClass}
                      onClick={() => {
                        setChanging(false);
                        setNextMaster("");
                        setError("");
                      }}
                    >
                      Cancel
                    </button>
                  </div>
                ) : (
                  <div className="flex flex-wrap items-center gap-2">
                    <span
                      className="inline-flex min-h-[38px] min-w-0 flex-1 items-center rounded-[12px] border px-3 font-mono text-[15px] font-semibold tracking-[1px]"
                      style={{ borderColor: "var(--glass-border)", color: "var(--text-main)", backgroundColor: "color-mix(in srgb, var(--panel-bg) 60%, transparent)" }}
                    >
                      {data?.masterCode ? (showMaster ? data.masterCode : "•".repeat(Math.min(12, Math.max(6, data.masterCode.length)))) : "No master code yet"}
                    </span>
                    {data?.masterCode ? (
                      <>
                        <button type="button" className={smallButtonClass} onClick={() => setShowMaster((v) => !v)}>
                          {showMaster ? <EyeOff size={14} /> : <Eye size={14} />}
                          {showMaster ? "Hide" : "Show"}
                        </button>
                        <CopyButton value={data.masterCode} />
                      </>
                    ) : null}
                    <button
                      type="button"
                      className={smallButtonClass}
                      onClick={() => {
                        setChanging(true);
                        setError("");
                      }}
                    >
                      Change
                    </button>
                  </div>
                )}
              </section>

              <section className="space-y-2 border-t pt-4" style={{ borderColor: "var(--glass-border)" }}>
                <p className="text-[15px] font-semibold" style={{ color: "var(--text-main)" }}>Access codes</p>
                <AccessCodesList companyId={companyId} data={data} onReload={onReload} onRevokeUsedCode={onRevokeUsedCode} roleFor={roleFor} />
              </section>
              {error ? <p className="text-[12.5px] font-medium" style={{ color: "var(--danger)" }}>{error}</p> : null}
            </>
          )}
        </div>
      </div>
    </div>
  , document.body);
}

// The Access codes: one-person codes to join with (the server's "temporary" codes) — a new one made (who it's for, if
// you like), each one's state (not used yet / who used it / revoked), copied, revoked (one already used: its person
// removed too, by the page — onRevokeUsedCode) and, revoked, deleted. The Join key pop-up's, and Staff & Permissions'.
export function AccessCodesList({
  companyId,
  data,
  onReload,
  onRevokeUsedCode,
  roleFor,
}: {
  companyId: string;
  data: JoinCodesState | null;
  onReload: () => void;
  onRevokeUsedCode: (record: JoinCodeRecord) => void;
  roleFor?: AccessCodeRoleLookup;
}) {
  const [label, setLabel] = useState("");
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [newCode, setNewCode] = useState("");
  const [confirmRevokeKey, setConfirmRevokeKey] = useState("");
  // Codes deleted but still waiting on the Undo bar (see remove, below) — off the list meanwhile.
  const [hiddenKeys, setHiddenKeys] = useState<string[]>([]);
  const offerUndo = useUndo();

  const temporaryCodes = (data?.codes ?? []).filter((row) => row.kind === "temporary" && !hiddenKeys.includes(row.key));

  // A code's name being changed (its key, and the name as typed); names just saved, shown until the list reloads.
  const [renaming, setRenaming] = useState<{ key: string; label: string } | null>(null);
  const [savedLabels, setSavedLabels] = useState<Record<string, string>>({});
  const labelOf = (record: JoinCodeRecord) => savedLabels[record.key] ?? record.label;
  // Searched for: a code, its name, who it was sent to or who used it.
  const [query, setQuery] = useState("");
  const shownCodes = (() => {
    const q = query.trim().toLowerCase();
    if (!q) return temporaryCodes;
    return temporaryCodes.filter((row) =>
      [row.code, labelOf(row), row.invitedEmail, row.usedByName, row.usedByEmail].some((value) => String(value ?? "").toLowerCase().includes(q)),
    );
  })();
  // Its name saved (Enter, or clicking away) — unchanged, nothing's sent; couldn't be saved, it's back as it was, with why.
  const saveRename = async () => {
    const editing = renaming;
    setRenaming(null);
    if (!editing) return;
    const record = temporaryCodes.find((row) => row.key === editing.key);
    const next = editing.label.trim();
    if (!record || next === labelOf(record).trim()) return;
    setSavedLabels((prev) => ({ ...prev, [editing.key]: next }));
    setError("");
    const result = await renameTemporaryJoinCode(companyId, editing.key, next);
    if (!result.ok) {
      setSavedLabels((prev) => {
        const rest = { ...prev };
        delete rest[editing.key];
        return rest;
      });
      setError(result.error);
      return;
    }
    onReload();
  };

  const createCode = async () => {
    setBusy("create");
    setError("");
    const result = await createTemporaryJoinCode(companyId, label.trim());
    setBusy("");
    if (!result.ok) {
      setError(result.error);
      return;
    }
    setLabel("");
    setNewCode(result.code ?? "");
    onReload();
  };

  const revoke = async (record: JoinCodeRecord) => {
    if (record.status === "used") {
      onRevokeUsedCode(record);
      return;
    }
    if (confirmRevokeKey !== record.key) {
      setConfirmRevokeKey(record.key);
      return;
    }
    setBusy(record.key);
    setError("");
    const result = await revokeTemporaryJoinCode(companyId, record.key);
    setBusy("");
    setConfirmRevokeKey("");
    if (!result.ok) {
      setError(result.error);
      return;
    }
    if (newCode && record.code === newCode) setNewCode("");
    onReload();
  };

  // A revoked code, off the list (tap twice — the first asks), with the Undo bar after. A deleted code can't be put back
  // (it's gone from the server), so it's only hidden at first, and deleted as the bar goes without Undo being pressed
  // (its commit) — undone, it's just shown again. (Revoked already, it can't be joined with meanwhile.) Couldn't be
  // deleted, it's back, with why.
  const [confirmDeleteKey, setConfirmDeleteKey] = useState("");
  const remove = (record: JoinCodeRecord) => {
    if (confirmDeleteKey !== record.key) {
      setConfirmDeleteKey(record.key);
      return;
    }
    setConfirmDeleteKey("");
    setError("");
    setHiddenKeys((prev) => [...prev, record.key]);
    const showAgain = () => setHiddenKeys((prev) => prev.filter((key) => key !== record.key));
    offerUndo(`Access code ${record.code} deleted`, showAgain, {
      commit: async () => {
        const result = await deleteJoinCode(companyId, record.key);
        if (!result.ok) {
          showAgain();
          setError(result.error);
          return;
        }
        onReload();
      },
    });
  };

  return (
    <div className="space-y-2">
            <p className="text-[12.5px] leading-[1.5]" style={{ color: "var(--text-muted)" }}>
              A one-off code for one person. It stops working once they&apos;ve joined, so they never see the master code — and can&apos;t
              come back with it if they&apos;re removed. Inviting someone by email makes them one (they don&apos;t need to type it). Revoking a used
              code removes that person.
            </p>
            <div className="flex flex-wrap items-center gap-2">
              <input
                value={label}
                onChange={(event) => setLabel(event.target.value)}
                placeholder="Who's it for? (optional)"
                className={`${glassFieldClass} min-w-0 flex-1`}
                autoComplete="off"
                data-1p-ignore=""
                data-lpignore="true"
              />
              <button type="button" className={primaryButtonClass} style={primaryButtonStyle} disabled={busy === "create"} onClick={() => void createCode()}>
                <Plus size={14} /> {busy === "create" ? "Creating…" : "Create code"}
              </button>
            </div>
            {newCode ? (
              <div
                className="flex flex-wrap items-center gap-2 rounded-[12px] border px-3 py-2"
                style={{ borderColor: "color-mix(in srgb, var(--brand) 35%, transparent)", backgroundColor: "color-mix(in srgb, var(--brand) 8%, transparent)" }}
              >
                <span className="text-[12.5px]" style={{ color: "var(--text-main)" }}>New code:</span>
                <span className="font-mono text-[16px] font-bold tracking-[1.5px]" style={{ color: "var(--text-main)" }}>{newCode}</span>
                <span className="ml-auto">
                  <CopyButton value={newCode} />
                </span>
              </div>
            ) : null}

            {/* A search, once there are a few — and the list its own scroll, so the page doesn't keep growing. */}
            {temporaryCodes.length > 3 ? (
              <label className="relative block pt-1">
                <Search size={14} className="pointer-events-none absolute left-3 top-1/2 mt-0.5 -translate-y-1/2" style={{ color: "var(--text-muted)" }} />
                <input
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  placeholder="Search codes, names or emails"
                  aria-label="Search access codes"
                  className={`${glassFieldClass} w-full pl-8`}
                  autoComplete="off"
                  data-1p-ignore=""
                  data-lpignore="true"
                />
              </label>
            ) : null}
            {temporaryCodes.length && !shownCodes.length ? (
              <p className="px-1 py-2 text-[12.5px] font-medium" style={{ color: "var(--text-main)" }}>
                No access codes match &ldquo;{query.trim()}&rdquo;.
              </p>
            ) : null}
            {temporaryCodes.length ? (
              // (Columns wider than a phone — Code | Name | Status | its buttons — every row a subgrid of the list's, so
              // they line up, with headings over them. A phone: each row wraps as it needs.)
              <div className="glass-scroll -mr-2 flex max-h-[380px] flex-col gap-1.5 overflow-y-auto pr-2 pt-1 sm:grid sm:grid-cols-[minmax(132px,auto)_minmax(0,1fr)_minmax(0,1fr)_auto] sm:content-start sm:gap-x-3">
                {shownCodes.length ? (
                  <div className="hidden px-3 text-[11px] font-medium uppercase tracking-[0.6px] sm:col-span-4 sm:grid sm:grid-cols-subgrid" style={{ color: "var(--text-main)" }}>
                    <span>Code</span>
                    <span>Name</span>
                    <span>Status</span>
                    <span />
                  </div>
                ) : null}
                {shownCodes.map((record) => {
                  const state = record.status === "used" ? "used" : record.status === "revoked" ? "revoked" : "waiting";
                  const style = STATUS_STYLE[state];
                  const statusText =
                    state === "used"
                      ? `Used by ${record.usedByName || record.usedByEmail || "someone"}${record.usedAtIso ? ` · ${activeDateTime(record.usedAtIso)}` : ""}`
                      : state === "revoked"
                        ? `Revoked${record.revokedAtIso ? ` · ${activeDateTime(record.revokedAtIso)}` : ""}`
                        : "Not used yet";
                  const role = record.roleId && roleFor ? roleFor(record.roleId) : null;
                  return (
                    <div
                      key={record.key}
                      className="group/code flex flex-wrap items-center gap-x-3 gap-y-1.5 rounded-[12px] border px-3 py-2 sm:col-span-4 sm:grid sm:grid-cols-subgrid"
                      style={{ borderColor: "var(--glass-border)", opacity: state === "revoked" ? 0.65 : 1 }}
                    >
                      {/* (The role they start in, if it has one: pointed at — there's no Role column.) */}
                      <span className="font-mono text-[13.5px] font-semibold tracking-[1px]" style={{ color: "var(--text-main)" }} title={role ? `Starts as ${role.name}` : undefined}>
                        {record.code}
                      </span>
                      <span className="flex min-w-0 flex-col items-start">
                      {/* Its name: click it to change it (the code itself stays). An invite's shows who it was sent to as well. */}
                      {renaming?.key === record.key ? (
                        <input
                          value={renaming.label}
                          onChange={(event) => setRenaming({ key: record.key, label: event.target.value })}
                          onKeyDown={(event) => {
                            if (event.key === "Enter") {
                              event.preventDefault();
                              event.currentTarget.blur();
                            } else if (event.key === "Escape") {
                              event.preventDefault();
                              event.stopPropagation();
                              setRenaming(null);
                            }
                          }}
                          onBlur={() => void saveRename()}
                          placeholder="Who's it for?"
                          maxLength={80}
                          aria-label={`Name for ${record.code}`}
                          className={`${glassFieldClass} h-8! w-full min-w-[140px]`}
                          autoFocus
                          autoComplete="off"
                          data-1p-ignore=""
                          data-lpignore="true"
                        />
                      ) : (
                        <button
                          type="button"
                          onClick={() => setRenaming({ key: record.key, label: labelOf(record) })}
                          className="group -ml-1.5 inline-flex min-w-0 max-w-full items-center gap-1.5 rounded-[8px] px-1.5 py-0.5 text-[12.5px] font-medium transition hover:bg-[var(--panel-muted)]"
                          style={{ color: labelOf(record) ? "var(--text-main)" : "var(--text-muted)" }}
                          title="Rename"
                        >
                          <span className="truncate">{labelOf(record) || "Add a name"}</span>
                          {/* (Only with the row pointed at, or the name focused — a touch screen, always: there's no pointing.) */}
                          <Pencil size={12} className="shrink-0 opacity-0 transition group-hover/code:opacity-100 group-focus-visible:opacity-100 pointer-coarse:opacity-60" />
                        </button>
                      )}
                      {record.inviteId ? (
                        <span className="max-w-full truncate text-[11.5px] font-medium" style={{ color: "var(--text-muted)" }}>
                          Invite · {record.invitedEmail}
                        </span>
                      ) : null}
                      </span>
                      <span className="min-w-0">
                        <span
                          className="inline-block max-w-full truncate rounded-full px-2.5 py-0.5 align-middle text-[11.5px] font-semibold"
                          style={{ backgroundColor: style.bg, color: style.fg }}
                          title={statusText}
                        >
                          {statusText}
                        </span>
                      </span>
                      <span className="ml-auto flex items-center justify-end gap-1.5">
                        {state === "waiting" ? <CopyButton value={record.code} /> : null}
                        {state !== "revoked" ? (
                          <button
                            type="button"
                            className={smallButtonClass}
                            disabled={busy === record.key}
                            onClick={() => void revoke(record)}
                            style={
                              confirmRevokeKey === record.key || state === "used"
                                ? { backgroundImage: "var(--danger-gradient)", color: "#fff", borderColor: "transparent" }
                                : undefined
                            }
                          >
                            {busy === record.key ? "Revoking…" : confirmRevokeKey === record.key ? "Revoke code?" : state === "used" ? "Revoke & remove" : "Revoke"}
                          </button>
                        ) : (
                          <button
                            type="button"
                            className={smallButtonClass}
                            disabled={busy === record.key}
                            onClick={() => remove(record)}
                            style={
                              confirmDeleteKey === record.key
                                ? { backgroundImage: "var(--danger-gradient)", color: "#fff", borderColor: "transparent" }
                                : undefined
                            }
                          >
                            <Trash2 size={13} />
                            {busy === record.key ? "Deleting…" : confirmDeleteKey === record.key ? "Delete code?" : "Delete"}
                          </button>
                        )}
                      </span>
                    </div>
                  );
                })}
              </div>
            ) : (
              <EmptyState compact icon={<KeyRound size={16} />} title="No access codes yet" hint="Codes you create show here, with who used them." />
            )}
      {error ? <p className="text-[12.5px] font-medium" style={{ color: "var(--danger)" }}>{error}</p> : null}
    </div>
  );
}
