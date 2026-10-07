// The application-wide Dev users: public/dev-emails.txt, one email per line (lines starting with # are
// notes). Dev users get dev mode (components/dev-mode.tsx). The file is public, so anything a Dev user
// can do on the server checks the list there again (lib/dev-emails-server.ts) — never trusted from the app.

export function parseDevEmails(raw: string): Set<string> {
  return new Set(
    raw
      .split(/\r?\n|,/g)
      .map((line) => String(line || "").trim().toLowerCase())
      .filter((line) => line && !line.startsWith("#")),
  );
}

// In the app: whether this email is a Dev user's (false if the list can't be read).
export async function fetchIsDevEmail(email: string): Promise<boolean> {
  const clean = String(email || "").trim().toLowerCase();
  if (!clean) return false;
  try {
    const response = await fetch("/dev-emails.txt", { cache: "no-store" });
    return response.ok && parseDevEmails(await response.text()).has(clean);
  } catch {
    return false;
  }
}
