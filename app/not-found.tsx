import type { Metadata } from "next";
import Link from "next/link";
import { Compass } from "lucide-react";
import { StatusBackButton, StatusScreen } from "@/components/status-screen";

// Any address that isn't a page — a mistyped link, an old one (components/status-screen.tsx).
export const metadata: Metadata = {
  title: "Page not found",
};

export default function NotFound() {
  return (
    <StatusScreen
      icon={<Compass size={26} />}
      title="Page not found"
      message="This link doesn't go anywhere. The page may have moved, or the address might have a typo."
    >
      <Link href="/" className="lg-primary">
        Go to CutSmart
      </Link>
      <StatusBackButton />
    </StatusScreen>
  );
}
