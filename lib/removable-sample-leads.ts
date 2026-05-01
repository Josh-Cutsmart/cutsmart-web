import type { CompanyLeadRow } from "@/lib/firestore-data";

// Temporary removable sample leads for layout testing.
// Delete this file and its import in app/leads/page.tsx when you no longer need it.

type SampleLeadSpec = {
  name: string;
  email: string;
  phone: string;
  suburb: string;
  cityRegion: string;
  heardAboutUs: string;
  kitchenAge: string;
  upgradeType: string;
  timeline: string;
  notes: string;
};

const SAMPLE_LEAD_SPECS: SampleLeadSpec[] = [
  {
    name: "Ella Thompson",
    email: "ella.thompson@example.com",
    phone: "021 445 120",
    suburb: "Takapuna",
    cityRegion: "Auckland",
    heardAboutUs: "Google Search",
    kitchenAge: "10-15 years",
    upgradeType: "Full kitchen makeover",
    timeline: "1-3 months",
    notes: "Wants a brighter layout, more drawer storage, and integrated bins.",
  },
  {
    name: "Liam Carter",
    email: "liam.carter@example.com",
    phone: "027 884 231",
    suburb: "Albany",
    cityRegion: "Auckland",
    heardAboutUs: "Instagram",
    kitchenAge: "5-10 years",
    upgradeType: "Doors, panels, and benchtop refresh",
    timeline: "3-6 months",
    notes: "Interested in matte finishes and better pantry organization.",
  },
  {
    name: "Mia Reynolds",
    email: "mia.reynolds@example.com",
    phone: "022 903 448",
    suburb: "Orewa",
    cityRegion: "Auckland",
    heardAboutUs: "Referral",
    kitchenAge: "15+ years",
    upgradeType: "Laundry and scullery cabinetry",
    timeline: "As soon as possible",
    notes: "Needs durable cabinetry for a busy family home and pet area.",
  },
];

export function buildTemporarySampleLeads(companyId: string): CompanyLeadRow[] {
  return SAMPLE_LEAD_SPECS.map((sample, idx) => {
    const createdAtIso = new Date(Date.UTC(2026, 4, idx + 1, 8 + idx, 15, 0)).toISOString();
    return {
      id: `temporary-sample-lead-${idx + 1}`,
      companyId,
      name: sample.name,
      email: sample.email,
      phone: sample.phone,
      message: sample.notes,
      formName: "Temporary Sample Lead",
      submittedAtIso: createdAtIso,
      createdAtIso,
      source: "local-sample",
      status: "new",
      rawFields: {
        Name: sample.name,
        Email: sample.email,
        "Daytime Phone": sample.phone,
        Suburb: sample.suburb,
        "City/Region": sample.cityRegion,
        "How did you hear about us?": sample.heardAboutUs,
        "Approximate age of your kitchen?": sample.kitchenAge,
        "How would you like to upgrade your kitchen?": sample.upgradeType,
        "When would you like to upgrade?": sample.timeline,
        "Tell us a little about your kitchen and how we can assist": sample.notes,
      },
    };
  });
}
