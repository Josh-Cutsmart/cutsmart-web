"use client";

import { AppShell } from "@/components/app-shell";
import { ProtectedRoute } from "@/components/protected-route";

export default function CompanyUpdatesPage() {
  return (
    <ProtectedRoute>
      <AppShell>
        <section className="rounded-[14px] border border-[#D7DEE8] bg-white p-4">
          <p className="text-[15px] font-extrabold uppercase tracking-[1px] text-[#12345B]">Company Updates</p>
          <p className="mt-2 text-[13px] text-[#475467]">Company activity page route is now in place for desktop-parity content wiring.</p>
        </section>
      </AppShell>
    </ProtectedRoute>
  );
}
