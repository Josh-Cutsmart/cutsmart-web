"use client";

import { useEffect, useRef, useState } from "react";
import { Plus, X } from "lucide-react";
import { GlassSwitch } from "@/components/settings-ui";
import { saveChecklistTemplate, saveUserProfilePatchDetailed } from "@/lib/firestore-data";
import { glassShineStyle } from "@/lib/glass-shine";
import { disablePushOnThisDevice, enablePushOnThisDevice, readPushDeviceStatus, type PushDeviceStatus } from "@/lib/push-client";

// Set Up Account: right after a new account's verified, one screen at a time through their name, badge colour, notifications
// and a first checklist — the same things User Settings has, and all of it optional. Each screen's saved as they move on from
// it (only what they filled in). Skip Setup, on every screen, keeps what they've filled in so far and carries on into the app.

const SWATCHES = ["#2F6BFF", "#0EA5E9", "#14B8A6", "#16A34A", "#84CC16", "#EAB308", "#F97316", "#EF4444", "#EC4899", "#8B5CF6", "#6366F1", "#64748B"];

const SCREENS = [
  { title: "What's your name?", subtitle: "This is how your team sees you." },
  { title: "Pick a badge colour", subtitle: "Your initials show in this colour around CutSmart." },
  { title: "Turn on notifications", subtitle: "Hear about your projects on this device." },
  { title: "Set up a checklist", subtitle: "A list you can reuse on your projects." },
];

const PUSH_NOTES: Partial<Record<PushDeviceStatus, string>> = {
  blocked: "Notifications are blocked for CutSmart. You can allow them in this device's settings.",
  "needs-install": "On an iPhone, add CutSmart to your Home Screen first. You can turn these on later in User Settings.",
  unsupported: "This browser can't show notifications. You can turn them on later on another device.",
  unconfigured: "Notifications aren't available right now. You can turn them on later in User Settings.",
};

const newLocalId = (prefix: string) => `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;

export function AccountSetup({
  uid,
  initialColor,
  onSaved,
  onDone,
}: {
  uid: string;
  initialColor: string;
  // What's been saved, for the rest of the app to show straight away.
  onSaved: (patch: { displayName?: string; userColor?: string }) => void;
  onDone: () => void;
}) {
  const [screen, setScreen] = useState(0);
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [color, setColor] = useState(initialColor);
  const [pushStatus, setPushStatus] = useState<PushDeviceStatus>("off");
  const [pushBusy, setPushBusy] = useState(false);
  const [checklistName, setChecklistName] = useState("");
  const [checklistItems, setChecklistItems] = useState<Array<{ id: string; text: string }>>(() => [{ id: newLocalId("item"), text: "" }]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  // What's been saved already: going back and on again doesn't save it twice.
  const savedRef = useRef({ name: "", color: initialColor, checklistId: newLocalId("checklist"), checklist: "" });

  useEffect(() => {
    let live = true;
    void readPushDeviceStatus().then((status) => {
      if (live) setPushStatus(status);
    });
    return () => {
      live = false;
    };
  }, []);

  const initials =
    [firstName, lastName]
      .map((part) => part.trim().charAt(0).toUpperCase())
      .join("") || "?";

  // Whatever's filled in on the screen they're on. false: it couldn't be saved.
  const saveScreen = async (): Promise<boolean> => {
    if (screen === 0) {
      const first = firstName.trim();
      const last = lastName.trim();
      const displayName = [first, last].filter(Boolean).join(" ");
      if (!displayName || displayName === savedRef.current.name) return true;
      const result = await saveUserProfilePatchDetailed(uid, "", { displayName, firstName: first, lastName: last });
      if (!result.ok) return false;
      savedRef.current.name = displayName;
      onSaved({ displayName });
      return true;
    }
    if (screen === 1) {
      if (color === savedRef.current.color) return true;
      const result = await saveUserProfilePatchDetailed(uid, "", { userColor: color });
      if (!result.ok) return false;
      savedRef.current.color = color;
      onSaved({ userColor: color });
      return true;
    }
    if (screen === 3) {
      const name = checklistName.trim();
      const items = checklistItems.map((item) => ({ id: item.id, text: item.text.trim() })).filter((item) => item.text);
      if (!name && !items.length) return true;
      const json = JSON.stringify([name, items]);
      if (json === savedRef.current.checklist) return true;
      const ok = await saveChecklistTemplate(uid, { id: savedRef.current.checklistId, name: name || "My checklist", items });
      if (ok) savedRef.current.checklist = json;
      return ok;
    }
    return true;
  };

  const finish = async () => {
    // (Not being able to note it's done: they'd only see this again next time they sign in.)
    await saveUserProfilePatchDetailed(uid, "", { accountSetupPending: false }).catch(() => undefined);
    onDone();
  };

  const onNext = async () => {
    setError("");
    setSaving(true);
    const ok = await saveScreen();
    if (!ok) {
      setSaving(false);
      setError("That couldn't be saved. Try again, or skip it for now.");
      return;
    }
    if (screen < SCREENS.length - 1) {
      setSaving(false);
      setScreen(screen + 1);
      return;
    }
    await finish();
    setSaving(false);
  };

  const onSkip = async () => {
    setError("");
    setSaving(true);
    await saveScreen();
    await finish();
    setSaving(false);
  };

  const togglePush = async (next: boolean) => {
    setPushBusy(true);
    try {
      if (next) setPushStatus(await enablePushOnThisDevice());
      else {
        await disablePushOnThisDevice({ byUser: true });
        setPushStatus("off");
      }
    } catch {
      setPushStatus(await readPushDeviceStatus());
    } finally {
      setPushBusy(false);
    }
  };

  const { title, subtitle } = SCREENS[screen];
  const canTogglePush = pushStatus === "on" || pushStatus === "off";
  return (
    <div>
      <h2 className="lg-title">Set Up Account</h2>
      <p className="lg-subtitle">
        Step {screen + 1} of {SCREENS.length}
      </p>
      <div className="lg-setup-progress" aria-hidden="true">
        {SCREENS.map((_, index) => (
          <span key={index} data-done={index <= screen ? "" : undefined} />
        ))}
      </div>
      <p className="lg-setup-heading">{title}</p>
      <p className="lg-note lg-setup-sub">{subtitle}</p>

      {screen === 0 ? (
        <>
          <label className="lg-field">
            <span>First name</span>
            <input className="lg-input" value={firstName} onChange={(event) => setFirstName(event.target.value)} autoComplete="given-name" />
          </label>
          <label className="lg-field">
            <span>Last name</span>
            <input className="lg-input" value={lastName} onChange={(event) => setLastName(event.target.value)} autoComplete="family-name" />
          </label>
        </>
      ) : null}

      {screen === 1 ? (
        <>
          <div className="lg-setup-badge glass-shine" style={glassShineStyle(color)}>
            {initials}
          </div>
          <div className="lg-setup-swatches">
            {SWATCHES.map((swatch) => (
              <button
                key={swatch}
                type="button"
                aria-label={`Badge colour ${swatch}`}
                aria-pressed={color.toLowerCase() === swatch.toLowerCase()}
                data-on={color.toLowerCase() === swatch.toLowerCase() ? "" : undefined}
                onClick={() => setColor(swatch)}
                style={{ backgroundColor: swatch }}
              />
            ))}
          </div>
          <label className="lg-setup-custom">
            <input type="color" value={color} onChange={(event) => setColor(event.target.value)} />
            <span>Pick another colour</span>
          </label>
        </>
      ) : null}

      {screen === 2 ? (
        <>
          <div className="lg-setup-row">
            <span>Notifications on this device</span>
            <GlassSwitch
              checked={pushStatus === "on"}
              disabled={!canTogglePush || pushBusy}
              onChange={(next) => void togglePush(next)}
              ariaLabel="Notifications on this device"
            />
          </div>
          {PUSH_NOTES[pushStatus] ? <p className="lg-note">{PUSH_NOTES[pushStatus]}</p> : null}
        </>
      ) : null}

      {screen === 3 ? (
        <>
          <label className="lg-field">
            <span>Checklist name</span>
            <input className="lg-input" value={checklistName} onChange={(event) => setChecklistName(event.target.value)} placeholder="Site measure" />
          </label>
          <div className="lg-field">
            <span>Items</span>
            {checklistItems.map((item, index) => (
              <div key={item.id} className="lg-setup-item">
                <input
                  className="lg-input"
                  aria-label={`Item ${index + 1}`}
                  value={item.text}
                  placeholder={index === 0 ? "Check the walls are square" : ""}
                  onChange={(event) =>
                    setChecklistItems((prev) => prev.map((row) => (row.id === item.id ? { ...row, text: event.target.value } : row)))
                  }
                  onKeyDown={(event) => {
                    if (event.key === "Enter") {
                      event.preventDefault();
                      setChecklistItems((prev) => [...prev, { id: newLocalId("item"), text: "" }]);
                    }
                  }}
                />
                {checklistItems.length > 1 ? (
                  <button
                    type="button"
                    aria-label={`Remove item ${index + 1}`}
                    onClick={() => setChecklistItems((prev) => prev.filter((row) => row.id !== item.id))}
                  >
                    <X size={16} />
                  </button>
                ) : null}
              </div>
            ))}
            <button type="button" className="lg-link" onClick={() => setChecklistItems((prev) => [...prev, { id: newLocalId("item"), text: "" }])}>
              <Plus size={15} /> Add an item
            </button>
          </div>
        </>
      ) : null}

      {error ? (
        <p className="lg-error" role="alert">
          {error}
        </p>
      ) : null}
      <button type="button" className="lg-primary" disabled={saving} onClick={() => void onNext()}>
        {saving ? "Saving…" : screen === SCREENS.length - 1 ? "Finish" : "Next"}
      </button>
      {screen > 0 ? (
        <button type="button" className="lg-secondary" disabled={saving} onClick={() => setScreen(screen - 1)}>
          Back
        </button>
      ) : null}
      <button type="button" className="lg-link" disabled={saving} onClick={() => void onSkip()}>
        Skip Setup
      </button>
    </div>
  );
}
