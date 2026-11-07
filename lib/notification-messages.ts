import fileText from "@/notification-messages.txt";
import { notificationBook } from "@/lib/notification-messages-core";

// The wording of every notification: notification-messages.txt, built into the app and the server (next.config.ts). Used by
// both, so nothing here can be server- or browser-only.
const book = notificationBook(fileText);

export const notificationText = book.text;
export const notificationWords = book.words;
export const notificationTemplate = book.template;
export const notificationGroupPhrase = book.groupPhrase;
