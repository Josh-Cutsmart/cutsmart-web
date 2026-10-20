// Who accepted a quote, or submitted the specifications: the client themselves ("Accepted by Anil Patel"), or staff
// for them ("Accepted on behalf of Anil Patel by Alex Morgan" — app/api/specs-share/[shareId]/on-behalf). The staff
// page, its version history and the client's own portal all say it the same way.
export function actedByLabel(verb: string, clientName: string | null | undefined, onBehalfByName?: string | null, fallback = "client"): string {
  const client = String(clientName ?? "").trim();
  const staff = String(onBehalfByName ?? "").trim();
  return staff ? `${verb} on behalf of ${client || "the client"} by ${staff}` : `${verb} by ${client || fallback}`;
}
