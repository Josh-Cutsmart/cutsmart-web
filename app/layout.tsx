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
        {/* TEMPORARY mobile debugging aid — remove once done. Visit any page with ?debug=1 once
            (the flag persists in localStorage across navigation/reload, since a PWA relaunch or
            pull-to-reload won't keep query params) to get a small floating "Logs" button. Tapping
            it opens a full-screen plain-text panel with every console.log/warn/error plus any
            uncaught window error/unhandled promise rejection captured since page load, in a
            read-only textarea — "Select All" pre-selects everything so a plain tap-hold-copy (or
            the OS's own copy popup) reliably grabs the whole thing, without depending on any
            third-party console UI's own copy affordance. Visit with ?debug=0 to turn it back off.
            Loads nothing and captures nothing for every other visitor — this whole block is a
            no-op unless the flag is set. */}
        <script
          dangerouslySetInnerHTML={{
            __html: `
              (function () {
                try {
                  var params = new URLSearchParams(window.location.search);
                  if (params.get("debug") === "1") {
                    localStorage.setItem("cutsmart_debug_console", "1");
                  } else if (params.get("debug") === "0") {
                    localStorage.removeItem("cutsmart_debug_console");
                  }

                  // In-app activation for when there's no address bar to type ?debug=1 into (this
                  // app runs standalone/PWA on mobile, which hides the URL entirely) — 5 taps
                  // anywhere on screen within 3 seconds toggles the flag and reloads once, so
                  // capturing starts from the very top of the next page load either way, same as
                  // visiting with ?debug=1 directly. Registered unconditionally (before the
                  // early-return below) so it works to turn the panel OFF again too, and so a
                  // first-time user can discover it with nothing set up yet.
                  var tapCount = 0;
                  var tapResetTimer = null;
                  document.addEventListener("click", function () {
                    tapCount += 1;
                    if (tapResetTimer) clearTimeout(tapResetTimer);
                    tapResetTimer = setTimeout(function () { tapCount = 0; }, 3000);
                    if (tapCount >= 5) {
                      tapCount = 0;
                      if (localStorage.getItem("cutsmart_debug_console") === "1") {
                        localStorage.removeItem("cutsmart_debug_console");
                      } else {
                        localStorage.setItem("cutsmart_debug_console", "1");
                      }
                      window.location.reload();
                    }
                  }, true);

                  if (localStorage.getItem("cutsmart_debug_console") !== "1") return;

                  var logs = [];
                  function record(level, args) {
                    try {
                      var parts = Array.prototype.map.call(args, function (a) {
                        if (a && a instanceof Error) return a.stack || a.message;
                        if (a && typeof a === "object") {
                          try { return JSON.stringify(a); } catch (e2) { return String(a); }
                        }
                        return String(a);
                      });
                      var ts = new Date().toISOString().slice(11, 23);
                      logs.push("[" + ts + "] [" + level + "] " + parts.join(" "));
                    } catch (e3) {}
                  }
                  ["log", "warn", "error", "info", "debug"].forEach(function (level) {
                    var orig = console[level];
                    console[level] = function () {
                      record(level, arguments);
                      orig.apply(console, arguments);
                    };
                  });
                  window.addEventListener("error", function (e) {
                    record("window-error", [e.message + " @ " + e.filename + ":" + e.lineno]);
                  });
                  window.addEventListener("unhandledrejection", function (e) {
                    var reason = e.reason;
                    record("unhandled-rejection", [reason && (reason.stack || reason.message) || reason]);
                  });

                  function showLogPanel() {
                    var existing = document.getElementById("cs-debug-panel");
                    if (existing) { existing.remove(); return; }
                    var panel = document.createElement("div");
                    panel.id = "cs-debug-panel";
                    panel.style.cssText = "position:fixed;inset:0;z-index:2147483647;background:#0b1220;color:#e5e7eb;display:flex;flex-direction:column;";
                    var bar = document.createElement("div");
                    bar.style.cssText = "display:flex;gap:8px;padding:10px;background:#111827;flex-shrink:0;";
                    var closeBtn = document.createElement("button");
                    closeBtn.textContent = "Close";
                    closeBtn.style.cssText = "padding:10px 16px;font-size:14px;border-radius:6px;border:none;background:#374151;color:#fff;";
                    closeBtn.onclick = function () { panel.remove(); };
                    var selectBtn = document.createElement("button");
                    selectBtn.textContent = "Select All (then Copy)";
                    selectBtn.style.cssText = "padding:10px 16px;font-size:14px;border-radius:6px;border:none;background:#2563eb;color:#fff;";
                    var ta = document.createElement("textarea");
                    ta.readOnly = true;
                    ta.value = logs.length ? logs.join("\\n") : "(no console output captured yet)";
                    ta.style.cssText = "flex:1;width:100%;background:#0b1220;color:#e5e7eb;border:none;padding:10px;font-family:monospace;font-size:11px;line-height:1.4;resize:none;-webkit-user-select:text;user-select:text;";
                    selectBtn.onclick = function () {
                      ta.value = logs.length ? logs.join("\\n") : "(no console output captured yet)";
                      ta.focus();
                      ta.setSelectionRange(0, ta.value.length);
                      try { document.execCommand("copy"); } catch (e4) {}
                    };
                    bar.appendChild(closeBtn);
                    bar.appendChild(selectBtn);
                    panel.appendChild(bar);
                    panel.appendChild(ta);
                    document.body.appendChild(panel);
                  }

                  function mountButton() {
                    var btn = document.createElement("button");
                    btn.textContent = "Logs";
                    btn.style.cssText = "position:fixed;bottom:18px;right:18px;z-index:2147483647;width:56px;height:56px;border-radius:50%;background:#2563eb;color:#fff;border:none;font-size:12px;box-shadow:0 2px 10px rgba(0,0,0,.4);";
                    btn.onclick = showLogPanel;
                    document.body.appendChild(btn);
                  }
                  if (document.body) mountButton();
                  else document.addEventListener("DOMContentLoaded", mountButton, { once: true });
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
