import { readFile } from "fs/promises";
import path from "path";

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
