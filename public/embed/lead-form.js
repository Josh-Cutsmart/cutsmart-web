/*
 * CutSmart lead form embed.
 *
 * On a company's website:
 *   <div data-cutsmart-form="https://www.cutsmart.nz/f/COMPANY/FORM"></div>
 *   <script src="https://www.cutsmart.nz/embed/lead-form.js" async></script>
 *
 * Puts the form (app/f/[companyId]/[formId]?embed=1) in a frame where the div is, and keeps the frame exactly as tall
 * as the form (the form tells this page its height — components/public-lead-form.tsx), so there's never a scrollbar
 * inside it. Several forms on one page, or the script added twice, are fine.
 */
(function () {
  "use strict";
  if (window.__cutsmartLeadForms) {
    window.__cutsmartLeadForms.scan();
    return;
  }

  var script = document.currentScript;
  var frames = {};
  var count = 0;

  function mount(el) {
    var address = el.getAttribute("data-cutsmart-form");
    if (!address) return;
    var url;
    try {
      url = new URL(address, script && script.src ? script.src : window.location.href);
    } catch {
      return;
    }
    count += 1;
    var id = "csf" + count + "_" + Math.random().toString(36).slice(2, 8);
    url.searchParams.set("embed", "1");
    url.searchParams.set("frame", id);
    url.searchParams.set("from", String(window.location.href).slice(0, 500));

    var frame = document.createElement("iframe");
    frame.src = url.toString();
    frame.title = el.getAttribute("data-title") || "Enquiry form";
    frame.setAttribute("allowtransparency", "true");
    frame.style.cssText = "display:block;width:100%;height:720px;border:0;background:transparent;color-scheme:light;";
    el.setAttribute("data-cutsmart-form-ready", "true");
    while (el.firstChild) el.removeChild(el.firstChild);
    el.appendChild(frame);
    frames[id] = { frame: frame, origin: url.origin, sized: false };
  }

  function scan() {
    var nodes = document.querySelectorAll("[data-cutsmart-form]:not([data-cutsmart-form-ready])");
    for (var i = 0; i < nodes.length; i += 1) mount(nodes[i]);
  }

  window.addEventListener("message", function (event) {
    var data = event.data;
    if (!data || typeof data !== "object" || typeof data.type !== "string" || data.type.indexOf("cutsmart-lead-form:") !== 0) return;
    var entry = frames[data.id];
    if (!entry || event.origin !== entry.origin || event.source !== entry.frame.contentWindow) return;
    if (data.type === "cutsmart-lead-form:height" && typeof data.height === "number" && data.height > 0) {
      entry.frame.style.height = Math.ceil(data.height) + "px";
      if (!entry.sized) {
        // It's telling us its height, so it'll never need to scroll inside itself.
        entry.sized = true;
        entry.frame.setAttribute("scrolling", "no");
      }
    }
    if (data.type === "cutsmart-lead-form:sent") {
      // The thank-you is shorter than the form — make sure it's on screen.
      var box = entry.frame.getBoundingClientRect();
      if (box.top < 0 || box.top > window.innerHeight) entry.frame.scrollIntoView({ behavior: "smooth", block: "start" });
    }
  });

  window.__cutsmartLeadForms = { scan: scan };
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", scan);
  else scan();
})();
