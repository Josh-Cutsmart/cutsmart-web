"use client";

import { useEffect, useState, type ComponentType, type CSSProperties } from "react";
import { doc, getDoc, setDoc } from "firebase/firestore";
import { Send, Share, Smartphone } from "lucide-react";
import { db } from "@/lib/firebase";
import { GlassDropdown } from "@/components/glass-dropdown";
import {
  ALL_DAY_EVENT_REMINDER_OPTIONS,
  isPushNotificationTypeEnabled,
  normalizeCalendarReminderLead,
  normalizePushQuietMinutes,
  PUSH_NOTIFICATION_CATEGORIES,
  PUSH_QUIET_INTERVAL_OPTIONS,
  TIMED_EVENT_REMINDER_OPTIONS,
} from "@/lib/push-notification-types";
import { disablePushOnThisDevice, enablePushOnThisDevice, readPushDeviceStatus, sendTestPush, type PushDeviceStatus } from "@/lib/push-client";

// User Settings > Phone & Desktop Notifications: turn notifications on for this device (each device is
// turned on separately), send a test, and pick which kinds to get, by category — those choices are the
// user's own, stored on their profile (users/{uid}.pushNotificationTypes, and how far ahead calendar
// reminders come in users/{uid}.calendarReminderLead), and apply to all their devices.

type ToggleProps = { checked: boolean; onChange: (checked: boolean) => void; disabled?: boolean };

const STATUS_TEXT: Record<PushDeviceStatus | "loading", string> = {
  loading: "Checking…",
  on: "On — your notifications come to this device, even when CutSmart is closed.",
  off: "Off on this device.",
  blocked: "Blocked for CutSmart in this browser's or phone's own settings — allow notifications there, then turn this on.",
  "needs-install": "On iPhone and iPad, notifications work in CutSmart added to your Home Screen — see below.",
  unsupported: "This browser can't show notifications — try Chrome, Edge, Firefox or Safari.",
  unconfigured: "Not available yet — notifications haven't been set up for CutSmart.",
};

export function PushNotificationSettings({
  uid,
  cardStyle,
  Toggle,
}: {
  uid: string;
  cardStyle: CSSProperties;
  Toggle: ComponentType<ToggleProps>;
}) {
  const [status, setStatus] = useState<PushDeviceStatus | "loading">("loading");
  const [busy, setBusy] = useState(false);
  const [choices, setChoices] = useState<Record<string, unknown>>({});
  const [reminderLead, setReminderLead] = useState(() => normalizeCalendarReminderLead(null));
  // Time between notifications (users/{uid}.pushQuietMinutes — see lib/push-server.ts).
  const [quietMinutes, setQuietMinutes] = useState(0);
  const [testState, setTestState] = useState<"" | "sending" | "sent" | "not-configured" | "no-devices" | "failed">("");

  useEffect(() => {
    let cancelled = false;
    void readPushDeviceStatus().then((next) => {
      if (!cancelled) setStatus(next);
    });
    return () => {
      cancelled = true;
    };
  }, [uid]);

  useEffect(() => {
    if (!db || !uid) return;
    let cancelled = false;
    void getDoc(doc(db, "users", uid))
      .then((snap) => {
        if (cancelled) return;
        const saved = snap.data()?.pushNotificationTypes;
        setChoices(saved && typeof saved === "object" ? (saved as Record<string, unknown>) : {});
        setReminderLead(normalizeCalendarReminderLead(snap.data()?.calendarReminderLead));
        setQuietMinutes(normalizePushQuietMinutes(snap.data()?.pushQuietMinutes));
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [uid]);

  // Straight from the tap: turning it on asks the browser/phone for permission first thing.
  const onToggleDevice = async (next: boolean) => {
    if (busy) return;
    setBusy(true);
    setTestState("");
    try {
      if (next) {
        setStatus(await enablePushOnThisDevice());
      } else {
        await disablePushOnThisDevice();
        setStatus("off");
      }
    } finally {
      setBusy(false);
    }
  };

  const onToggleType = (type: string, enabled: boolean) => {
    setChoices((prev) => ({ ...prev, [type]: enabled }));
    if (db && uid) {
      void setDoc(doc(db, "users", uid), { pushNotificationTypes: { [type]: enabled } }, { merge: true }).catch(() => undefined);
    }
  };

  const onReminderLeadChange = (patch: Partial<{ timedMinutes: number; allDayDays: number }>) => {
    const next = { ...reminderLead, ...patch };
    setReminderLead(next);
    if (db && uid) void setDoc(doc(db, "users", uid), { calendarReminderLead: next }, { merge: true }).catch(() => undefined);
  };

  const onQuietMinutesChange = (minutes: number) => {
    setQuietMinutes(minutes);
    if (db && uid) void setDoc(doc(db, "users", uid), { pushQuietMinutes: minutes }, { merge: true }).catch(() => undefined);
  };

  const onSendTest = async () => {
    setTestState("sending");
    setTestState((await sendTestPush()) || "sent");
  };

  const showDeviceToggle = status === "on" || status === "off" || status === "blocked";
  const mutedText = { color: "var(--text-muted)" } as const;

  return (
    <div className="rounded-[18px] border p-5" style={cardStyle}>
      <h3 className="text-[15px] font-extrabold uppercase tracking-[1px]" style={{ color: "var(--text-main)" }}>
        Phone &amp; Desktop Notifications
      </h3>
      <p className="mb-4 mt-1 text-[12px]" style={mutedText}>
        Get your notifications on your phone&apos;s lock screen or your computer, like any other app. Turn them on separately on each device.
      </p>

      <div className="flex items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-2.5">
          <Smartphone size={16} style={mutedText} />
          <div className="min-w-0">
            <p className="text-[13px] font-semibold" style={{ color: "var(--text-main)" }}>Notifications on this device</p>
            <p className="text-[11px]" style={mutedText}>{STATUS_TEXT[status]}</p>
          </div>
        </div>
        {showDeviceToggle ? (
          <Toggle checked={status === "on"} onChange={(next) => void onToggleDevice(next)} disabled={busy || status === "blocked"} />
        ) : null}
      </div>

      {status === "needs-install" ? (
        <ol className="mt-3 list-decimal space-y-1 rounded-[12px] border py-3 pl-8 pr-3 text-[12px]" style={{ borderColor: "var(--glass-border)", backgroundColor: "var(--panel-muted)", color: "var(--text-main)" }}>
          <li>
            In Safari, tap <Share size={12} className="inline align-[-1px]" /> <b>Share</b>, then <b>Add to Home Screen</b>.
          </li>
          <li>Open CutSmart from your Home Screen.</li>
          <li>Come back to User Settings there and turn this on.</li>
        </ol>
      ) : null}

      {status === "on" ? (
        <>
          <div className="mt-3 flex flex-wrap items-center gap-2.5">
            <button
              type="button"
              disabled={testState === "sending"}
              onClick={() => void onSendTest()}
              className="inline-flex h-8 items-center gap-1.5 rounded-[9px] border px-3 text-[12px] font-semibold transition hover:brightness-95 disabled:opacity-60"
              style={{ borderColor: "var(--glass-border)", backgroundColor: "var(--panel-muted)", color: "var(--text-main)" }}
            >
              <Send size={13} />
              {testState === "sending" ? "Sending…" : "Send a test"}
            </button>
            {testState === "sent" ? <span className="text-[11.5px]" style={mutedText}>Sent — it should pop up in a moment.</span> : null}
            {testState === "not-configured" || testState === "no-devices" || testState === "failed" ? (
              <span className="text-[11.5px]" style={{ color: "var(--danger-strong)" }}>
                {testState === "not-configured"
                  ? "Couldn't send it — notifications aren't fully set up on the server yet."
                  : testState === "no-devices"
                    ? "Couldn't send it — this device isn't registered. Turn this off and on again."
                    : "Couldn't send it — the notification service didn't accept it. Try turning this off and on again."}
              </span>
            ) : null}
          </div>

          <div className="mt-4 border-t pt-4" style={{ borderColor: "var(--glass-border)" }}>
            <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
              <div className="min-w-0 flex-1">
                <p className="text-[13px] font-semibold" style={{ color: "var(--text-main)" }}>Time between notifications</p>
                <p className="text-[11px]" style={mutedText}>
                  After a notification, any more within this time are held and sent together as one — e.g. &ldquo;10 new leads&rdquo;.
                  Your Notifications list in CutSmart still shows every one.
                </p>
              </div>
              <div className="w-[190px] shrink-0">
                <GlassDropdown
                  value={String(quietMinutes)}
                  options={PUSH_QUIET_INTERVAL_OPTIONS.map((o) => ({ value: String(o.value), label: o.label }))}
                  onChange={(next) => onQuietMinutesChange(Number(next))}
                  ariaLabel="Time between notifications"
                  triggerClassName="flex h-9 w-full items-center justify-between rounded-[9px] border px-3 text-[12px] font-medium"
                  triggerStyle={{ borderColor: "var(--glass-border)", backgroundColor: "var(--panel-bg)", color: "var(--text-main)" }}
                />
              </div>
            </div>
            <p className="mb-3 text-[11px] font-bold uppercase tracking-[0.8px]" style={mutedText}>Notify me about</p>
            <div className="space-y-4">
              {PUSH_NOTIFICATION_CATEGORIES.map((category) => (
                <div key={category.id}>
                  <p className="mb-2 text-[12px] font-bold" style={{ color: "var(--text-main)" }}>{category.label}</p>
                  <div className="space-y-3 rounded-[12px] border p-3" style={{ borderColor: "var(--glass-border)", backgroundColor: "var(--panel-muted)" }}>
                    {category.types.map((option) => {
                      const isOn = isPushNotificationTypeEnabled(choices, option.type);
                      return (
                        <div key={option.type}>
                          <div className="flex items-center justify-between gap-3">
                            <div className="min-w-0">
                              <p className="text-[13px] font-semibold" style={{ color: "var(--text-main)" }}>{option.label}</p>
                              <p className="text-[11px]" style={mutedText}>{option.description}</p>
                            </div>
                            <Toggle checked={isOn} onChange={(next) => onToggleType(option.type, next)} />
                          </div>
                          {option.type === "calendar_reminder" && isOn ? (
                            // How far ahead: timed events by minutes to months, all-day events by days to months.
                            <div className="mt-2.5 grid gap-2 sm:grid-cols-2">
                              {(
                                [
                                  { key: "timedMinutes", label: "Timed events", options: TIMED_EVENT_REMINDER_OPTIONS, value: reminderLead.timedMinutes },
                                  { key: "allDayDays", label: "All-day events", options: ALL_DAY_EVENT_REMINDER_OPTIONS, value: reminderLead.allDayDays },
                                ] as const
                              ).map((field) => (
                                <label key={field.key} className="block text-[11px] font-semibold" style={mutedText}>
                                  {field.label}
                                  <div className="mt-1">
                                    <GlassDropdown
                                      value={String(field.value)}
                                      options={field.options.map((o) => ({ value: String(o.value), label: o.label }))}
                                      onChange={(next) => onReminderLeadChange({ [field.key]: Number(next) })}
                                      ariaLabel={`${field.label} reminder`}
                                      triggerClassName="flex h-9 w-full items-center justify-between rounded-[9px] border px-3 text-[12px] font-medium"
                                      triggerStyle={{ borderColor: "var(--glass-border)", backgroundColor: "var(--panel-bg)", color: "var(--text-main)" }}
                                    />
                                  </div>
                                </label>
                              ))}
                            </div>
                          ) : null}
                        </div>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>
            <p className="mt-3 text-[11px]" style={mutedText}>
              These apply on every device you&apos;ve turned notifications on for. They&apos;ll all still be in your Notifications list in CutSmart.
            </p>
          </div>
        </>
      ) : null}
    </div>
  );
}
