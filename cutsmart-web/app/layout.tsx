import type { Metadata } from "next";
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
    <html lang="en">
      <body className="cs-app">
        <AuthProvider>{children}</AuthProvider>
      </body>
    </html>
  );
}
