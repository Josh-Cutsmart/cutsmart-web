"use client";

import { useState } from "react";
import { createPortal } from "react-dom";
import { GlassModalHeader } from "@/components/glass-modal-header";
import { Check, Copy, Eye, EyeOff, KeyRound, Plus, Trash2 } from "lucide-react";
import { glassFieldClass, primaryButtonClass, primaryButtonStyle, smallButtonClass } from "@/components/settings-ui";
import { activeDateTime } from "@/lib/company-formats";
import { Skeleton, SkeletonGroup } from "@/components/skeleton";
import { useUndo } from "@/components/undo-bar";
import {
  changeMasterJoinCode,
  createTemporaryJoinCode,
  deleteJoinCode,
  revokeTemporaryJoinCode,
  type JoinCodeRecord,
  type JoinCodesState,
} from "@/lib/company-join-codes";

// Company Settings > Company > Join key: the company's master code (with a way to change it) and
// one-person temporary codes (create, copy, revoke, and delete once revoked) — see
// lib/company-join-codes-server.ts. Inviting someone (Staff > Add staff) makes them one too, shown with
// who it was sent to.
// Revoking a code someone has already used means removing them, which the page does (its Remove Staff
// pop-up, then the revoke) through onRevokeUsedCode.

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
}: {
  companyId: string;
  companyName: string;
  data: JoinCodesState | null;
  loading: boolean;
  loadError: string;
  onReload: () => void;
  onClose: () => void;
  onRevokeUsedCode: (record: JoinCodeRecord) => void;
}) {
  const [showMaster, setShowMaster] = useState(false);
  const [changing, setChanging] = useState(false);
  const [nextMaster, setNextMaster] = useState("");
  const [label, setLabel] = useState("");
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [newCode, setNewCode] = useState("");
  const [confirmRevokeKey, setConfirmRevokeKey] = useState("");
  // Codes deleted but still waiting on the Undo bar (see remove, below) — off the list meanwhile.
  const [hiddenKeys, setHiddenKeys] = useState<string[]>([]);
  const offerUndo = useUndo();

  const temporaryCodes = (data?.codes ?? []).filter((row) => row.kind === "temporary" && !hiddenKeys.includes(row.key));

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
    offerUndo(`Code ${record.code} deleted`, showAgain, {
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
                <p className="text-[15px] font-semibold" style={{ color: "var(--text-main)" }}>Temporary codes</p>
                <p className="text-[12.5px] leading-[1.5]" style={{ color: "var(--text-muted)" }}>
                  A one-off code for one person. It stops working once they&apos;ve joined, so they never see the master code — and can&apos;t
                  come back with it if they&apos;re removed. Revoking a used code removes that person.
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

                {temporaryCodes.length ? (
                  <div className="space-y-1.5 pt-1">
                    {temporaryCodes.map((record) => {
                      const state = record.status === "used" ? "used" : record.status === "revoked" ? "revoked" : "waiting";
                      const style = STATUS_STYLE[state];
                      const statusText =
                        state === "used"
                          ? `Used by ${record.usedByName || record.usedByEmail || "someone"}${record.usedAtIso ? ` · ${activeDateTime(record.usedAtIso)}` : ""}`
                          : state === "revoked"
                            ? `Revoked${record.revokedAtIso ? ` · ${activeDateTime(record.revokedAtIso)}` : ""}`
                            : "Not used yet";
                      return (
                        <div
                          key={record.key}
                          className="flex flex-wrap items-center gap-x-3 gap-y-1.5 rounded-[12px] border px-3 py-2"
                          style={{ borderColor: "var(--glass-border)", opacity: state === "revoked" ? 0.65 : 1 }}
                        >
                          <span className="font-mono text-[13.5px] font-semibold tracking-[1px]" style={{ color: "var(--text-main)" }}>{record.code}</span>
                          {record.inviteId ? (
                            <span className="truncate text-[12.5px]" style={{ color: "var(--text-muted)" }}>
                              Invite · {record.invitedEmail || record.label}
                            </span>
                          ) : record.label ? (
                            <span className="truncate text-[12.5px]" style={{ color: "var(--text-muted)" }}>{record.label}</span>
                          ) : null}
                          <span className="rounded-full px-2.5 py-0.5 text-[11.5px] font-semibold" style={{ backgroundColor: style.bg, color: style.fg }}>
                            {statusText}
                          </span>
                          <span className="ml-auto flex items-center gap-1.5">
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
                ) : null}
              </section>
              {error ? <p className="text-[12.5px] font-medium" style={{ color: "var(--danger)" }}>{error}</p> : null}
            </>
          )}
        </div>
      </div>
    </div>
  , document.body);
}
