import { randomInt } from "crypto";
import { FieldValue, type Firestore } from "firebase-admin/firestore";
import { joinCodeKeyFor, MIN_MASTER_CODE_LENGTH, otherFormOfJoinKey } from "@/lib/company-join-codes-server";

// Creating a company, with the person creating it as its owner: the last step of signing up (app/api/company/create). Done on the
// server because firestore.rules doesn't let the app write companies, memberships or join codes itself: it's that which stops
// someone making themselves owner of a company that isn't theirs. All of it happens together, or none of it.

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
      "company.report": true,
      "projects.automate": true,
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
      "company.report": true,
      "projects.automate": true,
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

const MAX_NAME_LENGTH = 120;
const MAX_CODE_LENGTH = 64;

function toStr(v: unknown): string {
  return String(v ?? "").trim();
}

function companyIdFromName(name: string): string {
  const seed = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 16);
  const chars = "abcdefghjkmnpqrstuvwxyz23456789";
  let token = "";
  for (let i = 0; i < 6; i += 1) token += chars[randomInt(chars.length)];
  return `cmp_${seed || "new"}_${token}`;
}

// What a database can't take as a document's id (a code is stored under its key).
function usableAsKey(key: string): boolean {
  return !key.includes("/") && key !== "." && key !== ".." && !/^__.*__$/.test(key);
}

export async function createCompanyWithOwner(
  db: Firestore,
  owner: { uid: string; email: string; name: string },
  nameRaw: unknown,
  codeRaw: unknown,
): Promise<{ ok: true; companyId: string } | { ok: false; error: string }> {
  const companyName = toStr(nameRaw).slice(0, MAX_NAME_LENGTH);
  const joinCode = toStr(codeRaw);
  const joinCodeKey = joinCodeKeyFor(joinCode);
  if (!companyName) return { ok: false, error: "missing-name" };
  if (!joinCodeKey) return { ok: false, error: "missing-code" };
  if (joinCodeKey.length < MIN_MASTER_CODE_LENGTH) return { ok: false, error: "code-too-short" };
  if (joinCode.length > MAX_CODE_LENGTH || !usableAsKey(joinCodeKey)) return { ok: false, error: "invalid-code" };

  const companyId = companyIdFromName(companyName);
  const companyRef = db.collection("companies").doc(companyId);
  const lookupRef = db.collection("companyJoinCodes").doc(joinCodeKey);
  const otherKey = otherFormOfJoinKey(joinCodeKey);
  const otherLookupRef = otherKey ? db.collection("companyJoinCodes").doc(otherKey) : null;
  const ownerName = owner.name || owner.email || "Owner";

  return db.runTransaction(async (tx) => {
    // A code another company already uses would send their staff here instead. (Joining tries a code with and without its dash, so
    // either form being in use counts.)
    const [lookup, otherLookup] = await Promise.all([tx.get(lookupRef), otherLookupRef ? tx.get(otherLookupRef) : Promise.resolve(null)]);
    if ((lookup.exists && toStr(lookup.data()?.companyId)) || (otherLookup?.exists && toStr(otherLookup.data()?.companyId))) {
      return { ok: false as const, error: "code-taken" };
    }
    const nowIso = new Date().toISOString();
    const stamps = {
      createdAt: FieldValue.serverTimestamp(),
      createdAtIso: nowIso,
      updatedAt: FieldValue.serverTimestamp(),
      updatedAtIso: nowIso,
    };
    // (create: refuses rather than overwrites, were that id ever already in use.)
    tx.create(companyRef, {
      name: companyName,
      companyName,
      applicationPreferences: { companyName },
      roles: DEFAULT_COMPANY_ROLE_DEFS,
      id: companyId,
      ownerUid: owner.uid,
      ownerId: owner.uid,
      companyCode: joinCode,
      companyPassword: joinCode,
      joinCode,
      joinPassword: joinCode,
      ...stamps,
    });
    tx.set(lookupRef, { id: joinCodeKey, companyId, companyName, active: true, ...stamps });
    tx.set(companyRef.collection("memberships").doc(owner.uid), {
      uid: owner.uid,
      email: owner.email,
      displayName: ownerName,
      role: "owner",
      roleId: "owner",
      ...stamps,
    });
    tx.set(companyRef.collection("clients").doc("__meta"), { id: "__meta", companyId, type: "clients-meta", ...stamps });
    tx.set(
      db.collection("users").doc(owner.uid),
      { email: owner.email, displayName: ownerName, companyId, updatedAt: FieldValue.serverTimestamp(), updatedAtIso: nowIso },
      { merge: true },
    );
    return { ok: true as const, companyId };
  });
}
