import * as Sentry from "@sentry/nextjs";
import { crashReportingOptions } from "@/lib/crash-reporting";

// Crash reporting on the server (lib/crash-reporting.ts): the API routes and pages' server side. Started by
// instrumentation.ts.
Sentry.init(crashReportingOptions());
