import { redirect } from "next/navigation";

// Recently Deleted became part of Archived: every Delete button now archives instead, and nothing is
// deleted automatically any more. This route stays only so old links and bookmarks still land somewhere
// useful — the Projects tab of the Archived page, where previously deleted projects are listed too.
export default function RecentlyDeletedRedirectPage() {
  redirect("/archived?tab=projects");
}
