import { Timestamp, doc, setDoc, type Firestore } from "@/lib/firestore-client";
import { parseUpdateNotesText } from "@/lib/update-notes-utils";

// The made-up company CutSmart Preview opens on (lib/preview-mode.ts): a joinery with a team, jobs at
// every stage, cutlists, a week in the calendar, contacts, leads and notifications. Written into the
// preview's offline, in-memory database (lib/firebase.ts) each time the preview starts, so whatever
// someone changes is gone when they leave. Everyone and everything here is fictional.

export const PREVIEW_COMPANY_ID = "cmp_cutsmart_preview";
export const PREVIEW_UID = "preview_you";
export const PREVIEW_EMAIL = "you@cutsmart-preview.app";
export const PREVIEW_NAME = "Alex Morgan";

const COMPANY_NAME = "CutSmart Demo Joinery";
const SAMPLE_LEADS_STORAGE_KEY = `cutsmart_sample_leads:${PREVIEW_COMPANY_ID}`;

// The company's master join code (Company Settings > Company > Join key).
const MASTER_CODE = "DEMO2026";

// How each joined: the owner made the company; the others used the master code, a one-person
// temporary code, or an invite (shown on their Staff row).
const TEAM = [
  { uid: PREVIEW_UID, name: PREVIEW_NAME, email: PREVIEW_EMAIL, roleId: "owner", color: "#2F6BFF", mobile: "021 555 0100", joinCodeKey: "", joinedVia: "" },
  { uid: "preview_mere", name: "Mere Tawhiri", email: "mere@cutsmart-preview.app", roleId: "admin", color: "#C2410C", mobile: "021 555 0101", joinCodeKey: "demo2026", joinedVia: "master-code" },
  { uid: "preview_liam", name: "Liam Chen", email: "liam@cutsmart-preview.app", roleId: "staff", color: "#0F766E", mobile: "021 555 0102", joinCodeKey: "k7qx-29pl", joinedVia: "temporary-code" },
  { uid: "preview_sophie", name: "Sophie Walker", email: "sophie@cutsmart-preview.app", roleId: "staff", color: "#7C3AED", mobile: "021 555 0103", joinCodeKey: "", joinedVia: "invite" },
];

const ALL_PERMISSIONS = {
  "company.*": true,
  "company.dashboard.view": true,
  "calendar.view": true,
  "clients.view": true,
  "clients.view.all": true,
  "leads.view": true,
  "leads.view.others": true,
  "projects.create": true,
  "projects.view": true,
  "projects.view.others": true,
  "projects.edit.others": true,
  "projects.status": true,
  "projects.create.others": true,
  "projects.assign.other": true,
  "sales.view": true,
  "sales.edit": true,
  "production.view": true,
  "production.edit": true,
  "production.key": true,
  "staff.add": true,
  "staff.remove": true,
  "staff.change.role": true,
  "staff.change.display_name": true,
  "company.settings": true,
  "company.updates": true,
  "dashboard.complete.bonus": true,
};

// Everything the preview's owner can do (they're the owner anyway).
export const PREVIEW_PERMISSION_KEYS = Object.keys(ALL_PERMISSIONS);

const ROLES = [
  { id: "owner", name: "Owner", color: "#1F2937", permissions: ALL_PERMISSIONS },
  { id: "admin", name: "Admin", color: "#2F6BFF", permissions: ALL_PERMISSIONS },
  {
    id: "staff",
    name: "Staff",
    color: "#7D99B3",
    permissions: {
      "company.dashboard.view": true,
      "calendar.view": true,
      "projects.view": true,
      "projects.view.others": true,
      "production.view": true,
      "production.edit": true,
      "clients.view": true,
      "leads.view": true,
    },
  },
];

const PROJECT_STATUSES = [
  { id: "new", name: "New", color: "#E8721C", isComplete: false, subStages: [] },
  {
    id: "design",
    name: "Design",
    color: "#C026D3",
    isComplete: false,
    subStages: [
      { name: "In Progress", color: "#7D9AD4", isDefault: true },
      { name: "Quoted", color: "#E15151", isDefault: false },
      { name: "Accepted", color: "#22A06B", isDefault: false },
      { name: "Ready for Site Measure", color: "#D98C73", isDefault: false },
    ],
  },
  {
    id: "production",
    name: "Production",
    color: "#3060D0",
    isComplete: false,
    subStages: [
      { name: "Site Measure", color: "#B85B32", isDefault: true },
      { name: "Dryfit", color: "#0F766E", isDefault: false },
      { name: "Installs", color: "#B09C17", isDefault: false },
      { name: "Small Jobs", color: "#A652B7", isDefault: false },
      { name: "Remedials", color: "#AF4141", isDefault: false },
      { name: "Production Complete", color: "#2A7A3B", isDefault: false },
      { name: "On Hold", color: "#64748B", isDefault: false },
    ],
  },
  { id: "completed", name: "Completed", color: "#2A7A3B", isComplete: true, subStages: [] },
];

const PART_TYPES = [
  { name: "Front", color: "#F2D57A", category: "door", door: true, autoClashLeft: "2L", autoClashRight: "2S", initialMeasure: true },
  { name: "Panel", color: "#C6E8AE", category: "panel", panel: true, initialMeasure: true },
  { name: "Extra", color: "#B7A4EB", category: "extra", extra: true },
  { name: "Drawer", color: "#B8D8F8", category: "drawer", drawer: true },
  { name: "Cabinet", color: "#4B5563", category: "cabinetry", cabinetry: true },
  { name: "Toekick", color: "#D6D3D1", category: "panel", panel: true },
].map((part) => ({
  name: part.name,
  color: part.color,
  category: part.category,
  kind: part.category,
  cabinetry: Boolean(part.cabinetry),
  drawer: Boolean(part.drawer),
  door: Boolean(part.door),
  panel: Boolean(part.panel),
  extra: Boolean(part.extra),
  autoClashLeft: part.autoClashLeft ?? "",
  autoClashRight: part.autoClashRight ?? "",
  initialMeasure: Boolean(part.initialMeasure),
  inCutlists: true,
  inNesting: true,
}));

const BOARDS = [
  { colour: "Chalk White", thickness: "18", finish: "Naturale", edging: "Matching", grain: false, lacquer: false, sheetSize: "2440 x 1220", sheets: "", edgetape: "" },
  { colour: "Natural Oak", thickness: "18", finish: "Woodgrain", edging: "Matching", grain: true, lacquer: false, sheetSize: "2440 x 1220", sheets: "", edgetape: "" },
  { colour: "Black", thickness: "16", finish: "Matt", edging: "Matching", grain: false, lacquer: false, sheetSize: "2440 x 1220", sheets: "", edgetape: "" },
];

function boardKey(index: number): string {
  const board = BOARDS[index];
  return `${board.colour} ${board.thickness}mm ${board.finish} @@ ${board.sheetSize}`;
}

type Job = {
  id: string;
  name: string;
  first: string;
  last: string;
  address: string;
  status: string;
  subStage?: string;
  tags: string[];
  assigned: number;
  createdDaysAgo: number;
  notes: string;
  boards: number[];
  rooms: Array<{ name: string; template: RoomTemplateName }>;
};

type RoomTemplateName = "kitchen" | "scullery" | "pantry" | "laundry" | "bathroom" | "wardrobe" | "living" | "reception" | "kitchenette";

const JOBS: Job[] = [
  { id: "prv_job_01", name: "Harbour View Kitchen", first: "Aroha", last: "Williams", address: "12 Kowhai Road, Ponsonby, Auckland", status: "New", tags: ["kitchen"], assigned: 1, createdDaysAgo: 2, notes: "Wants a scullery behind the main run. Call after 4pm.", boards: [0, 1], rooms: [{ name: "Kitchen", template: "kitchen" }, { name: "Scullery", template: "scullery" }] },
  { id: "prv_job_02", name: "Ellis St Laundry", first: "Tom", last: "Ellis", address: "48 Ellis Street, Frankton, Hamilton", status: "New", tags: ["laundry"], assigned: 1, createdDaysAgo: 4, notes: "Small laundry — tall cupboard and bench over the machines.", boards: [0], rooms: [{ name: "Laundry", template: "laundry" }] },
  { id: "prv_job_03", name: "Bayview Vanity", first: "Priya", last: "Shah", address: "7 Bayview Terrace, Mount Maunganui", status: "Design", subStage: "In Progress", tags: ["bathroom", "vanity"], assigned: 3, createdDaysAgo: 9, notes: "Floating vanity, 1200 wide, two drawers.", boards: [0, 1], rooms: [{ name: "Bathroom", template: "bathroom" }] },
  { id: "prv_job_04", name: "Kowhai Rd Wardrobes", first: "James", last: "Holloway", address: "33 Kowhai Road, Remuera, Auckland", status: "Design", subStage: "Quoted", tags: ["wardrobe"], assigned: 3, createdDaysAgo: 14, notes: "Two walk-in robes. Quote sent, waiting to hear back.", boards: [0, 2], rooms: [{ name: "Master Wardrobe", template: "wardrobe" }, { name: "Bedroom 2 Wardrobe", template: "wardrobe" }] },
  { id: "prv_job_05", name: "Ridgeway Entertainment Unit", first: "Hannah", last: "Brooks", address: "90 Ridgeway Drive, Tauranga", status: "Design", subStage: "Accepted", tags: ["living"], assigned: 1, createdDaysAgo: 18, notes: "Oak unit with open shelves either side of the TV.", boards: [2, 1], rooms: [{ name: "Living Room", template: "living" }] },
  { id: "prv_job_06", name: "Smith Kitchen Renovation", first: "Daniel", last: "Smith", address: "5 Totara Avenue, Hamilton East", status: "Production", subStage: "Site Measure", tags: ["kitchen", "rush"], assigned: 2, createdDaysAgo: 24, notes: "Site measure booked for this week. Island with waterfall end.", boards: [0, 1], rooms: [{ name: "Kitchen", template: "kitchen" }] },
  { id: "prv_job_07", name: "Henderson Laundry", first: "Grace", last: "Henderson", address: "21 Matai Street, Cambridge", status: "Production", subStage: "Dryfit", tags: ["laundry"], assigned: 2, createdDaysAgo: 30, notes: "Dryfit in the workshop before install.", boards: [0], rooms: [{ name: "Laundry", template: "laundry" }] },
  { id: "prv_job_08", name: "Patel Kitchen & Scullery", first: "Anil", last: "Patel", address: "140 Great South Road, Takanini", status: "Production", subStage: "Installs", tags: ["kitchen"], assigned: 2, createdDaysAgo: 41, notes: "Install over two days. Benchtops arrive Thursday.", boards: [0, 1], rooms: [{ name: "Kitchen", template: "kitchen" }, { name: "Scullery", template: "scullery" }] },
  { id: "prv_job_09", name: "Lee Office Fit-out", first: "Michelle", last: "Lee", address: "Level 2, 18 Victoria Street, Hamilton", status: "Production", subStage: "Small Jobs", tags: ["commercial"], assigned: 3, createdDaysAgo: 36, notes: "Reception desk and staff kitchenette.", boards: [0, 2], rooms: [{ name: "Reception", template: "reception" }, { name: "Kitchenette", template: "kitchenette" }] },
  { id: "prv_job_10", name: "Harper Bathroom Vanity", first: "Olivia", last: "Harper", address: "3 Rimu Lane, Raglan", status: "Production", subStage: "Production Complete", tags: ["bathroom", "vanity"], assigned: 3, createdDaysAgo: 50, notes: "Ready to deliver.", boards: [0, 1], rooms: [{ name: "Bathroom", template: "bathroom" }] },
  { id: "prv_job_11", name: "Cooper Pantry", first: "Ben", last: "Cooper", address: "62 Pine Crescent, Te Awamutu", status: "Completed", tags: ["kitchen"], assigned: 2, createdDaysAgo: 75, notes: "Walk-in pantry with pull-out baskets.", boards: [0], rooms: [{ name: "Pantry", template: "pantry" }] },
  { id: "prv_job_12", name: "Marsden Wardrobe", first: "Kate", last: "Marsden", address: "9 Marsden Road, Whangarei", status: "Completed", tags: ["wardrobe"], assigned: 1, createdDaysAgo: 90, notes: "Sliding doors, mirror on the left.", boards: [0, 2], rooms: [{ name: "Wardrobe", template: "wardrobe" }] },
];

// A cutlist part. Cabinets are carcasses (the app works out their parts); fronts and panels are in
// the job's front board, everything else in its carcass board.
type PartSpec = {
  type: "Cabinet" | "Front" | "Panel" | "Toekick" | "Extra";
  name: string;
  h: number;
  w: number;
  d?: number;
  q: number;
  kind?: "base" | "wall";
  adj?: number;
  fixed?: number;
  clash?: string;
  up?: string[];
  down?: string[];
  side?: string;
  info?: string;
};

// The sales items catalogue (Company Settings > Items) the rooms pick from.
const ITEM_CATEGORIES = [
  {
    name: "Hardware",
    color: "#FF8D0A",
    subcategories: [{ name: "Blum", color: "#FDBA74" }],
    items: [
      { name: "110° Soft Close Hinge", price: "12", subcategory: "Blum" },
      { name: "155° Soft Close Hinge", price: "18", subcategory: "Blum" },
      { name: "Blind Soft Close Hinge", price: "15", subcategory: "Blum" },
      { name: "Tip-On Push Latch", price: "22", subcategory: "Blum" },
      { name: "Bar Handle 160mm", price: "14", subcategory: "" },
      { name: "Wardrobe Hanging Rail (per m)", price: "25", subcategory: "" },
    ],
  },
  {
    name: "Drawers",
    color: "#2563EB",
    subcategories: [],
    items: [
      { name: "Legrabox Drawer", price: "145", subcategory: "" },
      { name: "Legrabox Inner Pot Drawer", price: "165", subcategory: "" },
    ],
  },
  {
    name: "Bins",
    color: "#47729A",
    subcategories: [],
    items: [
      { name: "20L Double Bin (Door Pull)", price: "440", subcategory: "" },
      { name: "40L Double Bin (Door Pull)", price: "520", subcategory: "" },
    ],
  },
  {
    name: "Benchtops",
    color: "#A16207",
    subcategories: [],
    items: [
      { name: "20mm Engineered Stone (per m)", price: "650", subcategory: "" },
      { name: "Laminate Benchtop (per m)", price: "180", subcategory: "" },
    ],
  },
  {
    name: "Extra Labour",
    color: "#64748B",
    subcategories: [],
    items: [{ name: "1 man hour", price: "85", subcategory: "" }],
  },
].map((category) => ({
  ...category,
  items: category.items.map((item) => ({ ...item, description: "", markupPercent: "0" })),
}));

// The sales job types (Company Settings > Sales) — what a quote is priced on, per sheet.
const SALES_JOB_TYPES = [
  { name: "Melteca", type: "melteca", pricePerSheet: "185" },
  { name: "Woodgrain", type: "grain", pricePerSheet: "240" },
  { name: "Lacquer (1 side)", type: "lacquer-1", pricePerSheet: "420" },
  { name: "Lacquer (2 side)", type: "lacquer-2", pricePerSheet: "520" },
].map((jobType) => ({
  ...jobType,
  sheetSize: "2440 x 1220",
  sheetPrices: [{ sheetSize: "2440 x 1220", pricePerSheet: jobType.pricePerSheet }],
  showInSales: true,
}));

const ROOM_TEMPLATES: Record<RoomTemplateName, { parts: PartSpec[]; items: Array<[category: string, item: string, quantity: number]> }> = {
  kitchen: {
    parts: [
      { type: "Cabinet", name: "Left Hand Sink", h: 720, w: 450, d: 570, q: 1, adj: 1 },
      { type: "Cabinet", name: "Sink (2 Door)", h: 720, w: 900, d: 570, q: 1, adj: 1 },
      { type: "Cabinet", name: "Hob (3 Drawer)", h: 720, w: 900, d: 570, q: 1 },
      { type: "Cabinet", name: "Bin (Single Door)", h: 720, w: 300, d: 570, q: 1, fixed: 1 },
      { type: "Cabinet", name: "Corner Blind", h: 720, w: 1000, d: 570, q: 1, adj: 1 },
      { type: "Cabinet", name: "Right Hand 4 Drawer", h: 720, w: 600, d: 570, q: 1 },
      { type: "Cabinet", name: "Extractor", h: 360, w: 600, d: 300, q: 1, kind: "wall" },
      { type: "Cabinet", name: "Above Fridge", h: 480, w: 900, d: 600, q: 1, kind: "wall" },
      { type: "Cabinet", name: "Wall Cupboard (2 Door)", h: 720, w: 800, d: 300, q: 1, kind: "wall", adj: 2 },
      { type: "Cabinet", name: "Pantry Tower", h: 2100, w: 600, d: 570, q: 1, adj: 4 },
      { type: "Cabinet", name: "Oven Tower", h: 2100, w: 600, d: 570, q: 1, fixed: 2 },
      { type: "Front", name: "Left Hand Sink Door", h: 716, w: 447, q: 1, up: ["100"], down: ["100"], side: "Left" },
      { type: "Front", name: "Sink Doors", h: 716, w: 447, q: 2, up: ["100"], down: ["100"], side: "Mirror" },
      { type: "Front", name: "Hob Drawer Fronts", h: 236, w: 896, q: 3 },
      { type: "Front", name: "Bin Front", h: 716, w: 297, q: 1 },
      { type: "Front", name: "Corner Blind Door", h: 716, w: 447, q: 1, up: ["100"], down: ["100"], side: "Right" },
      { type: "Front", name: "Right Hand 4 Drawer Fronts", h: 176, w: 596, q: 4 },
      { type: "Front", name: "Extractor Door", h: 356, w: 597, q: 1, up: ["80"], side: "Top" },
      { type: "Front", name: "Above Fridge Doors", h: 476, w: 447, q: 2, down: ["80"], side: "Mirror" },
      { type: "Front", name: "Wall Cupboard Doors", h: 716, w: 397, q: 2, up: ["100"], down: ["100"], side: "Mirror" },
      { type: "Front", name: "Pantry Doors", h: 2096, w: 297, q: 2, up: ["100", "700", "1300", "1900"], side: "Mirror" },
      { type: "Front", name: "Oven Tower Drawer Fronts", h: 236, w: 597, q: 2 },
      { type: "Panel", name: "Left Hand End Panel", h: 900, w: 600, q: 1 },
      { type: "Panel", name: "Dishwasher End Panel", h: 720, w: 580, q: 1, clash: "1L 1S" },
      { type: "Panel", name: "Fridge Tall Panel", h: 2120, w: 600, q: 1 },
      { type: "Panel", name: "Hob Scriber", h: 720, w: 100, q: 1 },
      { type: "Panel", name: "Corner Pieces", h: 720, w: 100, q: 2, clash: "1L 1S" },
      { type: "Toekick", name: "Toekick - Sink Run", h: 150, w: 2400, q: 1 },
      { type: "Toekick", name: "Toekick - Hob Run", h: 150, w: 1800, q: 1 },
      { type: "Extra", name: "Benchtop Void Carry Pieces", h: 100, w: 700, q: 3 },
    ],
    items: [
      ["Hardware", "110° Soft Close Hinge", 16],
      ["Hardware", "Blind Soft Close Hinge", 1],
      ["Hardware", "Bar Handle 160mm", 18],
      ["Drawers", "Legrabox Drawer", 7],
      ["Drawers", "Legrabox Inner Pot Drawer", 2],
      ["Bins", "40L Double Bin (Door Pull)", 1],
      ["Benchtops", "20mm Engineered Stone (per m)", 4],
      ["Extra Labour", "1 man hour", 8],
    ],
  },
  scullery: {
    parts: [
      { type: "Cabinet", name: "Scullery Sink", h: 720, w: 800, d: 570, q: 1, adj: 1 },
      { type: "Cabinet", name: "Scullery Open Shelving", h: 720, w: 900, d: 350, q: 1, adj: 3 },
      { type: "Front", name: "Scullery Sink Doors", h: 716, w: 397, q: 2, up: ["100"], down: ["100"], side: "Mirror" },
      { type: "Panel", name: "Scullery End Panel", h: 2100, w: 600, q: 1 },
      { type: "Toekick", name: "Toekick - Scullery", h: 150, w: 1700, q: 1 },
      { type: "Extra", name: "Scullery Open Shelf", h: 330, w: 880, q: 3 },
    ],
    items: [
      ["Hardware", "110° Soft Close Hinge", 4],
      ["Hardware", "Bar Handle 160mm", 2],
      ["Benchtops", "Laminate Benchtop (per m)", 2],
    ],
  },
  pantry: {
    parts: [
      { type: "Cabinet", name: "Pantry Base (Pull-outs)", h: 720, w: 900, d: 570, q: 1 },
      { type: "Cabinet", name: "Pantry Shelving Tower", h: 2100, w: 900, d: 400, q: 1, adj: 5 },
      { type: "Front", name: "Pull-out Fronts", h: 346, w: 896, q: 2 },
      { type: "Panel", name: "Pantry End Panel", h: 2100, w: 600, q: 1 },
      { type: "Toekick", name: "Toekick - Pantry", h: 150, w: 900, q: 1 },
      { type: "Extra", name: "Pantry Shelves", h: 380, w: 880, q: 5 },
    ],
    items: [
      ["Drawers", "Legrabox Inner Pot Drawer", 2],
      ["Hardware", "Bar Handle 160mm", 2],
      ["Extra Labour", "1 man hour", 4],
    ],
  },
  laundry: {
    parts: [
      { type: "Cabinet", name: "Tub Cupboard (2 Door)", h: 720, w: 800, d: 570, q: 1, adj: 1 },
      { type: "Cabinet", name: "Tall Linen", h: 2100, w: 600, d: 570, q: 1, adj: 4 },
      { type: "Cabinet", name: "Above Washer", h: 600, w: 700, d: 350, q: 1, kind: "wall", adj: 1 },
      { type: "Front", name: "Tub Cupboard Doors", h: 716, w: 397, q: 2, up: ["100"], down: ["100"], side: "Mirror" },
      { type: "Front", name: "Tall Linen Door", h: 2096, w: 597, q: 1, up: ["100", "700", "1300", "1900"], side: "Left" },
      { type: "Front", name: "Above Washer Doors", h: 596, w: 347, q: 2, down: ["80"], side: "Mirror" },
      { type: "Panel", name: "Laundry End Panel", h: 900, w: 600, q: 1 },
      { type: "Panel", name: "Washer Scriber", h: 720, w: 100, q: 1 },
      { type: "Toekick", name: "Toekick - Laundry", h: 150, w: 1400, q: 1 },
    ],
    items: [
      ["Hardware", "110° Soft Close Hinge", 8],
      ["Hardware", "Bar Handle 160mm", 5],
      ["Benchtops", "Laminate Benchtop (per m)", 2],
    ],
  },
  bathroom: {
    parts: [
      { type: "Cabinet", name: "Vanity (2 Drawer)", h: 450, w: 1200, d: 460, q: 1 },
      { type: "Cabinet", name: "Mirror Cabinet", h: 700, w: 900, d: 150, q: 1, kind: "wall", adj: 2 },
      { type: "Front", name: "Vanity Drawer Fronts", h: 221, w: 1196, q: 2 },
      { type: "Front", name: "Mirror Cabinet Doors", h: 696, w: 447, q: 2, up: ["100"], down: ["100"], side: "Mirror" },
      { type: "Panel", name: "Vanity Side Panel", h: 460, w: 450, q: 2, clash: "1L 1S" },
      { type: "Extra", name: "Vanity Rail", h: 100, w: 1160, q: 2 },
    ],
    items: [
      ["Drawers", "Legrabox Drawer", 2],
      ["Hardware", "Tip-On Push Latch", 2],
      ["Hardware", "110° Soft Close Hinge", 4],
    ],
  },
  wardrobe: {
    parts: [
      { type: "Cabinet", name: "Hanging Tower", h: 2100, w: 900, d: 580, q: 1, fixed: 1 },
      { type: "Cabinet", name: "Drawer Tower (4 Drawer)", h: 2100, w: 600, d: 580, q: 1, adj: 3 },
      { type: "Cabinet", name: "Shoe Shelves", h: 2100, w: 450, d: 350, q: 1, adj: 6 },
      { type: "Front", name: "Drawer Tower Fronts", h: 196, w: 596, q: 4 },
      { type: "Panel", name: "Wardrobe End Panel", h: 2100, w: 600, q: 2 },
      { type: "Extra", name: "Hanging Rail Support", h: 100, w: 560, q: 2 },
      { type: "Extra", name: "Top Shelf", h: 560, w: 880, q: 1 },
    ],
    items: [
      ["Drawers", "Legrabox Drawer", 4],
      ["Hardware", "Wardrobe Hanging Rail (per m)", 2],
      ["Hardware", "Bar Handle 160mm", 4],
    ],
  },
  living: {
    parts: [
      { type: "Cabinet", name: "TV Unit (2 Drawer)", h: 450, w: 1800, d: 450, q: 1 },
      { type: "Cabinet", name: "Open Shelf Left", h: 1200, w: 450, d: 300, q: 1, kind: "wall", adj: 3 },
      { type: "Cabinet", name: "Open Shelf Right", h: 1200, w: 450, d: 300, q: 1, kind: "wall", adj: 3 },
      { type: "Front", name: "TV Unit Drawer Fronts", h: 221, w: 896, q: 4 },
      { type: "Panel", name: "TV Unit End Panel", h: 450, w: 450, q: 2, clash: "1L 1S" },
      { type: "Extra", name: "Floating Shelf", h: 250, w: 1200, q: 3 },
    ],
    items: [
      ["Drawers", "Legrabox Drawer", 4],
      ["Hardware", "Tip-On Push Latch", 4],
    ],
  },
  reception: {
    parts: [
      { type: "Cabinet", name: "Reception Pedestal (3 Drawer)", h: 720, w: 450, d: 570, q: 1 },
      { type: "Front", name: "Pedestal Drawer Fronts", h: 236, w: 446, q: 3 },
      { type: "Panel", name: "Reception Desk Front Panel", h: 1100, w: 2400, q: 1 },
      { type: "Panel", name: "Reception Desk Ends", h: 1100, w: 700, q: 2 },
      { type: "Extra", name: "Desk Top", h: 700, w: 2400, q: 1 },
    ],
    items: [
      ["Drawers", "Legrabox Drawer", 3],
      ["Hardware", "Bar Handle 160mm", 3],
      ["Extra Labour", "1 man hour", 6],
    ],
  },
  kitchenette: {
    parts: [
      { type: "Cabinet", name: "Kitchenette Sink", h: 720, w: 900, d: 570, q: 1, adj: 1 },
      { type: "Cabinet", name: "Kitchenette Wall Cupboard", h: 720, w: 900, d: 300, q: 1, kind: "wall", adj: 2 },
      { type: "Front", name: "Kitchenette Sink Doors", h: 716, w: 447, q: 2, up: ["100"], down: ["100"], side: "Mirror" },
      { type: "Front", name: "Kitchenette Wall Doors", h: 716, w: 447, q: 2, up: ["100"], down: ["100"], side: "Mirror" },
      { type: "Toekick", name: "Toekick - Kitchenette", h: 150, w: 900, q: 1 },
    ],
    items: [
      ["Hardware", "110° Soft Close Hinge", 8],
      ["Hardware", "Bar Handle 160mm", 4],
      ["Benchtops", "Laminate Benchtop (per m)", 1],
    ],
  },
};

// Fronts and panels in the job's front board; carcasses, kicks and extras in its carcass board.
function boardFor(job: Job, part: PartSpec): number {
  return part.type === "Front" || part.type === "Panel" ? (job.boards[1] ?? job.boards[0]) : job.boards[0];
}

function cutlistRow(job: Job, room: string, part: PartSpec, index: number, which: "initialMeasure" | "production") {
  const board = boardFor(job, part);
  // An initial measure is the rougher on-site one: round numbers, a touch over.
  const measure = (value: number) => (which === "initialMeasure" ? Math.ceil((value + 4) / 10) * 10 : value);
  return {
    __id: index + 1,
    __cutlist_key: `${job.id}_${which}_${index + 1}`,
    Room: room,
    partType: part.type,
    Board: boardKey(board),
    Name: part.name,
    doorMode: "manual",
    doorFrontCount: "",
    doorTopGap: "",
    doorBetweenGap: "",
    doorSideLeft: "panel",
    doorSideRight: "panel",
    doorSideLeftGap: "",
    doorSideRightGap: "",
    doorFrontWidths: [],
    doorFrontWidthManual: [],
    doorFrontHeights: [],
    doorFrontHeightManual: [],
    Height: String(measure(part.h)),
    Width: String(measure(part.w)),
    Depth: part.d ? String(part.d) : "",
    Quantity: String(part.q),
    Clashing: part.clash ?? (part.type === "Front" ? "2L 2S" : part.type === "Panel" ? "1L" : part.type === "Toekick" ? "1S" : ""),
    fixedShelf: part.fixed ? String(part.fixed) : "",
    adjustableShelf: part.adj ? String(part.adj) : "",
    fixedShelfDrilling: "No",
    adjustableShelfDrilling: part.adj ? "Centre" : "No",
    cabinetryKind: part.type === "Cabinet" ? (part.kind ?? "base") : "",
    cabinetryClashBottom: "",
    cabinetryClashBottomManual: false,
    cabinetryFullTop: false,
    hingesUp: part.up ?? [],
    hingesDown: part.down ?? [],
    hingeSide: part.side ?? "",
    Information: part.info ?? "",
    Grain: BOARDS[board].grain && (part.type === "Front" || part.type === "Panel") ? "L" : "",
    includeInNesting: true,
    parentName: "",
  };
}

// The production cutlist: every part. The initial measure: just the fronts and panels, as measured.
function cutlistRows(job: Job, which: "initialMeasure" | "production") {
  const rows: Array<ReturnType<typeof cutlistRow>> = [];
  for (const room of job.rooms) {
    for (const part of ROOM_TEMPLATES[room.template].parts) {
      if (which === "initialMeasure" && part.type !== "Front" && part.type !== "Panel") continue;
      rows.push(cutlistRow(job, room.name, part, rows.length, which));
    }
  }
  return rows;
}

// Same as the project page's own slugifySalesItemsValue (projects/[projectId]/page.tsx), so the rooms'
// items match the catalogue.
function itemSlug(value: string): string {
  return value.trim().toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "") || "item";
}

function money(value: number): string {
  return `$${value.toLocaleString("en-NZ", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function salesRooms(job: Job) {
  return job.rooms.map((room, index) => {
    let total = 0;
    const items = ROOM_TEMPLATES[room.template].items.map(([categoryName, itemName, quantity]) => {
      const category = ITEM_CATEGORIES.find((row) => row.name === categoryName);
      const price = Number(category?.items.find((row) => row.name === itemName)?.price ?? 0);
      const categoryId = `cat_${itemSlug(categoryName)}`;
      total += price * quantity;
      return {
        itemId: `${categoryId}__${itemSlug(itemName)}`,
        name: itemName,
        categoryId,
        categoryName,
        categoryColor: category?.color ?? "#7D99B3",
        price: money(price),
        quantity,
      };
    });
    return { id: `room_${job.id}_${index + 1}`, name: room.name, included: true, totalPrice: money(total), items };
  });
}

function slug(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, ".").replace(/^\.|\.$/g, "");
}

// Everything in the preview happens this month, whenever it's opened: times "ago" are squeezed in
// between the 1st and now when they'd reach back further.
function fitToMonth(agoMs: number[], nowMs: number, monthStartMs: number): (ago: number) => number {
  const room = Math.max(0, (nowMs - monthStartMs) * 0.95);
  const longest = Math.max(1, ...agoMs);
  const scale = longest > room ? room / longest : 1;
  return (ago) => Math.round(nowMs - ago * scale);
}

// An event's day: this week's Monday + dayOffset, moved a week at a time until it's in this month.
function eventDay(now: Date, dayOffset: number): Date {
  const day = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  day.setDate(day.getDate() - ((day.getDay() + 6) % 7) + dayOffset);
  while (day.getMonth() !== now.getMonth() || day.getFullYear() !== now.getFullYear()) {
    const before = day.getTime() < now.getTime();
    day.setDate(day.getDate() + (before ? 7 : -7));
  }
  return day;
}

function at(day: Date, hour: number, minute = 0): number {
  const date = new Date(day);
  date.setHours(hour, minute, 0, 0);
  return date.getTime();
}

async function currentVersion(): Promise<string> {
  try {
    const res = await fetch("/release-notes.txt", { cache: "no-store" });
    return res.ok ? parseUpdateNotesText(await res.text()).version.trim() : "";
  } catch {
    return "";
  }
}

export async function seedPreviewDatabase(db: Firestore): Promise<void> {
  const nowMs = Date.now();
  const now = new Date(nowMs);
  const monthStartMs = new Date(now.getFullYear(), now.getMonth(), 1).getTime();
  const iso = (ms: number) => new Date(ms).toISOString();
  const DAY = 86_400_000;
  // When things happened, all within this month (see fitToMonth).
  const jobTime = fitToMonth(JOBS.map((job) => job.createdDaysAgo * DAY), nowMs, monthStartMs);
  const daysAgo = fitToMonth([90 * DAY], nowMs, monthStartMs);
  const version = await currentVersion();
  const seenVersions = version ? [version] : [];
  const writes: Array<[string, Record<string, unknown>]> = [];
  const put = (path: string, data: Record<string, unknown>) => writes.push([path, data]);
  const company = `companies/${PREVIEW_COMPANY_ID}`;

  put(company, {
    id: PREVIEW_COMPANY_ID,
    name: COMPANY_NAME,
    companyName: COMPANY_NAME,
    applicationPreferences: { companyName: COMPANY_NAME },
    ownerUid: PREVIEW_UID,
    ownerId: PREVIEW_UID,
    companyCode: MASTER_CODE,
    joinCode: MASTER_CODE,
    themeColor: "#2F6BFF",
    // The CutSmart banner stands in for the company's logo (top left of the app).
    logoPath: "/cutsmart-banner.svg",
    timeZone: "Pacific/Auckland",
    defaultCurrency: "NZD - New Zealand Dollar",
    measurementUnit: "mm",
    dateFormat: "MMM D, YYYY",
    roles: ROLES,
    staffRoleIdsByUid: Object.fromEntries(TEAM.map((member) => [member.uid, member.roleId])),
    projectStatuses: PROJECT_STATUSES,
    leadStatuses: [
      { id: "new", name: "New", color: "#3060D0" },
      { id: "contacted", name: "Contacted", color: "#C77700" },
      { id: "qualified", name: "Qualified", color: "#6B4FB3" },
      { id: "converted", name: "Converted", color: "#2A7A3B" },
    ],
    dashboardCompleteLegend: [],
    projectArchiveAfter: "never",
    projectTagUsage: {
      tags: [
        { value: "kitchen", count: 5 },
        { value: "laundry", count: 2 },
        { value: "bathroom", count: 2 },
        { value: "vanity", count: 2 },
        { value: "wardrobe", count: 2 },
        { value: "living", count: 1 },
        { value: "commercial", count: 1 },
        { value: "rush", count: 1 },
      ],
    },
    calendarCategories: [
      { id: "installs", name: "Installs", color: "#EAB308" },
      { id: "measures", name: "Measures", color: "#C2410C" },
      { id: "factory", name: "Factory Work", color: "#0F766E" },
      { id: "meetings", name: "Meetings", color: "#7D99B3" },
      { id: "leave", name: "Leave", color: "#334155" },
    ],
    calendarWorkdays: [1, 2, 3, 4, 5],
    calendarShowNonWorkdays: false,
    calendarShowToClientDefault: false,
    contactCategories: [
      { name: "Clients", color: "#C026D3" },
      { name: "Supplier", color: "#DC2626" },
      { name: "Contractor", color: "#16A34A" },
      { name: "Staff", color: "#64748B" },
    ],
    partTypes: PART_TYPES,
    sheetSizes: [
      { h: 2440, w: 1220, isDefault: true },
      { h: 3660, w: 1220, isDefault: false },
    ],
    boardThicknesses: [3, 6, 9, 12, 16, 18, 25, 30],
    boardFinishes: ["Naturale", "Woodgrain", "Matt", "Gloss"],
    boardMaterialUsage: {
      colours: BOARDS.map((board) => ({ value: board.colour, count: 4, edgings: [{ value: "Matching", count: 4 }] })),
    },
    contractors: ["Peak Electrical", "Stoneworks Benchtops", "Clearview Glass"],
    cutlistColumnsByContext: {
      order: ["Board", "Part Name", "Height", "Width", "Depth", "Quantity", "Clashing", "Information", "Grain"],
      production: ["Board", "Part Name", "Height", "Width", "Depth", "Quantity", "Clashing", "Information", "Grain"],
      initialMeasure: ["Board", "Part Name", "Height", "Width", "Depth", "Quantity", "Clashing", "Information", "Grain"],
    },
    nestingSettings: { sheetHeight: 2440, sheetWidth: 1220, kerf: 5, margin: 10, minPieceSize: 100 },
    edgebandingSettings: {
      addToTotalRules: [
        { upToMeters: 50, addMeters: 5 },
        { upToMeters: 100, addMeters: 10 },
      ],
      excessPerEndMm: 75,
      roundEnabled: false,
      roundDirection: "up",
      roundNearestMeters: 0,
    },
    gapAllowancesSettings: {
      baseBelowBenchToTopOfDoorDrawer: "4",
      baseHorizontalGapNormalHandles: "2",
      baseHorizontalGapWrapOverHandles: "3",
      baseVerticalGapDoorsPanels: "2",
      tallTopOfDoorToTopNoScribers: "2",
      tallVerticalGapDoorsPanels: "2",
      tallTopOfDoorToTopWithScribers: "3",
    },
    itemCategories: ITEM_CATEGORIES,
    salesJobTypes: SALES_JOB_TYPES,
    salesQuoteDiscountTiers: [],
    salesAllowReopenForEditing: true,
    salesMinusOffQuoteTotal: false,
    integrations: { zapierLeads: { enabled: false } },
    createdAtIso: iso(monthStartMs),
    updatedAtIso: iso(nowMs),
  });

  for (const member of TEAM) {
    put(`${company}/memberships/${member.uid}`, {
      uid: member.uid,
      email: member.email,
      displayName: member.name,
      role: member.roleId,
      roleId: member.roleId,
      userColor: member.color,
      badgeColor: member.color,
      mobile: member.mobile,
      companyName: COMPANY_NAME,
      ...(member.joinCodeKey ? { joinCodeKey: member.joinCodeKey } : {}),
      ...(member.joinedVia ? { joinedVia: member.joinedVia } : {}),
      updateNoticeSeenVersions: seenVersions,
      createdAtIso: iso(monthStartMs),
      updatedAtIso: iso(nowMs),
    });
  }

  // Invites still waiting to be accepted (Staff > Invited).
  [
    { email: "ben.taylor@example.com", hoursAgo: 5 },
    { email: "hana.reid@example.com", hoursAgo: 30 },
  ].forEach((invite) => {
    const id = invite.email.replace(/[^a-z0-9@._-]+/g, "_");
    put(`${company}/invites/${id}`, {
      id,
      companyId: PREVIEW_COMPANY_ID,
      companyName: COMPANY_NAME,
      email: invite.email,
      emailLower: invite.email,
      status: "pending",
      invitedByUid: PREVIEW_UID,
      invitedByName: PREVIEW_NAME,
      createdAtIso: iso(Math.max(monthStartMs, nowMs - invite.hoursAgo * 3_600_000)),
    });
  });

  put(`users/${PREVIEW_UID}`, {
    email: PREVIEW_EMAIL,
    displayName: PREVIEW_NAME,
    mobile: TEAM[0].mobile,
    userColor: TEAM[0].color,
    companyId: PREVIEW_COMPANY_ID,
    verified: true,
    notifyAsCreator: false,
    updateNoticeSeenVersions: seenVersions,
    updatedAtIso: iso(nowMs),
  });

  put(`${company}/clients/__meta`, { id: "__meta", companyId: PREVIEW_COMPANY_ID, type: "clients-meta", createdAtIso: iso(monthStartMs) });

  JOBS.forEach((job, index) => {
    const createdMs = jobTime(job.createdDaysAgo * DAY);
    const updatedMs = Math.round(createdMs + (nowMs - createdMs) / 2);
    const assignee = TEAM[job.assigned];
    const customer = `${job.first} ${job.last}`;
    const email = `${slug(job.first)}.${slug(job.last)}@example.com`;
    const phone = `021 555 01${String(10 + index)}`;
    const clientId = `prv_client_${String(index + 1).padStart(2, "0")}`;
    const completed = job.status === "Completed";
    const jobPath = `${company}/jobs/${job.id}`;
    put(jobPath, {
      id: job.id,
      companyId: PREVIEW_COMPANY_ID,
      name: job.name,
      customer,
      clientFirstName: job.first,
      clientLastName: job.last,
      clientName: customer,
      client: customer,
      clientNumber: phone,
      clientPhone: phone,
      clientEmail: email,
      clientAddress: job.address,
      clientId,
      notes: job.notes,
      createdByUid: PREVIEW_UID,
      createdByName: PREVIEW_NAME,
      assignedTo: assignee.name,
      assignedToName: assignee.name,
      assignedToUid: assignee.uid,
      createdAtIso: iso(createdMs),
      updatedAtIso: iso(updatedMs),
      createdAt: Timestamp.fromMillis(createdMs),
      updatedAt: Timestamp.fromMillis(updatedMs),
      status: job.status,
      ...(job.subStage ? { dashboardSubStageId: job.subStage } : {}),
      dashboardBoardOrder: index,
      tags: job.tags,
      isDeleted: false,
      isArchived: false,
      ...(completed ? { completedAtIso: iso(updatedMs), completedAt: Timestamp.fromMillis(updatedMs) } : {}),
      projectSettings: {
        boardTypes: job.boards.map((boardIndex) => ({ ...BOARDS[boardIndex], sheets: String(2 + boardIndex * 2) })),
        projectPermissions: {},
        hardwareCategory: "",
        carcassThickness: "16",
        panelThickness: "18",
        frontsThickness: "18",
        baseCabHeight: "720",
        tallCabHeight: "2100",
        standardHandles: true,
        wrapOverHandles: false,
        topScribers: false,
      },
      sales: {
        rooms: salesRooms(job),
        quoteExtrasIncluded: [],
        products: SALES_JOB_TYPES.map((type) => ({
          name: type.name,
          selected: type.type === "grain" ? job.boards.some((board) => BOARDS[board].grain) : type.type === "melteca",
        })),
      },
    });
    put(`${jobPath}/projectMedia/images`, { projectImages: [], projectImageItems: [], updatedAtIso: iso(updatedMs) });
    put(`${jobPath}/projectMedia/files`, { projectFiles: [], updatedAtIso: iso(updatedMs) });
    put(`${jobPath}/cutlistData/initialMeasure`, {
      rows: cutlistRows(job, "initialMeasure"),
      updatedAtIso: iso(updatedMs),
    });
    put(`${jobPath}/cutlistData/production`, {
      rows: job.status === "Production" || job.status === "Completed" ? cutlistRows(job, "production") : [],
      updatedAtIso: iso(updatedMs),
    });
    const history = {
      projectId: job.id,
      projectName: job.name,
      createdAtIso: iso(createdMs),
      updatedAtIso: iso(updatedMs),
      statusLabel: job.status,
      customer,
      clientEmail: email,
      clientPhone: phone,
      clientAddress: job.address,
      archived: false,
      deleted: false,
    };
    put(`${company}/clients/${clientId}`, {
      id: clientId,
      companyId: PREVIEW_COMPANY_ID,
      name: customer,
      email,
      emailNormalized: email,
      phone,
      address: job.address,
      notes: "",
      category: "Clients",
      archived: false,
      createdAtIso: iso(createdMs),
      updatedAtIso: iso(updatedMs),
      firstProjectAtIso: iso(createdMs),
      lastProjectAtIso: iso(createdMs),
      lastProjectId: job.id,
      projectCount: 1,
      createdByUids: [PREVIEW_UID],
      assignedToUids: [assignee.uid],
      completedProjectIds: completed ? [job.id] : [],
      history: [history],
    });
  });

  const otherContacts = [
    { id: "prv_contact_supplier", name: "Timber & Board Supplies", email: "orders@example.com", phone: "07 555 0190", category: "Supplier", notes: "Board orders by 2pm for next-day delivery." },
    { id: "prv_contact_stone", name: "Stoneworks Benchtops", email: "hello@example.com", phone: "07 555 0191", category: "Contractor", notes: "Template visits Tuesdays and Thursdays." },
    { id: "prv_contact_electric", name: "Peak Electrical", email: "jobs@example.com", phone: "021 555 0192", category: "Contractor", notes: "" },
  ];
  for (const contact of otherContacts) {
    put(`${company}/clients/${contact.id}`, {
      ...contact,
      companyId: PREVIEW_COMPANY_ID,
      emailNormalized: contact.email,
      address: "",
      archived: false,
      createdAtIso: iso(monthStartMs),
      updatedAtIso: iso(daysAgo(10 * DAY)),
      projectCount: 0,
      createdByUids: [PREVIEW_UID],
      assignedToUids: [],
      completedProjectIds: [],
      history: [],
    });
  }

  const events = [
    { title: "Site measure — Smith Kitchen", categoryId: "measures", day: 0, from: [9, 0], to: [10, 30], job: "prv_job_06", location: "5 Totara Avenue, Hamilton East" },
    { title: "Design meeting — Bayview Vanity", categoryId: "meetings", day: 0, from: [13, 0], to: [14, 0], job: "prv_job_03", location: "Showroom" },
    { title: "Dryfit — Henderson Laundry", categoryId: "factory", day: 1, from: [8, 0], to: [12, 0], job: "prv_job_07", location: "Workshop" },
    { title: "Install — Patel Kitchen", categoryId: "installs", day: 2, allDay: true, job: "prv_job_08", location: "140 Great South Road, Takanini" },
    { title: "Install — Patel Kitchen (day 2)", categoryId: "installs", day: 3, allDay: true, job: "prv_job_08", location: "140 Great South Road, Takanini" },
    { title: "Benchtop template", categoryId: "measures", day: 3, from: [14, 0], to: [15, 0], job: "prv_job_08", location: "140 Great South Road, Takanini" },
    { title: "Deliver — Harper Vanity", categoryId: "installs", day: 4, from: [10, 0], to: [11, 30], job: "prv_job_10", location: "3 Rimu Lane, Raglan" },
    { title: "Team catch-up", categoryId: "meetings", day: 4, from: [15, 30], to: [16, 0] },
    { title: "Reception desk build", categoryId: "factory", day: 7, from: [8, 0], to: [16, 0], job: "prv_job_09", location: "Workshop" },
    { title: "Sophie — annual leave", categoryId: "leave", day: 8, allDay: true },
  ];
  events.forEach((event, index) => {
    const job = JOBS.find((row) => row.id === event.job);
    const day = eventDay(now, event.day);
    const startMs = event.allDay ? at(day, 0) : at(day, event.from![0], event.from![1]);
    const endMs = event.allDay ? at(day, 24) : at(day, event.to![0], event.to![1]);
    const id = `prv_event_${String(index + 1).padStart(2, "0")}`;
    put(`${company}/calendarEvents/${id}`, {
      id,
      companyId: PREVIEW_COMPANY_ID,
      title: event.title,
      categoryId: event.categoryId,
      allDay: Boolean(event.allDay),
      startMs,
      endMs,
      location: event.location ?? "",
      notes: "",
      projectId: job?.id ?? "",
      projectName: job?.name ?? "",
      createdByUid: PREVIEW_UID,
      createdByName: PREVIEW_NAME,
      showToClient: false,
      updatedAtIso: iso(daysAgo(3 * DAY)),
    });
  });

  const notifications = [
    { title: "Quote accepted", message: "Hannah Brooks accepted the quote for Ridgeway Entertainment Unit.", type: "quote_accepted", job: "prv_job_05", minutesAgo: 35 },
    { title: "New lead", message: "Aroha Williams sent an enquiry about a kitchen.", type: "lead_new", job: "", minutesAgo: 90 },
    { title: "Specs submitted", message: "Priya Shah filled in the specs for Bayview Vanity.", type: "specs_submitted", job: "prv_job_03", minutesAgo: 60 * 5 },
    { title: "Project assigned", message: "Mere assigned you to Marsden Wardrobe.", type: "project_assigned", job: "prv_job_12", minutesAgo: 60 * 26 },
  ];
  const noteTime = fitToMonth(notifications.map((note) => note.minutesAgo * 60_000), nowMs, monthStartMs);
  notifications.forEach((note, index) => {
    const ms = noteTime(note.minutesAgo * 60_000);
    put(`users/${PREVIEW_UID}/notifications/prv_note_${index + 1}`, {
      title: note.title,
      message: note.message,
      type: note.type,
      read: index > 1,
      createdAt: Timestamp.fromMillis(ms),
      createdAtIso: iso(ms),
      projectId: note.job,
      companyId: PREVIEW_COMPANY_ID,
    });
  });

  for (const [path, data] of writes) {
    void setDoc(doc(db, path), data);
  }

  // Leads come from the server for real companies; in the preview they're the Leads page's own local
  // rows (kept in the preview's in-memory storage — lib/preview-runtime.ts).
  const leadRows = [
    { name: "Aroha Williams", message: "Looking to redo our kitchen — keen on oak fronts and a scullery.", status: "New", hoursAgo: 2, suburb: "Ponsonby" },
    { name: "Rawiri Ngata", message: "Need a quote for built-in wardrobes in two bedrooms.", status: "New", hoursAgo: 20, suburb: "Hillcrest" },
    { name: "Emma Davies", message: "Bathroom vanity, 900 wide, wall hung. Can you do stone tops?", status: "Contacted", hoursAgo: 50, suburb: "Cambridge" },
    { name: "Noah Thompson", message: "Laundry cabinetry for a new build, plans attached.", status: "Qualified", hoursAgo: 96, suburb: "Rototuna" },
    { name: "Ella Robinson", message: "Entertainment unit with floating shelves.", status: "Converted", hoursAgo: 200, suburb: "Tauranga" },
  ];
  const leadTime = fitToMonth(leadRows.map((lead) => lead.hoursAgo * 3_600_000), nowMs, monthStartMs);
  const leads = leadRows.map((lead, index) => {
    const createdIso = iso(leadTime(lead.hoursAgo * 3_600_000));
    const email = `${slug(lead.name)}@example.com`;
    const phone = `022 555 02${String(10 + index)}`;
    return {
      id: `temporary-sample-lead-${index + 1}`,
      companyId: PREVIEW_COMPANY_ID,
      name: lead.name,
      email,
      phone,
      message: lead.message,
      formName: "Website enquiry",
      submittedAtIso: createdIso,
      createdAtIso: createdIso,
      updatedAtIso: createdIso,
      source: "local-sample",
      status: lead.status,
      assignedToUid: TEAM[1].uid,
      assignedToName: TEAM[1].name,
      assignedTo: TEAM[1].name,
      imageItems: [],
      imageUrls: [],
      rawFields: { FullName: lead.name, Email: email, Phone: phone, Suburb: lead.suburb, Message: lead.message },
    };
  });
  try {
    window.localStorage.setItem(SAMPLE_LEADS_STORAGE_KEY, JSON.stringify(leads));
    window.localStorage.setItem("cutsmart_active_company_id", PREVIEW_COMPANY_ID);
  } catch {
    // storage unavailable — the Leads page starts empty
  }
}
