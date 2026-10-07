import type { Metadata } from "next";
import { HomeScreenManifestReload } from "@/components/home-screen-manifest-reload";

// The Contacts page links its own web app manifest (start_url /clients), so "Add to Home Screen" from
// here makes a "Contacts" icon that opens straight onto Contacts, separate from the main CutSmart one —
// the same as the Calendar (see lib/home-screen-app.ts). appleWebApp is repeated in full because nested
// metadata replaces the root layout's object, not merges it.
export const metadata: Metadata = {
  manifest: "/manifest-contacts.json",
  appleWebApp: {
    capable: true,
    statusBarStyle: "default",
    title: "Contacts",
  },
  // iOS only reads the apple-touch-icon (not the manifest's icons) for the home screen picture.
  icons: {
    apple: "/contacts-apple-touch-icon.png",
  },
};

export default function ContactsLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <HomeScreenManifestReload />
      {children}
    </>
  );
}
