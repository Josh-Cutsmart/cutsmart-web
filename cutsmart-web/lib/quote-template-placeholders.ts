export type QuoteTemplatePlaceholderOption = {
  key: string;
  label: string;
  token: string;
};

export const QUOTE_TEMPLATE_PLACEHOLDERS: QuoteTemplatePlaceholderOption[] = [
  { key: "date_generated", label: "Date Generated", token: "{{date_generated}}" },
  { key: "client_name", label: "Client Name", token: "{{client_name}}" },
  { key: "client_address", label: "Client Address", token: "{{client_address}}" },
  { key: "client_region", label: "Client Region", token: "{{client_region}}" },
  { key: "client_first_name", label: "Client First Name", token: "{{client_first_name}}" },
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
