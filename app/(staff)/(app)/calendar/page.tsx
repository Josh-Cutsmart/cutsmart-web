"use client";

export default function CalendarPage() {
  return (
    <div className="min-h-[calc(100svh-64px)] bg-[var(--bg-app)]">
      <div className="border-b border-[var(--panel-border)] bg-[var(--panel-bg)] px-6 py-4">
        <p className="text-[17px] font-semibold text-[var(--text-main)]">Calendar</p>
      </div>
      <div className="p-6">
        <div className="rounded-[14px] border border-[var(--panel-border)] bg-[var(--panel-bg)] px-5 py-6 text-[13px] font-semibold text-[var(--text-muted)] shadow-[var(--shadow-sm)]">
          Calendar layout coming next.
        </div>
      </div>
    </div>
  );
}
