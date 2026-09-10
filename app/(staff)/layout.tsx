import { AuthProvider } from "@/lib/auth-context";
import { AppTabsProvider } from "@/lib/app-tabs-context";
import { GlobalAppTabsBar } from "@/components/global-app-tabs-bar";

// Scopes the staff app's own auth/tabs machinery to just the staff-facing surface (login, company
// onboarding, and everything under (app)) — moved out of the true root layout (app/layout.tsx) so
// a public, no-login route like app/client/hub/[shareId] never gets it at all. Opening that public
// link in a new tab used to also boot a second Firebase Auth listener (AuthProvider initializes
// onAuthStateChanged unconditionally) and render the staff app's own GlobalAppTabsBar on top of
// what's supposed to be a clean public page — a multi-tab Firebase Auth persistence race between
// that unnecessary second listener and the real staff tab's own is what was intermittently kicking
// staff back out to /dashboard (ProtectedRoute redirects to "/" on any transient `!user`, and "/"
// itself auto-forwards an already-signed-in user straight to /dashboard). Route groups (this
// folder's parentheses) don't appear in the URL, so every path staff use — "/", "/login",
// "/company-onboarding", "/dashboard", "/projects/[id]", etc. — is completely unchanged.
export default function StaffLayout({ children }: { children: React.ReactNode }) {
  return (
    <AuthProvider>
      <AppTabsProvider>
        <GlobalAppTabsBar />
        {children}
      </AppTabsProvider>
    </AuthProvider>
  );
}
