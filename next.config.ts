import type { NextConfig } from "next";
import { withSentryConfig } from "@sentry/nextjs/config";

const nextConfig: NextConfig = {
  // The server reads these from its own deploy (lib/public-file-server.ts) — e.g. publishing a staged
  // deploy's What's New, whose address can't be fetched past Vercel's protection.
  outputFileTracingIncludes: {
    "/api/**/*": ["./public/release-notes.txt", "./public/dev-emails.txt"],
  },
  // The Contacts page used to be at /clients — old links, bookmarks and home-screen icons still land on it
  // (with their ?contact=<id> kept).
  async redirects() {
    return [
      { source: "/clients", destination: "/contacts", permanent: true },
      { source: "/clients/:path*", destination: "/contacts/:path*", permanent: true },
    ];
  },
  async headers() {
    return [
      {
        // The phone/desktop notifications service worker (public/sw.js): never cached, so an update
        // always reaches devices.
        source: "/sw.js",
        headers: [
          { key: "Content-Type", value: "application/javascript; charset=utf-8" },
          { key: "Cache-Control", value: "no-cache, no-store, must-revalidate" },
        ],
      },
    ];
  },
};

// Crash reporting (lib/crash-reporting.ts). With SENTRY_AUTH_TOKEN, SENTRY_ORG and SENTRY_PROJECT set on Vercel, each
// build also sends Sentry its source maps — so a report shows the real code, not the minified — and then deletes them
// from the build, so they're never served. Without them, no source maps at all.
export default withSentryConfig(nextConfig, {
  org: process.env.SENTRY_ORG,
  project: process.env.SENTRY_PROJECT,
  authToken: process.env.SENTRY_AUTH_TOKEN,
  sourcemaps: { disable: !process.env.SENTRY_AUTH_TOKEN },
  widenClientFileUpload: true,
  // Nothing about the build itself sent to Sentry, and quiet locally.
  telemetry: false,
  silent: !process.env.CI,
  // Errors only (no tracing, no screen recordings): their code left out of the app.
  bundleSizeOptimizations: {
    excludeDebugStatements: true,
    excludeTracing: true,
    excludeReplayShadowDom: true,
    excludeReplayIframe: true,
    excludeReplayWorker: true,
  },
});
