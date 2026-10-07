import type { Metadata } from "next";
import { HomeScreenManifestReload } from "@/components/home-screen-manifest-reload";

// The Leads page links its own web app manifest (start_url /leads), so "Add to Home Screen" from here
// makes a "Leads" icon that opens straight onto Leads, separate from the main CutSmart one — the same as
// the Calendar (see lib/home-screen-app.ts). appleWebApp is repeated in full because nested metadata
// replaces the root layout's object, not merges it.
export const metadata: Metadata = {
  manifest: "/manifest-leads.json",
  appleWebApp: {
    capable: true,
    statusBarStyle: "default",
    title: "Leads",
  },
  // iOS only reads the apple-touch-icon (not the manifest's icons) for the home screen picture.
  icons: {
    apple: "/leads-apple-touch-icon.png",
  },
};

export default function LeadsLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <HomeScreenManifestReload />
      {children}
    </>
  );
}
