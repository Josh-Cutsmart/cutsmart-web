"use client";

// Company Settings → Leads: the company's lead forms (as many as it likes — lib/lead-forms.ts) and its leads email
// inbox address. The forms are part of the settings page's own state (`leadForms`, saved with everything else on
// the page — its autosave); this file draws them: the list of forms, and a full-screen builder for one — its
// details and questions on the left, a working preview of the form on the right.

import { useEffect, useRef, useState, type DragEvent as ReactDragEvent, type Dispatch, type MouseEvent as ReactMouseEvent, type SetStateAction } from "react";
import { GlassModalHeader } from "@/components/glass-modal-header";
import { createPortal } from "react-dom";
import {
  AlignLeft,
  ArrowDown,
  ArrowLeft,
  ArrowUp,
  AtSign,
  CalendarDays,
  Check,
  ChevronDown,
  CircleDot,
  Copy,
  ExternalLink,
  FileInput,
  Globe,
  GripVertical,
  Hash,
  Link2,
  ListChecks,
  Mail,
  MapPin,
  MoreHorizontal,
  Phone,
  Plus,
  RotateCcw,
  SquareChevronDown,
  Trash2,
  Type,
  X,
} from "lucide-react";
import { GlassActionMenu, GlassDropdown } from "@/components/glass-dropdown";
import { LeadFormFields } from "@/components/lead-form-fields";
import {
  GlassSwitch,
  Segmented,
  SettingsCard,
  chipAddClass,
  countPillClass,
  glassFieldClass,
  gripClass,
  iconRemoveButtonClass,
  listRowClass,
  primaryButtonClass,
  primaryButtonStyle,
  secondaryButtonClass,
  smallButtonClass,
} from "@/components/settings-ui";
import { useUndo } from "@/components/undo-bar";
import { authorizedFetch } from "@/lib/api-fetch";
import { isPreviewMode } from "@/lib/preview-mode";
import { PUBLIC_SITE_ORIGIN } from "@/lib/site-origin";
import { leadInboxAddress, savedLeadInboxLocalPart } from "@/lib/lead-inbox";
import { activeDateTime } from "@/lib/company-formats";
import { captureGlassModalOrigin, useGlassModalPopOrigin, type GlassModalOrigin } from "@/lib/use-glass-modal-pop-origin";
import {
  LEAD_FORM_FIELD_TARGETS,
  LEAD_FORM_QUESTION_TYPES,
  collectLeadFormAnswers,
  duplicateLeadForm,
  leadFormQuestionHasOptions,
  leadFormQuestionTypeLabel,
  newLeadForm,
  newLeadFormQuestion,
  type LeadForm,
  type LeadFormAnswers,
  type LeadFormQuestion,
  type LeadFormQuestionType,
} from "@/lib/lead-forms";

const QUESTION_TYPE_ICONS: Record<LeadFormQuestionType, React.ComponentType<{ size?: number; strokeWidth?: number }>> = {
  shortText: Type,
  longText: AlignLeft,
  email: AtSign,
  phone: Phone,
  address: MapPin,
  number: Hash,
  date: CalendarDays,
  dropdown: SquareChevronDown,
  choice: CircleDot,
  checkboxes: ListChecks,
};

const fieldLabelClass = "mb-1 block text-[12px] font-medium text-[var(--text-muted)]";
// A quiet icon button (open/close a question) — iconRemoveButtonClass's shape without its red.
const iconQuietButtonClass =
  "inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-[8px] text-[var(--text-muted)] transition hover:bg-[color-mix(in_srgb,var(--text-main)_6%,transparent)] hover:text-[var(--text-main)]";
const textAreaClass = `${glassFieldClass} h-auto min-h-[72px] resize-y py-2 leading-[1.45]`;

// Something taken off, put back where it was (the Undo bar).
function insertAt<T>(list: T[], index: number, item: T): T[] {
  const at = Math.min(Math.max(index, 0), list.length);
  return [...list.slice(0, at), item, ...list.slice(at)];
}

function moveItem<T>(list: T[], from: number, to: number): T[] {
  if (from === to || from < 0 || to < 0 || from >= list.length || to >= list.length) return list;
  const next = [...list];
  const [item] = next.splice(from, 1);
  next.splice(to, 0, item);
  return next;
}

function QuestionTypeIcon({ type, size = 15 }: { type: LeadFormQuestionType; size?: number }) {
  const Icon = QUESTION_TYPE_ICONS[type] ?? Type;
  return <Icon size={size} strokeWidth={2.1} />;
}

// One question in the builder: a row with its label and what kind it is (click to open it); open, everything
// about it.
function QuestionEditor({
  question,
  index,
  count,
  expanded,
  dragging,
  onToggle,
  onChange,
  onMove,
  onRemove,
  onRemoveChoice,
  onDragStart,
  onDragEnter,
  onDragEnd,
}: {
  question: LeadFormQuestion;
  index: number;
  count: number;
  expanded: boolean;
  dragging: boolean;
  onToggle: () => void;
  onChange: (patch: Partial<LeadFormQuestion>) => void;
  onMove: (to: number) => void;
  onRemove: () => void;
  onRemoveChoice: (optionIndex: number) => void;
  onDragStart: (e: ReactDragEvent<HTMLButtonElement>) => void;
  onDragEnter: () => void;
  onDragEnd: () => void;
}) {
  const hasOptions = leadFormQuestionHasOptions(question.type);
  const target = LEAD_FORM_FIELD_TARGETS.find((row) => row.value === question.mapsTo && row.value);
  const summary = [
    leadFormQuestionTypeLabel(question.type),
    question.required ? "Required" : "",
    target ? `Fills in ${target.label.toLowerCase()}` : "",
    question.showOnCard ? "On card" : "",
  ]
    .filter(Boolean)
    .join(" · ");
  return (
    <div
      className="rounded-[14px] border transition"
      style={{
        borderColor: expanded ? "var(--brand)" : "var(--glass-border)",
        backgroundColor: "color-mix(in srgb, var(--panel-bg) 60%, transparent)",
        opacity: dragging ? 0.45 : 1,
      }}
      onDragOver={(e) => {
        e.preventDefault();
        e.dataTransfer.dropEffect = "move";
      }}
      onDragEnter={(e) => {
        e.preventDefault();
        onDragEnter();
      }}
      onDrop={(e) => {
        e.preventDefault();
        onDragEnd();
      }}
    >
      <div className="flex items-center gap-2 px-2 py-1.5">
        <button type="button" draggable onDragStart={onDragStart} onDragEnd={onDragEnd} className={`${gripClass} max-md:hidden`} title="Drag to reorder" aria-label="Drag to reorder">
          <GripVertical size={15} />
        </button>
        <span
          className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-[8px] max-md:ml-1"
          style={{ backgroundColor: "var(--brand-soft)", color: "var(--brand-strong)" }}
        >
          <QuestionTypeIcon type={question.type} size={14} />
        </span>
        <button type="button" onClick={onToggle} className="min-w-0 flex-1 py-0.5 text-left" aria-expanded={expanded}>
          <p className="truncate text-[13px] font-medium" style={{ color: question.label.trim() ? "var(--text-main)" : "var(--text-muted)" }}>
            {question.label.trim() || "Untitled question"}
          </p>
          <p className="truncate text-[11.5px]" style={{ color: "var(--text-muted)" }}>
            {summary}
          </p>
        </button>
        <button type="button" onClick={onToggle} className={iconQuietButtonClass} aria-label={expanded ? "Close question" : "Open question"}>
          <ChevronDown size={15} style={{ transform: expanded ? "rotate(180deg)" : "none", transition: "transform 180ms ease" }} />
        </button>
        <button type="button" onClick={onRemove} className={iconRemoveButtonClass} title="Remove question" aria-label="Remove question">
          <X size={15} />
        </button>
      </div>
      {expanded ? (
        <div className="space-y-3 border-t px-3 pb-3 pt-3" style={{ borderColor: "var(--glass-border)" }}>
          <div>
            <label className={fieldLabelClass}>Question</label>
            <input
              value={question.label}
              onChange={(e) => onChange({ label: e.target.value })}
              placeholder="e.g. What are you looking for?"
              className={glassFieldClass}
            />
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <span className={fieldLabelClass}>Answer type</span>
              <GlassDropdown
                value={question.type}
                options={LEAD_FORM_QUESTION_TYPES.map((row) => ({ value: row.type, label: row.label }))}
                onChange={(next) => {
                  const type = next as LeadFormQuestionType;
                  onChange({
                    type,
                    options: leadFormQuestionHasOptions(type) && question.options.filter((option) => option.trim()).length === 0 ? ["Option 1", "Option 2"] : question.options,
                  });
                }}
                ariaLabel="Answer type"
                triggerClassName={`${glassFieldClass} justify-between`}
              />
            </div>
            <div>
              <span className={fieldLabelClass}>When it becomes a project, fill in</span>
              <GlassDropdown
                value={question.mapsTo}
                options={LEAD_FORM_FIELD_TARGETS.map((row) => ({ value: row.value, label: row.label }))}
                onChange={(next) => onChange({ mapsTo: next as LeadFormQuestion["mapsTo"] })}
                ariaLabel="Fills in"
                triggerClassName={`${glassFieldClass} justify-between`}
              />
            </div>
            {!hasOptions && question.type !== "date" ? (
              <div>
                <label className={fieldLabelClass}>Placeholder</label>
                <input
                  value={question.placeholder}
                  onChange={(e) => onChange({ placeholder: e.target.value })}
                  placeholder="Shown faintly in the empty box"
                  className={glassFieldClass}
                />
              </div>
            ) : null}
            <div className={!hasOptions && question.type !== "date" ? "" : "sm:col-span-2"}>
              <label className={fieldLabelClass}>Help text</label>
              <input
                value={question.help}
                onChange={(e) => onChange({ help: e.target.value })}
                placeholder="A line under the question (optional)"
                className={glassFieldClass}
              />
            </div>
          </div>
          {hasOptions ? (
            <div>
              <span className={fieldLabelClass}>Choices</span>
              <div className="space-y-1.5">
                {question.options.map((option, optionIndex) => (
                  <div key={optionIndex} className="flex items-center gap-1.5">
                    <input
                      value={option}
                      onChange={(e) => onChange({ options: question.options.map((item, i) => (i === optionIndex ? e.target.value : item)) })}
                      placeholder={`Choice ${optionIndex + 1}`}
                      className={glassFieldClass}
                    />
                    <button
                      type="button"
                      onClick={() => onRemoveChoice(optionIndex)}
                      className={iconRemoveButtonClass}
                      title="Remove choice"
                      aria-label="Remove choice"
                    >
                      <X size={14} />
                    </button>
                  </div>
                ))}
                <button type="button" onClick={() => onChange({ options: [...question.options, ""] })} className={chipAddClass}>
                  <Plus size={13} /> Add choice
                </button>
              </div>
            </div>
          ) : null}
          <div className="grid gap-2 sm:grid-cols-3">
            {(
              [
                ["required", "Required"],
                ["showOnCard", "Show on lead card"],
                ["showInDetail", "Show in lead pop-up"],
              ] as const
            ).map(([key, label]) => (
              <div key={key} className="flex items-center justify-between gap-2 rounded-[11px] border px-3 py-2" style={{ borderColor: "var(--glass-border)" }}>
                <span className="text-[12.5px] font-medium" style={{ color: "var(--text-main)" }}>
                  {label}
                </span>
                <GlassSwitch size="sm" checked={Boolean(question[key])} onChange={(next) => onChange({ [key]: next })} ariaLabel={label} />
              </div>
            ))}
          </div>
          <div className="flex flex-wrap items-center gap-1.5">
            <button type="button" onClick={() => onMove(index - 1)} disabled={index === 0} className={smallButtonClass}>
              <ArrowUp size={13} /> Move up
            </button>
            <button type="button" onClick={() => onMove(index + 1)} disabled={index >= count - 1} className={smallButtonClass}>
              <ArrowDown size={13} /> Move down
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}

// The form as people will see it — fill it in and press its button to try it (nothing is sent).
function LeadFormPreview({ form }: { form: LeadForm }) {
  const [answers, setAnswers] = useState<LeadFormAnswers>({});
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [sent, setSent] = useState(false);
  if (sent) {
    return (
      <div className="flex flex-col items-center gap-3 py-10 text-center">
        <span className="inline-flex h-11 w-11 items-center justify-center rounded-full" style={{ backgroundColor: "var(--success-soft, rgba(34,197,94,0.14))", color: "var(--success, #16a34a)" }}>
          <Check size={22} strokeWidth={2.6} />
        </span>
        <p className="whitespace-pre-wrap text-[14px] font-medium" style={{ color: "var(--text-main)" }}>
          {form.thankYouMessage || "Thanks! We'll be in touch."}
        </p>
        <button
          type="button"
          onClick={() => {
            setSent(false);
            setAnswers({});
            setErrors({});
          }}
          className={smallButtonClass}
        >
          <RotateCcw size={13} /> Try it again
        </button>
      </div>
    );
  }
  return (
    <div>
      {form.title ? (
        <h3 className="text-[20px] font-semibold leading-tight" style={{ color: "var(--text-main)" }}>
          {form.title}
        </h3>
      ) : null}
      {form.intro ? (
        <p className="mt-1.5 whitespace-pre-wrap text-[13px] leading-[1.5]" style={{ color: "var(--text-muted)" }}>
          {form.intro}
        </p>
      ) : null}
      <div className={form.title || form.intro ? "mt-5" : ""}>
        <LeadFormFields
          form={form}
          answers={answers}
          errors={errors}
          idPrefix={`preview_${form.id}`}
          onChange={(questionId, value) => {
            setAnswers((prev) => ({ ...prev, [questionId]: value }));
            setErrors((prev) => (prev[questionId] ? { ...prev, [questionId]: "" } : prev));
          }}
        />
      </div>
      <button
        type="button"
        onClick={() => {
          const result = collectLeadFormAnswers(form, answers);
          setErrors(result.errors);
          if (Object.keys(result.errors).length === 0) setSent(true);
        }}
        className={`${primaryButtonClass} mt-5 w-full`}
        style={primaryButtonStyle}
      >
        {form.submitLabel || "Send"}
      </button>
    </div>
  );
}

// A form's public link, and the code that puts it on a website (public/embed/lead-form.js) — or, for a website that
// won't run scripts, a plain frame. Always the live site's address (lib/site-origin.ts), whichever copy of CutSmart
// it's copied from.
export function leadFormLink(companyId: string, formId: string) {
  return `${PUBLIC_SITE_ORIGIN}/f/${encodeURIComponent(companyId)}/${encodeURIComponent(formId)}`;
}

function leadFormEmbedCode(link: string) {
  const origin = (() => {
    try {
      return new URL(link).origin;
    } catch {
      return "";
    }
  })();
  return `<div data-cutsmart-form="${link}"></div>\n<script src="${origin}/embed/lead-form.js" async></script>`;
}

function leadFormFrameCode(link: string) {
  return `<iframe src="${link}?embed=1" title="Enquiry form" style="width:100%;height:900px;border:0"></iframe>`;
}

function useCopied() {
  const [copied, setCopied] = useState("");
  const copy = async (key: string, text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(key);
      window.setTimeout(() => setCopied((prev) => (prev === key ? "" : prev)), 1600);
    } catch {
      // the text is there to select and copy by hand
    }
  };
  return { copied, copy };
}

const codeBoxClass =
  "cs-glass-field block w-full resize-none rounded-[11px] border px-3 py-2 font-mono text-[12px] leading-[1.5] text-[var(--text-main)] outline-none";

function LeadFormShareCard({ companyId, form }: { companyId: string; form: LeadForm }) {
  const { copied, copy } = useCopied();
  const [showFrameCode, setShowFrameCode] = useState(false);
  const link = leadFormLink(companyId, form.id);
  const embedCode = leadFormEmbedCode(link);
  const frameCode = leadFormFrameCode(link);
  return (
    <SettingsCard
      title="Put it on your website"
      icon={Globe}
      description="Paste the code where the form should go — most website builders have an Embed or Custom HTML block for it. Or share the link. Changes you make here show on your website straight away."
    >
      <div className="space-y-3">
        <div>
          <span className={fieldLabelClass}>Link</span>
          <div className="flex items-center gap-1.5">
            <div className={`${glassFieldClass} flex select-all items-center overflow-hidden`}>
              <span className="truncate">{link}</span>
            </div>
            <button type="button" onClick={() => void copy("link", link)} className={secondaryButtonClass}>
              {copied === "link" ? <Check size={14} /> : <Copy size={14} />}
              <span className="max-sm:sr-only">{copied === "link" ? "Copied" : "Copy"}</span>
            </button>
            <a href={link} target="_blank" rel="noopener noreferrer" className={secondaryButtonClass} title="Open the form">
              <ExternalLink size={14} />
              <span className="max-sm:sr-only">Open</span>
            </a>
          </div>
        </div>
        <div>
          <div className="mb-1 flex items-center justify-between gap-2">
            <span className="text-[12px] font-medium text-[var(--text-muted)]">Embed code</span>
            <button type="button" onClick={() => void copy("embed", embedCode)} className={smallButtonClass}>
              {copied === "embed" ? <Check size={13} /> : <Copy size={13} />}
              {copied === "embed" ? "Copied" : "Copy code"}
            </button>
          </div>
          <textarea readOnly value={embedCode} rows={3} onFocus={(e) => e.currentTarget.select()} className={codeBoxClass} spellCheck={false} />
        </div>
        <div>
          <button
            type="button"
            onClick={() => setShowFrameCode((prev) => !prev)}
            className="inline-flex items-center gap-1 text-[12px] font-medium text-[var(--brand-strong)] hover:underline"
            aria-expanded={showFrameCode}
          >
            <ChevronDown size={13} style={{ transform: showFrameCode ? "rotate(180deg)" : "none", transition: "transform 180ms ease" }} />
            Website won&apos;t take scripts? Use this instead
          </button>
          {showFrameCode ? (
            <div className="mt-2">
              <div className="mb-1 flex items-center justify-between gap-2">
                <span className="text-[12px] font-medium text-[var(--text-muted)]">A plain frame (it won&apos;t resize itself to fit the form)</span>
                <button type="button" onClick={() => void copy("frame", frameCode)} className={smallButtonClass}>
                  {copied === "frame" ? <Check size={13} /> : <Copy size={13} />}
                  {copied === "frame" ? "Copied" : "Copy code"}
                </button>
              </div>
              <textarea readOnly value={frameCode} rows={3} onFocus={(e) => e.currentTarget.select()} className={codeBoxClass} spellCheck={false} />
            </div>
          ) : null}
        </div>
        {isPreviewMode() ? (
          <p className="text-[12px] leading-[1.45]" style={{ color: "var(--text-muted)" }}>
            In the Preview nothing is saved, so these won&apos;t open a form — they will for your real company.
          </p>
        ) : null}
      </div>
    </SettingsCard>
  );
}

// Lead forms: the list (open, duplicate, delete) and the full-screen builder for the one being edited.
export function LeadFormsPanel({
  companyId,
  forms,
  setForms,
}: {
  companyId: string;
  forms: LeadForm[];
  setForms: Dispatch<SetStateAction<LeadForm[]>>;
}) {
  const { copy: copyText } = useCopied();
  // The Undo bar along the bottom, after a form, question or choice is taken off (components/undo-bar.tsx).
  const offerUndo = useUndo();
  const [editingFormId, setEditingFormId] = useState("");
  const [editorOrigin, setEditorOrigin] = useState<GlassModalOrigin>(null);
  const editorPanelRef = useRef<HTMLDivElement | null>(null);
  const editorOriginElRef = useRef<HTMLElement | null>(null);
  const shouldRenderEditor = useGlassModalPopOrigin(Boolean(editingFormId), editorOrigin, editorPanelRef, undefined, editorOriginElRef);
  // The form on screen while the builder closes (its id's already cleared by then).
  const [shownFormId, setShownFormId] = useState("");
  const [expandedQuestionId, setExpandedQuestionId] = useState("");
  const [dragIndex, setDragIndex] = useState<number | null>(null);
  const [mobilePane, setMobilePane] = useState<"edit" | "preview">("edit");
  const [deleteFormId, setDeleteFormId] = useState("");
  const [deleteOrigin, setDeleteOrigin] = useState<GlassModalOrigin>(null);
  const deletePanelRef = useRef<HTMLDivElement | null>(null);
  const deleteOriginElRef = useRef<HTMLElement | null>(null);
  const shouldRenderDelete = useGlassModalPopOrigin(Boolean(deleteFormId), deleteOrigin, deletePanelRef, undefined, deleteOriginElRef);
  const [shownDeleteFormId, setShownDeleteFormId] = useState("");

  const editingForm = forms.find((form) => form.id === (editingFormId || shownFormId)) ?? null;
  const deletingForm = forms.find((form) => form.id === (deleteFormId || shownDeleteFormId)) ?? null;

  const openEditor = (formId: string, event?: ReactMouseEvent<HTMLElement>) => {
    if (event) {
      editorOriginElRef.current = event.currentTarget;
      setEditorOrigin(captureGlassModalOrigin(event));
    } else {
      editorOriginElRef.current = null;
      setEditorOrigin(null);
    }
    setShownFormId(formId);
    setEditingFormId(formId);
    setExpandedQuestionId("");
    setMobilePane("edit");
  };

  const updateForm = (formId: string, update: (form: LeadForm) => LeadForm) => {
    setForms((prev) => prev.map((form) => (form.id === formId ? { ...update(form), updatedAtIso: new Date().toISOString() } : form)));
  };
  const updateQuestion = (formId: string, questionId: string, patch: Partial<LeadFormQuestion>) => {
    updateForm(formId, (form) => ({
      ...form,
      questions: form.questions.map((question) => (question.id === questionId ? { ...question, ...patch } : question)),
    }));
  };

  // A form, question or choice taken off — and the Undo bar, putting it back where it was (saved with the rest of the
  // page, as the delete was). Already back, or its form gone by then: nothing more to do.
  const deleteForm = (formId: string) => {
    const index = forms.findIndex((form) => form.id === formId);
    const removed = forms[index];
    if (!removed) return;
    setForms((prev) => prev.filter((form) => form.id !== formId));
    offerUndo(`${removed.name || "Untitled form"} deleted`, () =>
      setForms((prev) => (prev.some((form) => form.id === formId) ? prev : insertAt(prev, index, removed))),
    );
  };
  const removeQuestion = (formId: string, question: LeadFormQuestion) => {
    const index = forms.find((form) => form.id === formId)?.questions.findIndex((item) => item.id === question.id) ?? -1;
    if (index < 0) return;
    updateForm(formId, (form) => ({ ...form, questions: form.questions.filter((item) => item.id !== question.id) }));
    offerUndo(`${question.label.trim() || "Question"} removed`, () =>
      updateForm(formId, (form) =>
        form.questions.some((item) => item.id === question.id) ? form : { ...form, questions: insertAt(form.questions, index, question) },
      ),
    );
  };
  const removeChoice = (formId: string, questionId: string, optionIndex: number) => {
    const option = forms.find((form) => form.id === formId)?.questions.find((item) => item.id === questionId)?.options[optionIndex];
    if (option === undefined) return;
    const changeOptions = (change: (options: string[]) => string[]) =>
      updateForm(formId, (form) => ({
        ...form,
        questions: form.questions.map((item) => (item.id === questionId ? { ...item, options: change(item.options) } : item)),
      }));
    changeOptions((options) => options.filter((_, i) => i !== optionIndex));
    offerUndo(`${option.trim() || "Choice"} removed`, () => changeOptions((options) => insertAt(options, optionIndex, option)));
  };

  const addForm = (event: ReactMouseEvent<HTMLElement>) => {
    const form = newLeadForm(forms.length === 0 ? "Website enquiry" : `Form ${forms.length + 1}`);
    setForms((prev) => [...prev, form]);
    openEditor(form.id, event);
  };

  const addQuestion = (type: LeadFormQuestionType) => {
    if (!editingForm) return;
    const question = newLeadFormQuestion(type);
    updateForm(editingForm.id, (form) => ({ ...form, questions: [...form.questions, question] }));
    setExpandedQuestionId(question.id);
  };

  // A question added at the bottom of a long list: brought into view.
  useEffect(() => {
    if (!expandedQuestionId) return;
    const frame = window.requestAnimationFrame(() => {
      document.querySelector(`[data-lead-form-editor-question="${CSS.escape(expandedQuestionId)}"]`)?.scrollIntoView({ block: "nearest", behavior: "smooth" });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [expandedQuestionId]);

  return (
    <>
      <SettingsCard
        title="Lead forms"
        icon={FileInput}
        description="The forms people fill in to send you a lead — on your website, or by your team with Create Lead on the Leads page. Make as many as you like."
        headerRight={
          <button type="button" onClick={addForm} className={primaryButtonClass} style={primaryButtonStyle}>
            <Plus size={15} /> New form
          </button>
        }
      >
        {forms.length === 0 ? (
          <div className="flex flex-col items-center gap-2 rounded-[14px] border border-dashed px-4 py-8 text-center" style={{ borderColor: "color-mix(in srgb, var(--text-main) 18%, transparent)" }}>
            <FileInput size={22} style={{ color: "var(--text-muted)" }} />
            <p className="text-[13px] font-medium" style={{ color: "var(--text-main)" }}>
              No lead forms yet.
            </p>
            <p className="max-w-[420px] text-[12.5px]" style={{ color: "var(--text-muted)" }}>
              Start one with the usual questions — name, phone, email, address and their project — then change it however you like.
            </p>
            <button type="button" onClick={addForm} className={`${secondaryButtonClass} mt-1`}>
              <Plus size={14} /> Create a form
            </button>
          </div>
        ) : (
          <div className="space-y-1.5">
            {forms.map((form) => (
              <div key={form.id} className={`${listRowClass} py-2`}>
                <span className="ml-1 inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-[10px]" style={{ backgroundColor: "var(--brand-soft)", color: "var(--brand-strong)" }}>
                  <FileInput size={15} strokeWidth={2.1} />
                </span>
                <button type="button" onClick={(e) => openEditor(form.id, e)} className="min-w-0 flex-1 text-left">
                  <p className="truncate text-[13.5px] font-medium" style={{ color: "var(--text-main)" }}>
                    {form.name || "Untitled form"}
                  </p>
                  <p className="truncate text-[12px]" style={{ color: "var(--text-muted)" }}>
                    {form.questions.length} question{form.questions.length === 1 ? "" : "s"}
                    {form.title ? ` · “${form.title}”` : ""}
                  </p>
                </button>
                <button type="button" onClick={(e) => openEditor(form.id, e)} className={smallButtonClass}>
                  Edit
                </button>
                <GlassActionMenu
                  ariaLabel="More"
                  openWithOneItem
                  menuMinWidth={180}
                  triggerClassName="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-[var(--text-main)] transition hover:bg-[var(--panel-muted)]"
                  items={[
                    {
                      key: "link",
                      label: "Copy link",
                      icon: <Link2 size={14} />,
                      onSelect: () => void copyText("link", leadFormLink(companyId, form.id)),
                    },
                    {
                      key: "duplicate",
                      label: "Duplicate",
                      icon: <Copy size={14} />,
                      onSelect: () => setForms((prev) => [...prev, duplicateLeadForm(form)]),
                    },
                    {
                      key: "delete",
                      label: "Delete",
                      icon: <Trash2 size={14} />,
                      danger: true,
                      onSelect: () => {
                        deleteOriginElRef.current = null;
                        setDeleteOrigin(null);
                        setShownDeleteFormId(form.id);
                        setDeleteFormId(form.id);
                      },
                    },
                  ]}
                >
                  <MoreHorizontal size={16} />
                </GlassActionMenu>
              </div>
            ))}
          </div>
        )}
      </SettingsCard>

      {shouldRenderEditor && editingForm && typeof document !== "undefined"
        ? createPortal(
            <div ref={editorPanelRef} data-full-screen-window="true" className="fixed inset-0 z-[1750] flex flex-col bg-[var(--bg-app)]">
              <div className="glass-page-header flex h-[56px] shrink-0 items-center justify-between gap-2 px-4 md:px-5">
                <div className="inline-flex min-w-0 items-center gap-2 text-[14px] font-medium" style={{ color: "var(--text-main)" }}>
                  <FileInput size={14} className="shrink-0" />
                  <span className="shrink-0 uppercase tracking-[1px]">Lead form</span>
                  <span className="truncate max-sm:hidden" style={{ color: "var(--text-muted)" }}>
                    · {editingForm.name || "Untitled form"}
                  </span>
                </div>
                <button
                  type="button"
                  onClick={() => setEditingFormId("")}
                  className="inline-flex h-9 shrink-0 items-center gap-2 rounded-[10px] border px-3 text-[12px] font-bold transition hover:brightness-95"
                  style={{ borderColor: "var(--brand-strong)", backgroundColor: "var(--brand-soft)", color: "var(--brand-strong)" }}
                >
                  <ArrowLeft size={14} />
                  <span className="max-sm:sr-only">Back</span>
                </button>
              </div>
              {/* Phones and tablets: the builder or the preview, one at a time. */}
              <div className="shrink-0 px-3 pt-3 lg:hidden">
                <Segmented
                  value={mobilePane}
                  options={[
                    { value: "edit", label: "Build" },
                    { value: "preview", label: "Preview" },
                  ]}
                  onChange={setMobilePane}
                  fill
                  pill
                />
              </div>
              <div className="grid min-h-0 flex-1 gap-4 p-3 md:p-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,460px)]">
                <div className={`glass-scroll min-h-0 space-y-4 overflow-y-auto pb-6 ${mobilePane === "edit" ? "" : "max-lg:hidden"}`}>
                  <LeadFormShareCard companyId={companyId} form={editingForm} />
                  <SettingsCard title="Details" description="What your team calls the form, and the words around its questions.">
                    <div className="grid gap-3 sm:grid-cols-2">
                      <div>
                        <label className={fieldLabelClass}>Form name (your team sees this)</label>
                        <input
                          value={editingForm.name}
                          onChange={(e) => updateForm(editingForm.id, (form) => ({ ...form, name: e.target.value }))}
                          placeholder="e.g. Website enquiry"
                          className={glassFieldClass}
                        />
                      </div>
                      <div>
                        <label className={fieldLabelClass}>Title</label>
                        <input
                          value={editingForm.title}
                          onChange={(e) => updateForm(editingForm.id, (form) => ({ ...form, title: e.target.value }))}
                          placeholder="e.g. Get in touch"
                          className={glassFieldClass}
                        />
                      </div>
                      <div className="sm:col-span-2">
                        <label className={fieldLabelClass}>Intro</label>
                        <textarea
                          value={editingForm.intro}
                          onChange={(e) => updateForm(editingForm.id, (form) => ({ ...form, intro: e.target.value }))}
                          placeholder="A line or two under the title (optional)"
                          rows={2}
                          className={textAreaClass}
                        />
                      </div>
                      <div>
                        <label className={fieldLabelClass}>Button</label>
                        <input
                          value={editingForm.submitLabel}
                          onChange={(e) => updateForm(editingForm.id, (form) => ({ ...form, submitLabel: e.target.value }))}
                          placeholder="Send"
                          className={glassFieldClass}
                        />
                      </div>
                      <div className="sm:col-span-2">
                        <label className={fieldLabelClass}>After it&apos;s sent</label>
                        <textarea
                          value={editingForm.thankYouMessage}
                          onChange={(e) => updateForm(editingForm.id, (form) => ({ ...form, thankYouMessage: e.target.value }))}
                          placeholder="Thanks! We'll be in touch."
                          rows={2}
                          className={textAreaClass}
                        />
                      </div>
                    </div>
                  </SettingsCard>
                  <SettingsCard
                    title="Questions"
                    description="In the order they're asked. Open one to change it."
                    allowOverflow
                    headerRight={
                      <GlassActionMenu
                        ariaLabel="Add question"
                        openWithOneItem
                        menuMinWidth={200}
                        triggerClassName={primaryButtonClass}
                        triggerStyle={primaryButtonStyle}
                        items={LEAD_FORM_QUESTION_TYPES.map((row) => ({
                          key: row.type,
                          label: row.label,
                          icon: <QuestionTypeIcon type={row.type} size={14} />,
                          onSelect: () => addQuestion(row.type),
                        }))}
                      >
                        <Plus size={15} />
                        <span className="max-sm:sr-only">Add question</span>
                      </GlassActionMenu>
                    }
                  >
                    {editingForm.questions.length === 0 ? (
                      <p className="text-[13px] font-medium" style={{ color: "var(--text-muted)" }}>
                        No questions yet — add one.
                      </p>
                    ) : (
                      <div className="space-y-1.5">
                        {editingForm.questions.map((question, index) => (
                          <div key={question.id} data-lead-form-editor-question={question.id}>
                            <QuestionEditor
                              question={question}
                              index={index}
                              count={editingForm.questions.length}
                              expanded={expandedQuestionId === question.id}
                              dragging={dragIndex === index}
                              onToggle={() => setExpandedQuestionId((prev) => (prev === question.id ? "" : question.id))}
                              onChange={(patch) => updateQuestion(editingForm.id, question.id, patch)}
                              onMove={(to) => updateForm(editingForm.id, (form) => ({ ...form, questions: moveItem(form.questions, index, to) }))}
                              onRemove={() => removeQuestion(editingForm.id, question)}
                              onRemoveChoice={(optionIndex) => removeChoice(editingForm.id, question.id, optionIndex)}
                              onDragStart={(e) => {
                                setDragIndex(index);
                                e.dataTransfer.effectAllowed = "move";
                                e.dataTransfer.setData("text/plain", question.id);
                              }}
                              onDragEnter={() => {
                                if (dragIndex == null || dragIndex === index) return;
                                updateForm(editingForm.id, (form) => ({ ...form, questions: moveItem(form.questions, dragIndex, index) }));
                                setDragIndex(index);
                              }}
                              onDragEnd={() => setDragIndex(null)}
                            />
                          </div>
                        ))}
                      </div>
                    )}
                  </SettingsCard>
                </div>
                <div className={`glass-scroll min-h-0 overflow-y-auto pb-6 ${mobilePane === "preview" ? "" : "max-lg:hidden"}`}>
                  <div className="mb-2 flex items-center gap-2 px-1">
                    <span className={countPillClass}>Preview</span>
                    <span className="text-[12px]" style={{ color: "var(--text-muted)" }}>
                      Try it — nothing is sent.
                    </span>
                  </div>
                  <div
                    className="rounded-[20px] border p-5 md:p-6"
                    style={{ borderColor: "var(--glass-border)", backgroundColor: "var(--panel-bg)", boxShadow: "var(--shadow-sm)" }}
                  >
                    {/* Keyed by the questions, so a changed form starts the preview afresh. */}
                    <LeadFormPreview key={editingForm.questions.map((question) => `${question.id}:${question.type}`).join("|")} form={editingForm} />
                  </div>
                </div>
              </div>
            </div>,
            document.body,
          )
        : null}

      {shouldRenderDelete && deletingForm && typeof document !== "undefined"
        ? createPortal(
            <div className="fixed inset-0 z-[1760] flex items-center justify-center px-4">
              <button type="button" aria-label="Cancel" onClick={() => setDeleteFormId("")} className="glass-modal-backdrop absolute inset-0" />
              <div ref={deletePanelRef} className="glass-modal-panel relative w-[min(420px,96vw)] overflow-hidden">
                <GlassModalHeader title={`Delete “${deletingForm.name || "Untitled form"}”?`} onClose={() => setDeleteFormId("")} />
                <div className="px-5 py-4">
                  <p className="text-[13px] leading-[1.5]" style={{ color: "var(--text-main)" }}>
                    Leads that came in through it stay in Leads. The form itself can&apos;t be brought back.
                  </p>
                  <div className="mt-4 flex justify-end gap-2">
                    <button type="button" onClick={() => setDeleteFormId("")} className={secondaryButtonClass}>
                      Cancel
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        const id = deleteFormId;
                        setDeleteFormId("");
                        deleteForm(id);
                      }}
                      className="inline-flex h-9 shrink-0 items-center justify-center gap-1.5 rounded-[11px] px-4 text-[12.5px] font-semibold text-white transition hover:brightness-105"
                      style={{ backgroundColor: "var(--danger)" }}
                    >
                      <Trash2 size={14} /> Delete form
                    </button>
                  </div>
                </div>
              </div>
            </div>,
            document.body,
          )
        : null}
    </>
  );
}

// Addresses handed out while this page has been open — shown straight away if the card is opened again before the
// company is next loaded (when it's saved on the company doc anyway).
const handedOutInboxes = new Map<string, string>();

// The company's leads email inbox: its address — saved on the company doc (leadInbox, lib/lead-inbox.ts) once it's
// been handed out, so it's shown straight away; only a company without one yet asks the server for it
// (app/api/leads/inbox). Plus Gmail's "confirm forwarding" request when one has come in (until the first email
// does), when the last email came in, and how to send emails to it.
export function LeadInboxPanel({ companyId, savedInbox }: { companyId: string; savedInbox: unknown }) {
  const savedLocalPart = savedLeadInboxLocalPart(savedInbox);
  const knownAddress = savedLocalPart ? leadInboxAddress(savedLocalPart) : handedOutInboxes.get(companyId) || "";
  const [fetched, setFetched] = useState<{ status: "loading" | "ready" | "preview" | "error"; address: string }>({ status: "loading", address: "" });
  const inbox = knownAddress ? { status: "ready" as const, address: knownAddress } : fetched;
  const { copied, copy } = useCopied();
  const [showHelp, setShowHelp] = useState(false);
  const saved = (savedInbox && typeof savedInbox === "object" ? savedInbox : {}) as Record<string, unknown>;
  const gmail = (saved.gmailConfirmation && typeof saved.gmailConfirmation === "object" ? saved.gmailConfirmation : null) as {
    code?: string;
    link?: string;
    requestedBy?: string;
  } | null;
  const lastReceived = String(saved.lastReceivedAtIso || "").trim();

  useEffect(() => {
    if (!companyId || knownAddress) return;
    let cancelled = false;
    void (async () => {
      let next: { status: "ready" | "preview" | "error"; address: string } = { status: "error", address: "" };
      try {
        const response = await authorizedFetch("/api/leads/inbox", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ companyId }),
        });
        const detail = (await response.json().catch(() => null)) as { ok?: boolean; address?: string; error?: string } | null;
        if (response.ok && detail?.address) {
          next = { status: "ready", address: String(detail.address) };
          handedOutInboxes.set(companyId, next.address);
        } else if (detail?.error === "preview") next = { status: "preview", address: "" };
      } catch {
        // stays "error"
      }
      if (!cancelled) setFetched(next);
    })();
    return () => {
      cancelled = true;
    };
  }, [companyId, knownAddress]);

  return (
    <SettingsCard
      title="Leads email inbox"
      icon={Mail}
      description="Your company's own email address for leads. Every email sent or forwarded to it becomes a New lead — auto-replies and newsletters are left out."
    >
      {inbox.status === "ready" ? (
        <div className="flex items-center gap-2">
          <div className={`${glassFieldClass} flex select-all items-center overflow-hidden`}>
            <span className="truncate">{inbox.address}</span>
          </div>
          <button type="button" onClick={() => void copy("inbox", inbox.address)} className={secondaryButtonClass}>
            {copied === "inbox" ? <Check size={14} /> : <Copy size={14} />}
            {copied === "inbox" ? "Copied" : "Copy"}
          </button>
        </div>
      ) : (
        <p className="text-[13px] font-medium" style={{ color: "var(--text-muted)" }}>
          {inbox.status === "loading"
            ? "Getting your address…"
            : inbox.status === "preview"
              ? "Each company gets its own address here — not in the Preview."
              : "Couldn't get your address just now. Try again in a moment."}
        </p>
      )}
      {gmail && (gmail.link || gmail.code) ? (
        // Gmail won't forward to a new address until it's confirmed — its confirmation email came here.
        <div className="mt-3 rounded-[12px] border px-3 py-2.5" style={{ borderColor: "var(--brand)", backgroundColor: "var(--brand-soft)" }}>
          <p className="text-[13px] font-medium" style={{ color: "var(--text-main)" }}>
            Gmail is asking to confirm forwarding{gmail.requestedBy ? ` from ${gmail.requestedBy}` : ""}.
          </p>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            {gmail.link ? (
              <a href={gmail.link} target="_blank" rel="noopener noreferrer" className={primaryButtonClass} style={primaryButtonStyle}>
                <ExternalLink size={14} /> Confirm forwarding
              </a>
            ) : null}
            {gmail.code ? (
              <span className="text-[12.5px] font-medium" style={{ color: "var(--text-main)" }}>
                Or enter code <span className="select-all font-semibold">{gmail.code}</span> in Gmail
              </span>
            ) : null}
          </div>
        </div>
      ) : null}
      <p className="mt-2.5 text-[12px] leading-[1.45]" style={{ color: "var(--text-muted)" }}>
        {lastReceived ? `Last email received ${activeDateTime(lastReceived)}.` : "No emails received yet."}
      </p>
      <button
        type="button"
        onClick={() => setShowHelp((prev) => !prev)}
        className="mt-2 inline-flex items-center gap-1 text-[12px] font-medium text-[var(--brand-strong)] hover:underline"
        aria-expanded={showHelp}
      >
        <ChevronDown size={13} style={{ transform: showHelp ? "rotate(180deg)" : "none", transition: "transform 180ms ease" }} />
        How to send emails here
      </button>
      {showHelp ? (
        <ul className="mt-2 space-y-1.5 text-[12.5px] leading-[1.5]" style={{ color: "var(--text-main)" }}>
          <li>
            <span className="font-semibold">Gmail:</span>{" "} Settings → See all settings → Forwarding and POP/IMAP → Add a forwarding address, and paste
            this address. Gmail&apos;s confirmation shows up here. To forward only enquiries, make a filter that forwards them here instead.
          </li>
          <li>
            <span className="font-semibold">Outlook:</span>{" "} Settings → Mail → Forwarding (or Rules → Forward to), and paste this address.
          </li>
          <li>
            <span className="font-semibold">Your website&apos;s contact form:</span>{" "} add this address to who its emails are sent to.
          </li>
          <li>
            <span className="font-semibold">One at a time:</span>{" "} forward any enquiry here — the lead is made for the person who sent it to you.
          </li>
        </ul>
      ) : null}
    </SettingsCard>
  );
}
