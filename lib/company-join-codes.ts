"use client";

import { authorizedFetch } from "@/lib/api-fetch";
import { collection, deleteDoc, doc, getDocs } from "@/lib/firestore-client";
import { db } from "@/lib/firebase";

// The app's side of a company's join codes and invites (Company Settings > Company > Join key, and
// Staff > Invited). The codes themselves are handled by /api/company/join-codes — see
// lib/company-join-codes-server.ts for what master and temporary codes are.

export type JoinCodeRecord = {
  key: string;
  code: string;
  kind: "master" | "temporary";
  status: "active" | "used" | "revoked" | "replaced";
  label: string;
  createdAtIso: string;
  createdByName: string;
  usedByUid: string;
  usedByName: string;
  usedByEmail: string;
  usedAtIso: string;
  revokedAtIso: string;
};

export type JoinCodesState = { masterCode: string; masterKey: string; codes: JoinCodeRecord[] };

export type CompanyInviteRow = {
  id: string;
  email: string;
  invitedByName: string;
  createdAtIso: string;
};

const ERROR_MESSAGES: Record<string, string> = {
  "code-taken": "Another company already uses that code. Pick a different one.",
  "too-short": "Use at least 4 characters.",
  "member-still-in-company": "Remove the person who used this code first.",
  forbidden: "You don't have access to join codes.",
  preview: "Not available in the CutSmart Preview.",
};

function messageFor(error: unknown): string {
  return ERROR_MESSAGES[String(error ?? "")] ?? "Something went wrong. Try again.";
}

export async function fetchJoinCodes(companyId: string): Promise<{ ok: true; data: JoinCodesState } | { ok: false; error: string }> {
  try {
    const res = await authorizedFetch(`/api/company/join-codes?companyId=${encodeURIComponent(companyId)}`, { cache: "no-store" });
    const data = (await res.json().catch(() => ({}))) as Partial<JoinCodesState> & { ok?: boolean; error?: string };
    if (!data.ok) return { ok: false, error: messageFor(data.error) };
    return { ok: true, data: { masterCode: String(data.masterCode ?? ""), masterKey: String(data.masterKey ?? ""), codes: Array.isArray(data.codes) ? data.codes : [] } };
  } catch {
    return { ok: false, error: messageFor("") };
  }
}

async function postJoinCodes(companyId: string, body: Record<string, unknown>): Promise<{ ok: boolean; error: string; code?: string }> {
  try {
    const res = await authorizedFetch("/api/company/join-codes", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ companyId, ...body }),
    });
    const data = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string; code?: string };
    return data.ok ? { ok: true, error: "", code: data.code } : { ok: false, error: messageFor(data.error) };
  } catch {
    return { ok: false, error: messageFor("") };
  }
}

export const createTemporaryJoinCode = (companyId: string, label: string) => postJoinCodes(companyId, { action: "create-temporary", label });
export const changeMasterJoinCode = (companyId: string, code: string) => postJoinCodes(companyId, { action: "change-master", code });
export const revokeTemporaryJoinCode = (companyId: string, key: string) => postJoinCodes(companyId, { action: "revoke", key });

// Invites waiting to be accepted.
export async function fetchCompanyInvites(companyId: string): Promise<CompanyInviteRow[]> {
  if (!db || !companyId) return [];
  try {
    const snap = await getDocs(collection(db, "companies", companyId, "invites"));
    return snap.docs
      .map((row) => {
        const data = (row.data() ?? {}) as Record<string, unknown>;
        return {
          id: row.id,
          email: String(data.email ?? data.emailLower ?? "").trim(),
          invitedByName: String(data.invitedByName ?? "").trim(),
          createdAtIso: String(data.createdAtIso ?? "").trim(),
        };
      })
      .filter((row) => row.email)
      .sort((a, b) => b.createdAtIso.localeCompare(a.createdAtIso));
  } catch {
    return [];
  }
}

export async function cancelCompanyInvite(companyId: string, inviteId: string): Promise<boolean> {
  if (!db || !companyId || !inviteId) return false;
  try {
    await deleteDoc(doc(db, "companies", companyId, "invites", inviteId));
    return true;
  } catch {
    return false;
  }
}
