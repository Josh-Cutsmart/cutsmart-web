import type { Metadata } from "next";
import Script from "next/script";
import { AuthProvider } from "@/lib/auth-context";
import "./globals.css";

export const metadata: Metadata = {
  title: "CutSmart Web",
  description: "CutSmart web workspace for sales and production cutlists.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <Script id="cutsmart-theme-boot" strategy="beforeInteractive">{`
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
        `}</Script>
      </head>
      <body className="cs-app" suppressHydrationWarning>
        <AuthProvider>{children}</AuthProvider>
      </body>
    </html>
  );
}
