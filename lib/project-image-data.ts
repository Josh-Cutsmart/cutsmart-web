import { getDownloadURL, ref as storageRef } from "firebase/storage";
import { storage } from "@/lib/firebase";

// Turning a project's stored image paths into usable URLs / data URLs. Kept in their own small module
// (not lib/specs-grid-pdf.ts, where they started) because the project page needs them on every project
// load, and that module brings the whole PDF toolkit (jsPDF, autotable, html-to-image) with it.

export async function blobToDataUrl(blob: Blob): Promise<string> {
  return await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ""));
    reader.onerror = () => reject(reader.error ?? new Error("Failed to read blob."));
    reader.readAsDataURL(blob);
  });
}

export async function resolveProjectImageUrl(raw: string): Promise<string> {
  const value = String(raw || "").trim();
  if (!value) return "";
  if (/^https?:\/\//i.test(value)) return value;
  const storageClient = storage;
  if (!storageClient) return "";
  const normalized = value.replace(/^\/+/, "");
  try {
    return await getDownloadURL(storageRef(storageClient, normalized));
  } catch {
    try {
      return await getDownloadURL(storageRef(storageClient, value));
    } catch {
      return "";
    }
  }
}

export async function resolveProjectImageDataUrl(raw: string): Promise<string> {
  const resolvedUrl =
    (await resolveProjectImageUrl(raw)) ||
    (/^https?:\/\//i.test(String(raw || "").trim()) ? String(raw || "").trim() : "");
  if (!resolvedUrl) return "";
  try {
    const response = await fetch(resolvedUrl, { mode: "cors", credentials: "omit", cache: "force-cache" });
    if (!response.ok) return resolvedUrl;
    const imageBlob = await response.blob();
    return await blobToDataUrl(imageBlob);
  } catch {
    return resolvedUrl;
  }
}
