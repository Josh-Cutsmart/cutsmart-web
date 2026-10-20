// The bell for being subscribed to something — a project's notifications (its top bar), a calendar event's reminders
// (its pop-up): filled, with its ringing lines out either side, when on; just its outline when off. Lucide's Bell and
// BellRing, drawn here so the bell itself can be filled without filling the lines too.
export function SubscribeBellIcon({ on, size = 15 }: { on: boolean; size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M10.268 21a2 2 0 0 0 3.464 0" />
      <path
        d="M3.262 15.326A1 1 0 0 0 4 17h16a1 1 0 0 0 .74-1.673C19.41 13.956 18 12.499 18 8A6 6 0 0 0 6 8c0 4.499-1.411 5.956-2.738 7.326"
        fill={on ? "currentColor" : "none"}
      />
      {on ? (
        <>
          <path d="M22 8c0-2.3-.8-4.3-2-6" />
          <path d="M4 2C2.8 3.7 2 5.7 2 8" />
        </>
      ) : null}
    </svg>
  );
}
