import { readFile } from "fs/promises";
import path from "path";
import { parseDevEmails } from "@/lib/dev-emails";

// A file from public/ on the server: from disk where the server has the project's files (a local dev
// server), otherwise from the site itself (Vercel serves public/ apart from the server code). "" if neither.
export async function readPublicTextFile(fileName: string, siteOrigin: string): Promise<string> {
  try {
    return await readFile(path.join(process.cwd(), "public", fileName), "utf8");
  } catch {
    // Not on disk here — ask the site.
  }
  try {
    const response = await fetch(new URL(`/${fileName}`, siteOrigin), { cache: "no-store" });
    return response.ok ? await response.text() : "";
  } catch {
    return "";
  }
}

// Whether an email is a Dev user's (public/dev-emails.txt — see lib/dev-emails.ts).
export async function isDevEmailOnServer(email: string, siteOrigin: string): Promise<boolean> {
  const clean = String(email || "").trim().toLowerCase();
  if (!clean) return false;
  return parseDevEmails(await readPublicTextFile("dev-emails.txt", siteOrigin)).has(clean);
}
