import * as Sentry from "@sentry/nextjs";

// Crash reporting (Sentry): every error someone hits — on their phone or computer, and on the server — reported with
// its stack and the page it was on, so it can be fixed before anyone has to mention it. Off until the project's key
// is set (NEXT_PUBLIC_SENTRY_DSN on Vercel), and never from a computer running the app locally.
//
// Errors only: no screen recordings, no performance tracing. And nothing personal — no email, IP address, cookies,
// headers, form contents or request bodies: someone is just their uid, and their company its id (CrashReportUser).
//
// Started by instrumentation-client.ts (the browser) and sentry.server.config.ts (the server).

export const CRASH_REPORTING_DSN = process.env.NEXT_PUBLIC_SENTRY_DSN || "";

export function crashReportingOptions() {
  return {
    dsn: CRASH_REPORTING_DSN || undefined,
    enabled: Boolean(CRASH_REPORTING_DSN) && process.env.NODE_ENV === "production",
    // "production", or "preview" for a Vercel preview deploy.
    environment: process.env.NEXT_PUBLIC_VERCEL_ENV || process.env.VERCEL_ENV || "production",
    tracesSampleRate: 0,
    dataCollection: {
      userInfo: false,
      cookies: false,
      httpHeaders: false,
      httpBodies: [],
      urlQueryParams: false,
      databaseQueryData: false,
      stackFrameVariables: false,
      queues: false,
      graphQL: { document: false, variables: false },
      genAI: { inputs: false, outputs: false },
    },
    ignoreErrors: [
      // The browser's own harmless notice, not a fault.
      "ResizeObserver loop limit exceeded",
      "ResizeObserver loop completed with undelivered notifications",
    ],
  } satisfies Sentry.BrowserOptions & Sentry.NodeOptions;
}

// An error caught on the way (a page's "Something went wrong"), reported. Its reference — to match it up with what
// someone says they saw — or "" when crash reporting's off.
export function reportError(error: unknown): string {
  const eventId = Sentry.captureException(error);
  return Sentry.isEnabled() ? eventId : "";
}

// Who's signed in, for the reports: just their uid and their company's id (or no one).
export function setCrashReportUser(uid: string, companyId: string) {
  Sentry.setUser(uid ? { id: uid } : null);
  Sentry.setTag("companyId", companyId || undefined);
}
