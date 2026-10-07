import { parseDevEmails } from "@/lib/dev-emails";
import { readPublicTextFile } from "@/lib/public-file-server";

// Whether an email is a Dev user's (public/dev-emails.txt — see lib/dev-emails.ts).
export async function isDevEmailOnServer(email: string, siteOrigin: string): Promise<boolean> {
  const clean = String(email || "").trim().toLowerCase();
  if (!clean) return false;
  return parseDevEmails(await readPublicTextFile("dev-emails.txt", siteOrigin)).has(clean);
}
