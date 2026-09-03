export type QuoteTemplatePlaceholderOption = {
  key: string;
  label: string;
  token: string;
};

export function interpolateQuoteTemplateText(value: string, replacements: Record<string, string>): string {
  return String(value || "").replace(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g, (_, key: string) => {
    const lookup = replacements[key];
    return lookup == null ? "" : String(lookup);
  });
}

export const QUOTE_TEMPLATE_PLACEHOLDERS: QuoteTemplatePlaceholderOption[] = [
  { key: "date_generated", label: "Date Generated", token: "{{date_generated}}" },
  { key: "project_name", label: "Project Name", token: "{{project_name}}" },
  { key: "client_name", label: "Client Name", token: "{{client_name}}" },
  { key: "client_phone", label: "Client Phone", token: "{{client_phone}}" },
  { key: "client_email", label: "Client Email", token: "{{client_email}}" },
  { key: "client_address", label: "Client Address", token: "{{client_address}}" },
  { key: "client_region", label: "Client Region", token: "{{client_region}}" },
  { key: "client_first_name", label: "Client First Name", token: "{{client_first_name}}" },
  { key: "client_last_name", label: "Client Last Name", token: "{{client_last_name}}" },
  { key: "quote_total", label: "Quote Total", token: "{{quote_total}}" },
  { key: "discount_total", label: "Discount Total", token: "{{discount_total}}" },
  { key: "incl_gst", label: "Incl GST", token: "{{incl_gst}}" },
  { key: "project_creator", label: "Project Creator", token: "{{project_creator}}" },
  { key: "project_creator_mobile", label: "Project Creator Mobile", token: "{{project_creator_mobile}}" },
  { key: "project_creator_email", label: "Project Creator Email", token: "{{project_creator_email}}" },
  { key: "project_assigned", label: "Project Assigned", token: "{{project_assigned}}" },
  { key: "project_assigned_mobile", label: "Project Assigned Mobile", token: "{{project_assigned_mobile}}" },
  { key: "project_assigned_email", label: "Project Assigned Email", token: "{{project_assigned_email}}" },
];
