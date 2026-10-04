import type { Metadata } from "next";

// The Calendar page links its own web app manifest (start_url /calendar), so "Add to Home Screen" from
// here makes a "Calendar" icon that opens straight onto the calendar, separate from the main CutSmart one.
// appleWebApp is repeated in full because nested metadata replaces the root layout's object, not merges it.
export const metadata: Metadata = {
  manifest: "/manifest-calendar.json",
  appleWebApp: {
    capable: true,
    statusBarStyle: "default",
    title: "Calendar",
  },
  // iOS only reads the apple-touch-icon (not the manifest's icons) for the home screen picture.
  icons: {
    apple: "/calendar-apple-touch-icon.png",
  },
};

export default function CalendarLayout({ children }: { children: React.ReactNode }) {
  return children;
}
