"use client";

import {
  collectionGroup,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  limit,
  query,
  serverTimestamp,
  setDoc,
  where,
} from "@/lib/firestore-client";
import { authorizedFetch } from "@/lib/api-fetch";
import { invalidateCompanyCache, invalidateUserCache } from "@/lib/firestore-cache";
import { db, hasFirebaseConfig } from "@/lib/firebase";

// Creating a company, joining one with its code, and accepting/declining invites — the last step of
// signing up (see components/login/login-screen.tsx). Used to live in app/(staff)/company-onboarding.

export const ACTIVE_COMPANY_STORAGE_KEY = "cutsmart_active_company_id";

export type CompanyInvite = {
  id: string;
  companyId: string;
  companyName: string;
  code: string;
};

type OnboardingUser = { uid: string; email?: string | null; displayName?: string | null };

const DEFAULT_COMPANY_ROLE_DEFS = [
  {
    id: "owner",
    name: "Owner",
    color: "#1F2937",
    permissions: {
      "company.*": true,
      "company.dashboard.view": true,
      "clients.view": true,
      "clients.view.all": true,
      "leads.view": true,
      "leads.view.others": true,
      "projects.create": true,
      "projects.view": true,
      "projects.view.others": true,
      "projects.edit.others": true,
      "projects.status": true,
      "projects.create.others": true,
      "sales.view": true,
      "sales.edit": true,
      "production.view": true,
      "production.edit": true,
      "production.key": true,
      "staff.add": true,
      "staff.remove": true,
      "staff.change.role": true,
      "staff.change.display_name": true,
      "company.settings": true,
      "company.updates": true,
      "dashboard.complete.bonus": true,
    },
  },
  {
    id: "admin",
    name: "Admin",
    color: "#2F6BFF",
    permissions: {
      "company.*": true,
      "company.dashboard.view": true,
      "clients.view": true,
      "clients.view.all": true,
      "leads.view": true,
      "leads.view.others": true,
      "projects.create": true,
      "projects.view": true,
      "projects.view.others": true,
      "projects.edit.others": true,
      "projects.status": true,
      "projects.create.others": true,
      "sales.view": true,
      "sales.edit": true,
      "production.view": true,
      "production.edit": true,
      "production.key": true,
      "staff.add": true,
      "staff.remove": true,
      "staff.change.role": true,
      "staff.change.display_name": true,
      "company.settings": true,
      "company.updates": true,
      "dashboard.complete.bonus": true,
    },
  },
  {
    id: "staff",
    name: "Staff",
    color: "#7D99B3",
    permissions: {
      "company.dashboard.view": true,
      "calendar.view": true,
    },
  },
] as const;

function randToken(length: number) {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let out = "";
  for (let i = 0; i < length; i += 1) {
    out += chars[Math.floor(Math.random() * chars.length)];
  }
  return out;
}

function companyIdFromName(name: string) {
  const seed = String(name || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 16);
  return `cmp_${seed || "new"}_${randToken(6).toLowerCase()}`;
}

function joinCodeKeyFromInput(v: string) {
  return String(v || "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "");
}

function rememberActiveCompany(companyId: string) {
  try {
    window.localStorage.setItem(ACTIVE_COMPANY_STORAGE_KEY, companyId);
  } catch {
    // storage unavailable — the app resolves the company itself
  }
}

// Invites sent to this email address, from any company.
export async function loadCompanyInvites(email: string): Promise<{ invites: CompanyInvite[]; error: string }> {
  const emailLower = String(email || "").trim().toLowerCase();
  if (!db || !hasFirebaseConfig || !emailLower) return { invites: [], error: "" };
  try {
    const snap = await getDocs(query(collectionGroup(db, "invites"), where("emailLower", "==", emailLower), limit(100)));
    const rows: CompanyInvite[] = [];
    for (const row of snap.docs) {
      const data = (row.data() ?? {}) as Record<string, unknown>;
      const companyId = String(row.ref.parent.parent?.id ?? "").trim();
      if (!companyId) continue;
      rows.push({
        id: row.id,
        companyId,
        companyName: String(data.companyName ?? "").trim() || companyId,
        code: String(data.companyCode ?? data.joinCode ?? data.code ?? "").trim(),
      });
    }
    const invites = Array.from(new Map(rows.map((row) => [`${row.companyId}:${row.id}`, row])).values());
    return { invites, error: "" };
  } catch {
    return { invites: [], error: "Couldn't load your invites." };
  }
}

// Joining goes through the server (app/api/company/join), which also uses up a one-person code.
async function joinThroughServer(user: OnboardingUser, body: Record<string, unknown>): Promise<{ ok: boolean; error: string }> {
  try {
    const res = await authorizedFetch("/api/company/join", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const data = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string; companyId?: string };
    const companyId = String(data.companyId ?? "").trim();
    if (!data.ok || !companyId) return { ok: false, error: String(data.error ?? "") };
    // Fresh reads next time: the user, their company and membership just changed.
    invalidateUserCache(user.uid);
    invalidateCompanyCache();
    rememberActiveCompany(companyId);
    return { ok: true, error: "" };
  } catch {
    return { ok: false, error: "network" };
  }
}

// Joins the company whose code this is. Returns an error message, or "" when joined.
export async function joinCompanyWithCode(user: OnboardingUser, code: string): Promise<string> {
  if (!joinCodeKeyFromInput(code)) return "Enter your company code.";
  const result = await joinThroughServer(user, { code });
  if (result.ok) return "";
  return result.error === "no-such-code" ? "That code doesn't work. Check it with your admin." : "Couldn't join the company. Try again.";
}

export async function acceptCompanyInvite(user: OnboardingUser, invite: CompanyInvite): Promise<string> {
  const result = await joinThroughServer(user, { inviteCompanyId: invite.companyId, inviteId: invite.id });
  if (result.ok) return "";
  return result.error === "no-such-invite" ? "That invite has been cancelled." : "Couldn't accept the invite. Try again.";
}

export async function declineCompanyInvite(invite: CompanyInvite): Promise<string> {
  if (!db) return "Can't reach the database.";
  try {
    await deleteDoc(doc(db, "companies", invite.companyId, "invites", invite.id));
    return "";
  } catch {
    return "Couldn't decline the invite. Try again.";
  }
}

// Creates a company with this user as its owner. Returns an error message, or "" when created.
export async function createCompany(user: OnboardingUser, name: string, code: string): Promise<string> {
  if (!db) return "Can't reach the database.";
  const companyName = String(name || "").trim();
  const joinCode = String(code || "").trim();
  if (!companyName) return "Enter a company name.";
  if (!joinCode) return "Pick a company code.";
  try {
    const joinCodeKey = joinCodeKeyFromInput(joinCode);
    // A code another company already uses would send their staff here instead.
    const existing = await getDoc(doc(db, "companyJoinCodes", joinCodeKey)).catch(() => null);
    if (existing?.exists() && String((existing.data() as Record<string, unknown>)?.companyId ?? "").trim()) {
      return "That code is taken. Pick another one.";
    }
    const companyId = companyIdFromName(companyName);
    const ownerName = String(user.displayName || user.email || "Owner").trim();
    const nowIso = new Date().toISOString();

    await setDoc(
      doc(db, "companies", companyId),
      {
        name: companyName,
        companyName,
        applicationPreferences: { companyName },
        roles: DEFAULT_COMPANY_ROLE_DEFS,
        id: companyId,
        ownerUid: user.uid,
        ownerId: user.uid,
        companyCode: joinCode,
        companyPassword: joinCode,
        joinCode,
        joinPassword: joinCode,
        createdAt: serverTimestamp(),
        createdAtIso: nowIso,
        updatedAt: serverTimestamp(),
        updatedAtIso: nowIso,
      },
      { merge: true },
    );
    await setDoc(
      doc(db, "companyJoinCodes", joinCodeKey),
      {
        id: joinCodeKey,
        companyId,
        companyName,
        active: true,
        updatedAt: serverTimestamp(),
        updatedAtIso: nowIso,
        createdAt: serverTimestamp(),
        createdAtIso: nowIso,
      },
      { merge: true },
    );
    await setDoc(
      doc(db, "companies", companyId, "memberships", user.uid),
      {
        uid: user.uid,
        email: user.email || "",
        displayName: ownerName,
        role: "owner",
        roleId: "owner",
        createdAt: serverTimestamp(),
        createdAtIso: nowIso,
        updatedAt: serverTimestamp(),
        updatedAtIso: nowIso,
      },
      { merge: true },
    );
    await setDoc(
      doc(db, "companies", companyId, "clients", "__meta"),
      {
        id: "__meta",
        companyId,
        type: "clients-meta",
        createdAt: serverTimestamp(),
        createdAtIso: nowIso,
        updatedAt: serverTimestamp(),
        updatedAtIso: nowIso,
      },
      { merge: true },
    );
    invalidateUserCache(user.uid);
    invalidateCompanyCache();
    await setDoc(
      doc(db, "users", user.uid),
      { email: user.email || "", displayName: ownerName, companyId, updatedAt: serverTimestamp(), updatedAtIso: nowIso },
      { merge: true },
    );
    rememberActiveCompany(companyId);
    return "";
  } catch {
    return "Couldn't create the company. Try again.";
  }
}
