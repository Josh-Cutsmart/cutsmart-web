// The notifications scheduled job's first address — kept working for a scheduler already set up with it.
// It's the same job as app/api/cron/notifications (calendar reminders and held notification groups).
export { GET } from "@/app/api/cron/notifications/route";

export const maxDuration = 60;
