// CutSmart's service worker — only for phone/desktop notifications (web push; see lib/push-client.ts).
// It does no caching: every page and file still comes straight from the server, exactly as without it.

self.addEventListener("install", () => {
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});

// Whether a CutSmart window on screen shows this notification itself — a computer pops it up in its corner
// (components/global-app-tabs-bar.tsx), so the system's own notification isn't shown as well. Each window on
// screen is asked; one that doesn't answer within half a second counts as no. Never on Safari, which wants every
// push shown as a notification.
async function shownInOpenWindow(push) {
  const ua = (self.navigator && self.navigator.userAgent) || "";
  if (/Safari\//.test(ua) && !/(Chrome|Chromium|CriOS|Edg|Firefox|FxiOS)\//.test(ua)) return false;
  const windows = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
  const onScreen = windows.filter((client) => client.visibilityState === "visible");
  if (onScreen.length === 0) return false;
  const answers = await Promise.all(
    onScreen.map(
      (client) =>
        new Promise((resolve) => {
          const channel = new MessageChannel();
          const timer = setTimeout(() => resolve(false), 500);
          channel.port1.onmessage = (message) => {
            clearTimeout(timer);
            resolve(Boolean(message.data && message.data.shownInApp));
          };
          try {
            client.postMessage({ type: "cutsmart-push", push }, [channel.port2]);
          } catch {
            clearTimeout(timer);
            resolve(false);
          }
        }),
    ),
  );
  return answers.some(Boolean);
}

// Notifications that waited for this device — it was off or offline when they were sent, and the push service kept
// them until it was back — arrive all at once. Rather than a pile of them, they're gathered into one: "5 new
// notifications", the first few listed, opening the Notifications list. One has waited when it arrives more than 2
// minutes after it was sent (data.sentAt, from lib/push-server.ts). The first is shown as it is (it may be the only
// one); the next joins it into the group, and each after that is added to the group quietly. One with buttons
// (Approve / Deny) is always shown on its own.
const CATCH_UP_DELAY_MS = 2 * 60 * 1000;
const CATCH_UP_TAG = "cutsmart-catch-up";
// One at a time, so a pile arriving together can't each think it's the first.
let catchUpQueue = Promise.resolve();

async function showCaughtUp(title, options) {
  const shown = await self.registration.getNotifications();
  const group = shown.find((notification) => notification.tag === CATCH_UP_TAG);
  const singles = shown.filter((notification) => notification.tag !== CATCH_UP_TAG && notification.data && notification.data.caughtUp);
  if (!group && singles.length === 0) {
    return self.registration.showNotification(title, { ...options, data: { ...options.data, caughtUp: true } });
  }
  const groupData = (group && group.data) || {};
  const titles = [...(Array.isArray(groupData.titles) ? groupData.titles : []), ...singles.map((notification) => notification.title), title];
  const count = (Number(groupData.count) || 0) + singles.length + 1;
  singles.forEach((notification) => notification.close());
  const listed = titles.slice(0, 4).map((line) => `• ${line}`);
  if (count > listed.length) listed.push(`and ${count - listed.length} more`);
  return self.registration.showNotification(`${count} new notifications`, {
    body: listed.join("\n"),
    icon: options.icon,
    tag: CATCH_UP_TAG,
    renotify: false,
    silent: true,
    data: { url: "/dashboard?notifications=open", count, titles: titles.slice(0, 20), caughtUp: true },
  });
}

// A notification arrives: show it (unless a computer with CutSmart on screen pops it up itself) — gathered with the
// others if it waited for this device (above) — and put the unread count on the app icon where the device supports it.
self.addEventListener("push", (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch {
    data = { body: event.data ? event.data.text() : "" };
  }
  const title = data.title || "CutSmart";
  const options = {
    body: data.body || "",
    icon: data.icon || "/icon-192.png",
    tag: data.tag || undefined,
    renotify: Boolean(data.tag),
    // Buttons (e.g. Approve / Deny on a production unlock request) — shown on Android and computers.
    actions: Array.isArray(data.actions) ? data.actions.slice(0, 2) : undefined,
    data: { url: data.url || "/dashboard", actionUrl: data.actionUrl || "", actionToken: data.actionToken || "" },
  };
  const sentAt = Number(data.sentAt) || 0;
  const waited = sentAt > 0 && Date.now() - sentAt > CATCH_UP_DELAY_MS && !(options.actions && options.actions.length);
  const show = () => {
    if (!waited) return self.registration.showNotification(title, options);
    catchUpQueue = catchUpQueue.catch(() => undefined).then(() => showCaughtUp(title, options));
    return catchUpQueue;
  };
  const tasks = [
    // What it says, for a window that shows it from the push itself (a dev mode test, which isn't stored).
    shownInOpenWindow({ title, body: options.body, url: options.data.url, tag: data.tag || "" })
      .catch(() => false)
      .then((shownInApp) => (shownInApp ? undefined : show())),
  ];
  if (typeof data.badgeCount === "number" && self.navigator && "setAppBadge" in self.navigator) {
    tasks.push(
      (data.badgeCount > 0 ? self.navigator.setAppBadge(data.badgeCount) : self.navigator.clearAppBadge()).catch(() => undefined),
    );
  }
  event.waitUntil(Promise.all(tasks));
});

// Tapping it opens CutSmart at what it's about — in the app window that's already open if there is one.
// Tapping one of its buttons instead does that action in the background (without opening the app) and
// shows how it went; if that fails, it opens the app at what it's about.
self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const data = event.notification.data || {};
  const target = new URL(data.url || "/dashboard", self.location.origin).href;
  if (event.action && data.actionUrl && data.actionToken) {
    event.waitUntil(
      (async () => {
        try {
          const response = await fetch(new URL(data.actionUrl, self.location.origin).href, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ token: data.actionToken, decision: event.action }),
          });
          const result = await response.json().catch(() => ({}));
          if (!response.ok || !result.ok) throw new Error(result.error || "failed");
          const who = result.requesterName || "They";
          const body = result.alreadyAnswered
            ? "Someone has already answered this request."
            : result.decision === "approve"
              ? `Approved — ${who} can edit production for ${result.hours} hour${result.hours === 1 ? "" : "s"}.`
              : `Denied — ${who} has been told.`;
          await self.registration.showNotification("CutSmart", { body, icon: "/icon-192.png", tag: `${event.notification.tag || "action"}_done` });
        } catch {
          await self.clients.openWindow(target);
        }
      })(),
    );
    return;
  }
  event.waitUntil(
    (async () => {
      const windows = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
      for (const client of windows) {
        if (new URL(client.url).origin !== self.location.origin) continue;
        await client.focus();
        if ("navigate" in client) {
          try {
            await client.navigate(target);
          } catch {
            // Not ours to steer (opened before this worker took over) — it's focused at least.
          }
        }
        return;
      }
      await self.clients.openWindow(target);
    })(),
  );
});
