import * as Sentry from "@sentry/nextjs";
import { crashReportingOptions } from "@/lib/crash-reporting";
import { isPreviewMode } from "@/lib/preview-mode";

// Crash reporting in the browser (lib/crash-reporting.ts) — Next runs this before the app starts. An error from the
// CutSmart Preview is marked as one: it's the made-up company, not a real one's data.
Sentry.init({
  ...crashReportingOptions(),
  beforeSend(event) {
    if (isPreviewMode()) event.tags = { ...event.tags, preview: "yes" };
    return event;
  },
});
