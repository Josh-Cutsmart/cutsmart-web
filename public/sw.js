// CutSmart's service worker — only for phone/desktop notifications (web push; see lib/push-client.ts).
// It does no caching: every page and file still comes straight from the server, exactly as without it.

self.addEventListener("install", () => {
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});

// A notification arrives: show it, and put the unread count on the app icon where the device supports it.
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
  const tasks = [self.registration.showNotification(title, options)];
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
