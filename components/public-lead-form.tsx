"use client";

// A company's lead form for the public (app/f/[companyId]/[formId]) — on its own page, or embedded in the company's
// website (embed: no page around it, a see-through background, and its height told to the page it's in so the frame
// fits it — public/embed/lead-form.js). In the company's own colour. Sends to app/api/lead-forms/submit.

import { useCallback, useEffect, useRef, useState, type CSSProperties } from "react";
import { Check } from "lucide-react";
import { LeadFormFields } from "@/components/lead-form-fields";
import { collectLeadFormAnswers, type LeadForm, type LeadFormAnswers } from "@/lib/lead-forms";

const ERROR_MESSAGES: Record<string, string> = {
  "too-fast": "Please check your answers, then press the button again.",
  expired: "This form has been open a while — please reload the page and try again.",
  "rate-limited": "We've had a few enquiries from here just now — please try again in a few minutes.",
  "too-many-links": "Please take the web links out of your answers and try again.",
  "form-not-found": "This form isn't available any more.",
  "invalid-answers": "Please check the answers marked in red.",
  empty: "Please fill in the form before sending it.",
};

export type PublicLeadFormProps = {
  companyId: string;
  form: LeadForm;
  companyName: string;
  themeColor: string;
  ticket: string;
  embed: boolean;
  frameId: string;
  pageUrl: string;
};

// The company's colour in place of CutSmart's blue — its button, chosen answers and the box being typed in.
function brandVars(color: string): CSSProperties {
  return {
    ["--brand" as string]: color,
    ["--brand-strong" as string]: color,
    ["--brand-soft" as string]: `color-mix(in srgb, ${color} 14%, transparent)`,
    ["--brand-gradient" as string]: `linear-gradient(135deg, color-mix(in srgb, ${color} 78%, white) 0%, ${color} 100%)`,
  };
}

function postToHost(message: Record<string, unknown>) {
  if (typeof window === "undefined" || window.parent === window) return;
  window.parent.postMessage(message, "*");
}

export function PublicLeadForm({ companyId, form, companyName, themeColor, ticket, embed, frameId, pageUrl }: PublicLeadFormProps) {
  const [answers, setAnswers] = useState<LeadFormAnswers>({});
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [honeypot, setHoneypot] = useState("");
  const [status, setStatus] = useState<"idle" | "sending" | "sent">("idle");
  const [message, setMessage] = useState("");
  const rootRef = useRef<HTMLDivElement | null>(null);

  // Embedded: tell the page around it how tall the form is, whenever that changes, so its frame fits it exactly.
  const reportHeight = useCallback(() => {
    const el = rootRef.current;
    if (!embed || !el) return;
    postToHost({ type: "cutsmart-lead-form:height", id: frameId, height: Math.ceil(el.getBoundingClientRect().height) });
  }, [embed, frameId]);
  useEffect(() => {
    const el = rootRef.current;
    if (!embed || !el) return;
    reportHeight();
    // The frame narrowing (a phone turned, the website's layout changing) re-wraps the form.
    window.addEventListener("resize", reportHeight);
    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(reportHeight);
    observer?.observe(el);
    return () => {
      window.removeEventListener("resize", reportHeight);
      observer?.disconnect();
    };
  }, [embed, reportHeight]);
  // Errors, a message and the thank-you change its height too — told straight away, not only once the browser next
  // lays the page out.
  useEffect(() => {
    reportHeight();
  }, [reportHeight, errors, message, status]);

  const submit = async () => {
    if (status === "sending") return;
    const result = collectLeadFormAnswers(form, answers);
    setErrors(result.errors);
    if (Object.keys(result.errors).length > 0) {
      setMessage("");
      const firstBad = form.questions.find((question) => result.errors[question.id]);
      if (firstBad) document.querySelector(`[data-lead-form-question="${CSS.escape(firstBad.id)}"]`)?.scrollIntoView({ block: "center", behavior: "smooth" });
      return;
    }
    if (result.answeredCount === 0) {
      setMessage(ERROR_MESSAGES.empty);
      return;
    }
    setStatus("sending");
    setMessage("");
    try {
      const response = await fetch("/api/lead-forms/submit", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ companyId, formId: form.id, answers, ticket, website: honeypot, pageUrl }),
      });
      const detail = (await response.json().catch(() => null)) as { ok?: boolean; error?: string; errors?: Record<string, string> } | null;
      if (!response.ok || !detail?.ok) {
        if (detail?.errors) setErrors(detail.errors);
        setMessage(ERROR_MESSAGES[String(detail?.error)] || "Something went wrong sending this — please try again.");
        setStatus("idle");
        return;
      }
      setStatus("sent");
      postToHost({ type: "cutsmart-lead-form:sent", id: frameId });
      if (!embed) window.scrollTo({ top: 0, behavior: "smooth" });
    } catch {
      setMessage("Couldn't send this — please check your connection and try again.");
      setStatus("idle");
    }
  };

  const content =
    status === "sent" ? (
      <div className="flex flex-col items-center gap-3 py-8 text-center">
        <span className="inline-flex h-12 w-12 items-center justify-center rounded-full" style={{ backgroundColor: "var(--brand-soft)", color: "var(--brand-strong)" }}>
          <Check size={24} strokeWidth={2.6} />
        </span>
        <p className="max-w-[420px] whitespace-pre-wrap text-[15px] font-medium leading-[1.5]" style={{ color: "var(--text-main)" }}>
          {form.thankYouMessage || "Thanks! We'll be in touch."}
        </p>
      </div>
    ) : (
      <form
        noValidate
        onSubmit={(event) => {
          event.preventDefault();
          void submit();
        }}
      >
        {form.title ? (
          <h1 className="text-[22px] font-semibold leading-tight" style={{ color: "var(--text-main)" }}>
            {form.title}
          </h1>
        ) : null}
        {form.intro ? (
          <p className="mt-1.5 whitespace-pre-wrap text-[14px] leading-[1.5]" style={{ color: "var(--text-muted)" }}>
            {form.intro}
          </p>
        ) : null}
        <div className={form.title || form.intro ? "mt-5" : ""}>
          <LeadFormFields
            form={form}
            answers={answers}
            errors={errors}
            disabled={status === "sending"}
            idPrefix="lead_form"
            onChange={(questionId, value) => {
              setAnswers((prev) => ({ ...prev, [questionId]: value }));
              setErrors((prev) => (prev[questionId] ? { ...prev, [questionId]: "" } : prev));
            }}
          />
        </div>
        {/* Only a robot fills this in — it's off the screen and skipped by the keyboard and screen readers. */}
        <div aria-hidden="true" style={{ position: "absolute", left: "-10000px", top: "auto", width: 1, height: 1, overflow: "hidden" }}>
          <label>
            Website
            <input type="text" name="website" tabIndex={-1} autoComplete="off" value={honeypot} onChange={(e) => setHoneypot(e.target.value)} />
          </label>
        </div>
        {message ? (
          <p className="mt-4 text-[13px] font-medium" style={{ color: "var(--danger)" }} role="alert">
            {message}
          </p>
        ) : null}
        <button
          type="submit"
          disabled={status === "sending"}
          className="mt-5 inline-flex h-11 w-full items-center justify-center rounded-[12px] px-5 text-[15px] font-semibold text-white transition hover:brightness-105 disabled:opacity-70"
          style={{ backgroundImage: "var(--brand-gradient)", boxShadow: `0 8px 20px color-mix(in srgb, ${themeColor} 28%, transparent)` }}
        >
          {status === "sending" ? "Sending…" : form.submitLabel || "Send"}
        </button>
      </form>
    );

  if (embed) {
    return (
      // A few px of room so focus rings and shadows at the edges aren't cut off by the frame.
      <div ref={rootRef} className="cs-app p-1" style={brandVars(themeColor)}>
        {content}
      </div>
    );
  }
  return (
    <div className="cs-app flex min-h-[100svh] justify-center px-4 py-8 sm:py-14" style={brandVars(themeColor)}>
      <div className="w-full max-w-[580px]">
        {companyName ? (
          <p className="mb-3 px-1 text-[13px] font-semibold uppercase tracking-[0.8px]" style={{ color: "var(--text-muted)" }}>
            {companyName}
          </p>
        ) : null}
        <div
          ref={rootRef}
          className="rounded-[22px] border p-6 sm:p-8"
          style={{ borderColor: "var(--glass-border)", backgroundColor: "#FFFFFF", boxShadow: "0 18px 48px rgba(15, 23, 42, 0.08)" }}
        >
          {content}
        </div>
        <p className="mt-4 text-center text-[11.5px]" style={{ color: "var(--text-muted)" }}>
          Powered by CutSmart
        </p>
      </div>
    </div>
  );
}
