// The Firestore functions the app's client code uses — the SDK's own, except while in CutSmart Preview
// (lib/preview-mode.ts). There the database is an offline copy in memory (lib/firebase.ts), which
// changes the moment something is written but never hears back from a server — so here, writes count
// as done straight away instead of waiting forever, and reads come from that copy, with a document it
// doesn't have reading as "doesn't exist" (offline, the SDK would otherwise fail the read).

import {
  deleteDoc as sdkDeleteDoc,
  getDoc as sdkGetDoc,
  getDocFromCache,
  getDocs as sdkGetDocs,
  getDocsFromCache,
  setDoc as sdkSetDoc,
  updateDoc as sdkUpdateDoc,
  writeBatch as sdkWriteBatch,
  type DocumentReference,
  type DocumentSnapshot,
  type Firestore,
  type Query,
} from "firebase/firestore";
import { isPreviewMode } from "@/lib/preview-mode";

export * from "firebase/firestore";

const OFFLINE_PREVIEW = isPreviewMode();

function doneNow<T>(write: Promise<T>): Promise<T> {
  if (!OFFLINE_PREVIEW) return write;
  write.catch(() => undefined);
  return Promise.resolve(undefined as T);
}

function missingSnapshot(ref: DocumentReference): DocumentSnapshot {
  return {
    id: ref.id,
    ref,
    exists: () => false,
    data: () => undefined,
    get: () => undefined,
    metadata: { fromCache: true, hasPendingWrites: false, isEqual: () => false },
    toJSON: () => ({}),
  } as unknown as DocumentSnapshot;
}

type AnyWrite = (...args: unknown[]) => Promise<void>;

export const setDoc = ((...args: unknown[]) => doneNow((sdkSetDoc as AnyWrite)(...args))) as typeof sdkSetDoc;

export const updateDoc = ((...args: unknown[]) => doneNow((sdkUpdateDoc as AnyWrite)(...args))) as typeof sdkUpdateDoc;

export const deleteDoc = ((ref: DocumentReference) => doneNow(sdkDeleteDoc(ref))) as typeof sdkDeleteDoc;

export const writeBatch = ((firestore: Firestore) => {
  const batch = sdkWriteBatch(firestore);
  if (!OFFLINE_PREVIEW) return batch;
  const commit = batch.commit.bind(batch);
  batch.commit = () => doneNow(commit());
  return batch;
}) as typeof sdkWriteBatch;

export const getDoc = ((ref: DocumentReference) =>
  OFFLINE_PREVIEW ? getDocFromCache(ref).catch(() => missingSnapshot(ref)) : sdkGetDoc(ref)) as typeof sdkGetDoc;

export const getDocs = ((query: Query) => (OFFLINE_PREVIEW ? getDocsFromCache(query) : sdkGetDocs(query))) as typeof sdkGetDocs;
