import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "CutSmart Web",
  description: "CutSmart web workspace for sales and production cutlists.",
  manifest: "/manifest.json",
  // Makes "Add to Home Screen" on iOS launch as a standalone app (no Safari
  // title/URL bar or bottom toolbar) instead of a plain bookmark — see
  // public/manifest.json for the Android/other-PWA equivalent (display: "standalone").
  appleWebApp: {
    capable: true,
    statusBarStyle: "default",
    title: "CutSmart",
  },
  icons: {
    // iOS ignores manifest.json's icons entirely — it only reads this apple-touch-icon.
    apple: "/apple-touch-icon.png",
  },
  other: {
    // Next's appleWebApp.capable only emits the newer unprefixed "mobile-web-app-capable" —
    // older iOS versions only recognize this Apple-specific one, so both are needed to
    // reliably get standalone (no Safari chrome) mode across iOS versions.
    "apple-mobile-web-app-capable": "yes",
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
  viewportFit: "cover",
  themeColor: "#2563eb",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <script
          dangerouslySetInnerHTML={{
            __html: `
              (function () {
                try {
                  var mode = localStorage.getItem("cutsmart_theme_mode");
                  var next = String(mode || "").trim().toLowerCase() === "dark" ? "dark" : "light";
                  document.documentElement.setAttribute("data-theme", next);
                  document.documentElement.style.colorScheme = next;
                  if (document.body) {
                    document.body.setAttribute("data-theme", next);
                    document.body.style.colorScheme = next;
                  } else {
                    document.addEventListener("DOMContentLoaded", function () {
                      document.body.setAttribute("data-theme", next);
                      document.body.style.colorScheme = next;
                    }, { once: true });
                  }
                } catch (e) {}
              })();
            `,
          }}
        />
      </head>
      <body className="cs-app" suppressHydrationWarning>
        {/* No AuthProvider/AppTabsProvider/GlobalAppTabsBar here — this root layout wraps EVERY
            route, including the public, no-login app/client/*. Those live in
            app/(staff)/layout.tsx instead, scoped to just the staff-facing routes (login, company
            onboarding, and everything under (app)) — see that file's own comment for why. */}
        {children}
      </body>
    </html>
  );
}
