"use client";

// A lead form's questions, ready to fill in (lib/lead-forms.ts) — the form builder's preview in Company Settings →
// Leads, and Create Lead on the Leads page. Each question shows its label (* when it must be answered), its help
// text, its input, and what's wrong with its answer once it's been checked.

import { Check } from "lucide-react";
import { GlassDropdown } from "@/components/glass-dropdown";
import { glassFieldClass } from "@/components/settings-ui";
import type { LeadForm, LeadFormAnswerValue, LeadFormAnswers, LeadFormQuestion } from "@/lib/lead-forms";

// What the browser may fill in for a question (from what it fills in on a project, else its type).
function autoCompleteFor(question: LeadFormQuestion): string | undefined {
  if (question.mapsTo === "clientFirstName") return "given-name";
  if (question.mapsTo === "clientLastName") return "family-name";
  if (question.mapsTo === "clientName") return "name";
  if (question.type === "email" || question.mapsTo === "clientEmail") return "email";
  if (question.type === "phone" || question.mapsTo === "clientPhone") return "tel";
  if (question.type === "address" || question.mapsTo === "projectAddress") return "street-address";
  return "off";
}

function QuestionInput({
  question,
  value,
  onChange,
  disabled,
  invalid,
  inputId,
}: {
  question: LeadFormQuestion;
  value: LeadFormAnswerValue | undefined;
  onChange: (next: LeadFormAnswerValue) => void;
  disabled?: boolean;
  invalid: boolean;
  inputId: string;
}) {
  const text = Array.isArray(value) ? value.join(", ") : String(value ?? "");
  const fieldStyle = invalid ? { borderColor: "var(--danger)" } : undefined;
  const placeholder = question.placeholder || undefined;

  if (question.type === "longText") {
    return (
      <textarea
        id={inputId}
        value={text}
        onChange={(e) => onChange(e.target.value)}
        disabled={disabled}
        placeholder={placeholder}
        rows={4}
        className={`${glassFieldClass} h-auto min-h-[96px] resize-y py-2 leading-[1.45]`}
        style={fieldStyle}
      />
    );
  }

  if (question.type === "dropdown") {
    return (
      <GlassDropdown
        value={text}
        options={question.options.filter((option) => option.trim()).map((option) => ({ value: option, label: option }))}
        onChange={(next) => onChange(next)}
        placeholder={placeholder || "Choose…"}
        disabled={disabled}
        ariaLabel={question.label || "Choose"}
        triggerClassName={`${glassFieldClass} justify-between`}
        triggerStyle={fieldStyle}
      />
    );
  }

  if (question.type === "choice" || question.type === "checkboxes") {
    const many = question.type === "checkboxes";
    const ticked = new Set(Array.isArray(value) ? value : text ? [text] : []);
    return (
      <div id={inputId} role={many ? "group" : "radiogroup"} className="flex flex-wrap gap-1.5">
        {question.options
          .filter((option) => option.trim())
          .map((option) => {
            const on = ticked.has(option);
            return (
              <button
                key={option}
                type="button"
                role={many ? "checkbox" : "radio"}
                aria-checked={on}
                disabled={disabled}
                onClick={() => {
                  if (!many) {
                    onChange(on ? "" : option);
                    return;
                  }
                  const next = new Set(ticked);
                  if (on) next.delete(option);
                  else next.add(option);
                  onChange(question.options.filter((item) => next.has(item)));
                }}
                className="inline-flex min-h-9 items-center gap-1.5 rounded-full border px-3.5 py-1.5 text-left text-[13px] font-medium transition hover:brightness-95 disabled:opacity-60"
                style={
                  on
                    ? { backgroundImage: "var(--brand-gradient)", borderColor: "var(--brand)", color: "#FFFFFF" }
                    : { borderColor: invalid ? "var(--danger)" : "var(--glass-border)", backgroundColor: "var(--panel-bg)", color: "var(--text-main)" }
                }
              >
                {many ? (
                  <span
                    className="inline-flex h-4 w-4 shrink-0 items-center justify-center rounded-[5px] border"
                    style={{ borderColor: on ? "rgba(255,255,255,0.8)" : "var(--glass-border)" }}
                  >
                    {on ? <Check size={11} strokeWidth={3} /> : null}
                  </span>
                ) : null}
                {option}
              </button>
            );
          })}
      </div>
    );
  }

  const inputType =
    question.type === "email" ? "email" : question.type === "phone" ? "tel" : question.type === "date" ? "date" : "text";
  const inputMode =
    question.type === "email" ? "email" : question.type === "phone" ? "tel" : question.type === "number" ? "decimal" : undefined;
  return (
    <input
      id={inputId}
      type={inputType}
      inputMode={inputMode}
      autoComplete={autoCompleteFor(question)}
      value={text}
      onChange={(e) => onChange(e.target.value)}
      disabled={disabled}
      placeholder={placeholder}
      className={glassFieldClass}
      style={fieldStyle}
    />
  );
}

export function LeadFormFields({
  form,
  answers,
  onChange,
  errors,
  disabled,
  idPrefix = "lead_form",
  hideRequiredMarks = false,
  strongHelp = false,
}: {
  form: LeadForm;
  answers: LeadFormAnswers;
  onChange: (questionId: string, value: LeadFormAnswerValue) => void;
  errors?: Record<string, string>;
  disabled?: boolean;
  idPrefix?: string;
  // Staff entering a lead by hand needn't answer everything — no "required" marks for them.
  hideRequiredMarks?: boolean;
  // The help under each question in the main text colour rather than grey (Create Lead: all its text black).
  strongHelp?: boolean;
}) {
  if (form.questions.length === 0) {
    return (
      <p className="text-[13px] font-medium" style={{ color: "var(--text-muted)" }}>
        This form has no questions yet.
      </p>
    );
  }
  return (
    <div className="space-y-4">
      {form.questions.map((question, index) => {
        const inputId = `${idPrefix}_${question.id}`;
        const error = errors?.[question.id] || "";
        const groupInput = question.type === "choice" || question.type === "checkboxes";
        return (
          <div key={question.id} data-lead-form-question={question.id}>
            {groupInput ? (
              <p className="mb-1.5 text-[13px] font-medium" style={{ color: "var(--text-main)" }}>
                {question.label || `Question ${index + 1}`}
                {question.required && !hideRequiredMarks ? <span style={{ color: "var(--danger)" }}> *</span> : null}
              </p>
            ) : (
              <label htmlFor={inputId} className="mb-1.5 block text-[13px] font-medium" style={{ color: "var(--text-main)" }}>
                {question.label || `Question ${index + 1}`}
                {question.required && !hideRequiredMarks ? <span style={{ color: "var(--danger)" }}> *</span> : null}
              </label>
            )}
            {question.help ? (
              <p className="-mt-1 mb-1.5 text-[12px] leading-[1.4]" style={{ color: strongHelp ? "var(--text-main)" : "var(--text-muted)" }}>
                {question.help}
              </p>
            ) : null}
            <QuestionInput
              question={question}
              value={answers[question.id]}
              onChange={(next) => onChange(question.id, next)}
              disabled={disabled}
              invalid={Boolean(error)}
              inputId={inputId}
            />
            {error ? (
              <p className="mt-1 text-[12px] font-medium" style={{ color: "var(--danger)" }}>
                {error}
              </p>
            ) : null}
          </div>
        );
      })}
    </div>
  );
}
