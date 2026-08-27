function toFirebaseStorageCode(error: unknown): string {
  if (!error || typeof error !== "object" || !("code" in error)) return "";
  return String((error as { code?: unknown }).code ?? "").trim().toLowerCase();
}

function toFirebaseStorageMessage(error: unknown): string {
  if (!error || typeof error !== "object" || !("message" in error)) return "";
  return String((error as { message?: unknown }).message ?? "").trim().toLowerCase();
}

export function isFirebaseStorageQuotaExceeded(error: unknown): boolean {
  const code = toFirebaseStorageCode(error);
  if (code === "storage/quota-exceeded") return true;
  const message = toFirebaseStorageMessage(error);
  return message.includes("storage/quota-exceeded") || message.includes("quota for bucket");
}

export function getFirebaseStorageQuotaExceededMessage(subject: string): string {
  const cleanSubject = String(subject || "files").trim() || "files";
  return `Firebase Storage quota exceeded. ${cleanSubject} could not be uploaded. Remove some stored files or upgrade the storage plan, then try again.`;
}
