// What a project's emailed copy can hold as it's deleted (the Archive's "Delete permanently" pop-up — see
// lib/project-email-copy.ts and app/api/projects/email-copy): the client details in the email's body, and the rest as
// PDFs attached. All of them are on to begin with; whoever's deleting turns off what they don't want sent. No Firebase
// in here, so the pop-up, the PDF builder and the server route share it.

export type ProjectCopySection = "clientDetails" | "specifications" | "quote" | "initialMeasure" | "production" | "images";

export const PROJECT_COPY_SECTIONS: Array<{ key: ProjectCopySection; label: string; detail: string }> = [
  { key: "clientDetails", label: "Client details", detail: "In the email" },
  { key: "specifications", label: "Specifications", detail: "PDF" },
  { key: "quote", label: "Quote", detail: "PDF" },
  { key: "initialMeasure", label: "Initial measure cutlist", detail: "PDF" },
  { key: "production", label: "Production cutlist", detail: "PDF" },
  { key: "images", label: "Images", detail: "Attached" },
];

export type ProjectCopySections = Record<ProjectCopySection, boolean>;

export const ALL_PROJECT_COPY_SECTIONS: ProjectCopySections = {
  clientDetails: true,
  specifications: true,
  quote: true,
  initialMeasure: true,
  production: true,
  images: true,
};

// A file name that's safe everywhere: the project's name and what it is ("Smith Kitchen - Quote.pdf").
export function projectCopyFileName(projectName: string, label: string, ext = "pdf"): string {
  const clean = (text: string) => String(text || "").replace(/[\\/:*?"<>|]+/g, " ").replace(/\s+/g, " ").trim().slice(0, 80);
  return `${clean(projectName) || "Project"} - ${clean(label) || "File"}.${ext}`;
}
