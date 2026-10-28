import * as Sentry from "@sentry/nextjs";

// Next runs this as the server starts: crash reporting there (sentry.server.config.ts; the browser's is
// instrumentation-client.ts). There's no edge code, so just Node's.
export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    await import("./sentry.server.config");
  }
}

// An error from a request (an API route, a page's server side), reported.
export const onRequestError = Sentry.captureRequestError;
