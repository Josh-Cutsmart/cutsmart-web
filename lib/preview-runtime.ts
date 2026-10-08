// What changes in the browser while in CutSmart Preview (lib/preview-mode.ts), set up before the app
// starts (lib/firebase.ts):
// - Saved settings (localStorage) are kept in memory instead, so nothing the preview does is left
//   behind for the real app — and the real app's saved data doesn't show up in the preview.
// - Calls to the app's own server (/api/...) don't go out: the preview has no account, and nothing in
//   it should send an email, a notification or anything else for real. The one exception is reading
//   the published changelog, so the preview shows the app's real version history.
// - Printing, downloading/exporting files and opening other windows are turned off.

const API_PREFIX = "/api/";
// Kept from the real settings so the preview looks the way they've already chosen.
const CARRIED_OVER_KEYS = ["cutsmart_theme_mode"];

let installed = false;

export function installPreviewRuntime() {
  if (installed || typeof window === "undefined") return;
  installed = true;
  keepLocalStorageInMemory();
  holdServerCalls();
  turnOffPrintingAndDownloads();
}

function keepLocalStorageInMemory() {
  let real: Storage;
  try {
    real = window.localStorage;
  } catch {
    return;
  }
  const memory = new Map<string, string>();
  for (const key of CARRIED_OVER_KEYS) {
    const value = real.getItem(key);
    if (value !== null) memory.set(key, value);
  }
  const proto = Storage.prototype;
  const original = {
    getItem: proto.getItem,
    setItem: proto.setItem,
    removeItem: proto.removeItem,
    clear: proto.clear,
    key: proto.key,
    length: Object.getOwnPropertyDescriptor(proto, "length"),
  };
  proto.getItem = function getItem(this: Storage, key: string) {
    if (this !== real) return original.getItem.call(this, key);
    return memory.has(String(key)) ? (memory.get(String(key)) as string) : null;
  };
  proto.setItem = function setItem(this: Storage, key: string, value: string) {
    if (this !== real) return original.setItem.call(this, key, value);
    memory.set(String(key), String(value));
  };
  proto.removeItem = function removeItem(this: Storage, key: string) {
    if (this !== real) return original.removeItem.call(this, key);
    memory.delete(String(key));
  };
  proto.clear = function clear(this: Storage) {
    if (this !== real) return original.clear.call(this);
    memory.clear();
  };
  proto.key = function key(this: Storage, index: number) {
    if (this !== real) return original.key.call(this, index);
    return Array.from(memory.keys())[index] ?? null;
  };
  Object.defineProperty(proto, "length", {
    configurable: true,
    get(this: Storage) {
      return this === real ? memory.size : (original.length?.get?.call(this) ?? 0);
    },
  });
}

// The one server call the preview makes: reading the app's real, published changelog (version notes
// only — public anyway, and nothing is written). Bug reports and everything else stay held.
function isAllowedInPreview(url: URL, input: RequestInfo | URL, init?: RequestInit): boolean {
  const method = String(init?.method || (input instanceof Request ? input.method : "") || "GET").toUpperCase();
  return method === "GET" && url.pathname === "/api/changelog" && (url.searchParams.get("type") ?? "versions") === "versions";
}

function holdServerCalls() {
  const realFetch = window.fetch.bind(window);
  window.fetch = (input: RequestInfo | URL, init?: RequestInit) => {
    const href = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    let url: URL | null = null;
    try {
      url = new URL(href, window.location.href);
    } catch {
      url = null;
    }
    if (url && url.origin === window.location.origin && url.pathname.startsWith(API_PREFIX) && !isAllowedInPreview(url, input, init)) {
      return Promise.resolve(
        new Response(JSON.stringify({ ok: false, error: "preview", message: "Not available in the CutSmart Preview." }), {
          status: 503,
          headers: { "Content-Type": "application/json" },
        }),
      );
    }
    return realFetch(input, init);
  };
  if (navigator.sendBeacon) {
    const realBeacon = navigator.sendBeacon.bind(navigator);
    navigator.sendBeacon = (target: string | URL, data?: BodyInit | null) => {
      try {
        if (new URL(String(target), window.location.href).pathname.startsWith(API_PREFIX)) return true;
      } catch {
        // fall through
      }
      return realBeacon(target, data);
    };
  }
}

function isDownloadLink(link: HTMLAnchorElement): boolean {
  return link.hasAttribute("download") || /^(blob|data):/i.test(link.getAttribute("href") || "");
}

function turnOffPrintingAndDownloads() {
  window.print = () => showPreviewNotice("Printing is turned off in the Preview.");
  // Printing and PDFs open in a new window too.
  window.open = () => {
    showPreviewNotice("Printing, PDFs and new windows are turned off in the Preview.");
    return null;
  };
  const realClick = HTMLAnchorElement.prototype.click;
  HTMLAnchorElement.prototype.click = function click(this: HTMLAnchorElement) {
    if (isDownloadLink(this) || this.target === "_blank") {
      showPreviewNotice(isDownloadLink(this) ? "Downloading and exporting are turned off in the Preview." : "Opening other windows is turned off in the Preview.");
      return;
    }
    realClick.call(this);
  };
  document.addEventListener(
    "click",
    (event) => {
      const link = (event.target as Element | null)?.closest?.("a");
      if (!link) return;
      if (isDownloadLink(link)) {
        event.preventDefault();
        event.stopPropagation();
        showPreviewNotice("Downloading and exporting are turned off in the Preview.");
      } else if (link.target === "_blank") {
        event.preventDefault();
        event.stopPropagation();
        showPreviewNotice("Opening other windows is turned off in the Preview.");
      }
    },
    true,
  );
  // A page printed through a hidden frame.
  new MutationObserver((records) => {
    for (const record of records) {
      record.addedNodes.forEach((node) => {
        if (node instanceof HTMLIFrameElement) {
          const block = () => {
            try {
              if (node.contentWindow) node.contentWindow.print = () => showPreviewNotice("Printing is turned off in the Preview.");
            } catch {
              // another site's frame — it can't print this page anyway
            }
          };
          block();
          node.addEventListener("load", block);
        }
      });
    }
  }).observe(document.documentElement, { childList: true, subtree: true });
}

let noticeTimer = 0;

export function showPreviewNotice(message: string) {
  if (typeof document === "undefined") return;
  let el = document.getElementById("cutsmart-preview-notice");
  if (!el) {
    el = document.createElement("div");
    el.id = "cutsmart-preview-notice";
    el.setAttribute("role", "status");
    Object.assign(el.style, {
      position: "fixed",
      left: "50%",
      bottom: "calc(84px + env(safe-area-inset-bottom))",
      transform: "translateX(-50%)",
      zIndex: "2147483646",
      maxWidth: "calc(100vw - 32px)",
      padding: "10px 16px",
      borderRadius: "999px",
      background: "rgba(17, 17, 17, 0.88)",
      color: "#ffffff",
      fontFamily: "inherit",
      fontSize: "13px",
      fontWeight: "500",
      lineHeight: "1.3",
      boxShadow: "0 12px 30px rgba(0, 0, 0, 0.25)",
      pointerEvents: "none",
      transition: "opacity 0.25s ease",
    } satisfies Partial<CSSStyleDeclaration>);
    document.body.appendChild(el);
  }
  el.textContent = message;
  el.style.opacity = "1";
  window.clearTimeout(noticeTimer);
  noticeTimer = window.setTimeout(() => {
    if (el) el.style.opacity = "0";
  }, 2600);
}
