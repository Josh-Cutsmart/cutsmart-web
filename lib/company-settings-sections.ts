// Company Settings' sections (its side rail, in order, grouped) and what its search can find in them — every card
// (plus key individual settings) and the section it's on. Used by the Company Settings page
// (app/(staff)/(app)/company-settings/page.tsx) and the app's global search (components/global-search.tsx).
import type React from "react";
import { Building2, CalendarDays, CircleDollarSign, DatabaseBackup, Hammer, HardHat, Inbox, Layers3, LayoutDashboard, Link2, Package2, Users, Wrench } from "lucide-react";

export type SettingsSection =
  | "company" | "dashboard" | "smalljobs" | "calendar" | "leads" | "sales" | "production" | "nesting" | "materials"
  | "hardware" | "staff" | "integrations" | "backup";

export const SETTINGS_SECTIONS: Array<{
  key: SettingsSection;
  label: string;
  group: string;
  description: string;
  icon: React.ComponentType<{ size?: number; strokeWidth?: number }>;
}> = [
  { key: "company", label: "Company", group: "General", icon: Building2, description: "Your brand and the formats used everywhere in CutSmart." },
  // Same icon as the sidebar's Dashboard item (components/app-shell.tsx topNav).
  { key: "dashboard", label: "Dashboard", group: "General", icon: LayoutDashboard, description: "Statuses, tags, contact categories, how long deleted items are kept and when finished projects are archived." },
  // Same icon as the sidebar's Small Jobs item.
  { key: "smalljobs", label: "Small Jobs", group: "General", icon: Hammer, description: "The statuses your small jobs move through." },
  { key: "calendar", label: "Calendar", group: "General", icon: CalendarDays, description: "The categories events can belong to on the Calendar tab." },
  { key: "leads", label: "Leads", group: "Sales", icon: Inbox, description: "Your lead forms, your leads email inbox and the statuses on your Leads board." },
  { key: "sales", label: "Sales", group: "Sales", icon: CircleDollarSign, description: "Quote & specs layouts, products, helpers and discounts." },
  { key: "production", label: "Production", group: "Workshop", icon: Wrench, description: "Cutlists, part types, gap allowances and production access." },
  { key: "nesting", label: "Machining", group: "Workshop", icon: Layers3, description: "Your machines, their settings, servicing and nesting rules." },
  { key: "materials", label: "Materials & Boards", group: "Workshop", icon: Package2, description: "Sheet thicknesses, finishes, sizes and remembered board colours." },
  { key: "hardware", label: "Hardware", group: "Workshop", icon: HardHat, description: "Hardware brands with their drawers, hinges and other parts." },
  { key: "staff", label: "Staff & Permissions", group: "Team & Data", icon: Users, description: "Who's in your company, their roles and what each role can do." },
  { key: "integrations", label: "Integrations", group: "Team & Data", icon: Link2, description: "Connect outside tools to CutSmart." },
  { key: "backup", label: "Backup & Output", group: "Team & Data", icon: DatabaseBackup, description: "Quote output templates and a snapshot of your settings." },
];

export const SETTINGS_SEARCH_INDEX: Array<{ section: SettingsSection; label: string; card: string; keywords?: string }> = [
  { section: "company", card: "Brand", label: "Company name" },
  { section: "company", card: "Brand", label: "Company logo" },
  { section: "company", card: "Brand", label: "Theme colour", keywords: "color brand" },
  { section: "company", card: "Company", label: "Company details", keywords: "address phone email join codes invite" },
  { section: "company", card: "Regional formats", label: "Currency", keywords: "money price dollar" },
  { section: "company", card: "Regional formats", label: "Measurement unit", keywords: "mm inches millimetres" },
  { section: "company", card: "Regional formats", label: "Date format" },
  { section: "dashboard", card: "Project statuses", label: "Project statuses", keywords: "sub-stages board columns" },
  { section: "dashboard", card: "Contact categories", label: "Contact categories" },
  { section: "dashboard", card: "Completion bonus", label: "Completion bonus", keywords: "bonus period quarter paid non qualified minimum quote" },
  { section: "dashboard", card: "Tags", label: "Tags" },
  { section: "dashboard", card: "Finished projects", label: "Archive completed projects", keywords: "archived client portal link completed instantly recently deleted trash" },
  { section: "smalljobs", card: "Small job statuses", label: "Small job statuses", keywords: "small jobs fixes open closed" },
  { section: "calendar", card: "Calendar categories", label: "Calendar categories", keywords: "events sub-calendars colours teamup" },
  { section: "calendar", card: "Client portal", label: "Show events on the client portal", keywords: "schedule linked events client" },
  { section: "calendar", card: "Old events", label: "Archive old events", keywords: "retention past events" },
  { section: "calendar", card: "Workdays", label: "Workdays", keywords: "business days weekends" },
  { section: "calendar", card: "Workdays", label: "Show non-workdays", keywords: "hide weekends month week view" },
  { section: "calendar", card: "Public holidays", label: "Public holidays", keywords: "region anniversary day matariki labour christmas easter nz" },
  { section: "leads", card: "Lead forms", label: "Lead forms", keywords: "enquiry website embed questions create lead" },
  { section: "leads", card: "Leads email inbox", label: "Leads email inbox", keywords: "email address forward" },
  { section: "leads", card: "Lead statuses", label: "Lead statuses" },
  { section: "sales", card: "Layout builders", label: "Specs & quote layouts", keywords: "template builder" },
  { section: "sales", card: "Client confirmation", label: "Reopen for editing" },
  { section: "sales", card: "Layout builders", label: "Item categories", keywords: "items picker" },
  { section: "sales", card: "Products", label: "Products", keywords: "job types sheet prices" },
  { section: "sales", card: "GST", label: "GST", keywords: "tax gst rate quote total" },
  { section: "sales", card: "Extra charges", label: "Extra charges", keywords: "quote charges delivery installation default" },
  { section: "sales", card: "Rooms", label: "Rooms", keywords: "room names kitchen laundry order production" },
  { section: "sales", card: "Quote discount", label: "Quote discount", keywords: "tiers" },
  { section: "production", card: "Cutlist columns", label: "Cutlist columns" },
  { section: "production", card: "Production access", label: "Production access", keywords: "unlock code" },
  { section: "production", card: "Contractors", label: "Contractors", keywords: "trades" },
  { section: "production", card: "Gap allowances", label: "Gap allowances" },
  { section: "production", card: "Part types", label: "Part types", keywords: "autoclash" },
  { section: "nesting", card: "Machines", label: "Machines", keywords: "cnc table saw edge bander kerf" },
  { section: "materials", card: "Sheet thicknesses", label: "Sheet thicknesses" },
  { section: "materials", card: "Board finishes", label: "Board finishes" },
  { section: "materials", card: "Sheet sizes", label: "Sheet sizes" },
  { section: "materials", card: "Board colour memory", label: "Board colour memory", keywords: "edging" },
  { section: "hardware", card: "Hardware brands", label: "Hardware brands", keywords: "drawers hinges" },
  { section: "hardware", card: "Hardware brands", label: "Copy for cart format", keywords: "ordering order quick order blum cart id number item number quantity placeholders paste" },
  { section: "staff", card: "Staff", label: "Staff", keywords: "invite members" },
  { section: "staff", card: "Roles", label: "Roles & permissions" },
  { section: "staff", card: "Audit log", label: "Audit log", keywords: "roles permissions changes history who changed" },
  { section: "integrations", card: "Zapier Forms", label: "Zapier", keywords: "webhook leads" },
  { section: "backup", card: "Quote output template", label: "Quote output template", keywords: "header footer page size margin" },
  { section: "backup", card: "Full data export", label: "Full data export", keywords: "backup export everything download json projects contacts leads" },
  { section: "backup", card: "Backup snapshot", label: "Backup snapshot", keywords: "export json" },
];
