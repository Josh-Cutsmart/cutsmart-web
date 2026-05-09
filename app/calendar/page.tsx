"use client";

import { AppShell } from "@/components/app-shell";
import { ProtectedRoute } from "@/components/protected-route";

export default function CalendarPage() {
  return (
    <ProtectedRoute>
      <AppShell>
        <div className="min-h-[calc(100dvh-64px)] bg-[#F5F7FB]">
          <div className="border-b border-[#D7DEE8] bg-white px-6 py-4">
            <p className="text-[14px] font-semibold uppercase tracking-[1px] text-[#0F2A4A]">Calendar</p>
          </div>
          <div className="p-6">
            <div className="rounded-[16px] border border-[#D7DEE8] bg-white px-5 py-6 text-[13px] font-semibold text-[#64748B] shadow-[0_10px_30px_rgba(15,23,42,0.06)]">
              Calendar layout coming next.
            </div>
          </div>
        </div>
      </AppShell>
    </ProtectedRoute>
  );
}
