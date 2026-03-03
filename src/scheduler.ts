import cron from "node-cron";
import { DateTime } from "luxon";
import { config } from "./config.js";
import { pollMeetings } from "./jobs/poll-meetings.js";
import { pollThreads } from "./jobs/poll-threads.js";
import { checkNudges } from "./jobs/nudge.js";
import { morningBriefing } from "./jobs/morning-briefing.js";
import { eodDigest } from "./jobs/eod-digest.js";

function isBusinessHours(): boolean {
  const now = DateTime.now().setZone(config.timezone);
  const day = now.weekday; // 1=Mon, 7=Sun
  if (day > 5) return false; // Weekend

  const [startH, startM] = config.businessHoursStart.split(":").map(Number);
  const [endH, endM] = config.businessHoursEnd.split(":").map(Number);

  const startMinutes = startH * 60 + startM;
  const endMinutes = endH * 60 + endM;
  const nowMinutes = now.hour * 60 + now.minute;

  return nowMinutes >= startMinutes && nowMinutes <= endMinutes;
}

function guardedJob(name: string, fn: () => Promise<void>) {
  return async () => {
    if (!isBusinessHours()) return;
    console.log(`[scheduler] Running ${name}`);
    try {
      await fn();
    } catch (err) {
      console.error(`[scheduler] ${name} failed:`, err);
    }
  };
}

export function startScheduler() {
  console.log(`[scheduler] Starting (${config.timezone}, ${config.businessHoursStart}-${config.businessHoursEnd} M-F)`);

  // Poll Supabase for new meetings — every 5 minutes
  cron.schedule("*/5 * * * *", guardedJob("poll-meetings", pollMeetings));

  // Poll Slack threads for replies — every 2 minutes
  cron.schedule("*/2 * * * *", guardedJob("poll-threads", pollThreads));

  // Check for items needing nudges — every 30 minutes
  cron.schedule("*/30 * * * *", guardedJob("nudge", checkNudges));

  // Morning briefing — 8:55 AM ET, Monday-Friday
  cron.schedule("55 8 * * 1-5", async () => {
    const now = DateTime.now().setZone(config.timezone);
    if (now.weekday <= 5) {
      console.log("[scheduler] Running morning-briefing");
      try {
        await morningBriefing();
      } catch (err) {
        console.error("[scheduler] morning-briefing failed:", err);
      }
    }
  }, { timezone: config.timezone });

  // EOD digest — 5:45 PM ET, Monday-Friday
  cron.schedule("45 17 * * 1-5", async () => {
    const now = DateTime.now().setZone(config.timezone);
    if (now.weekday <= 5) {
      console.log("[scheduler] Running eod-digest");
      try {
        await eodDigest();
      } catch (err) {
        console.error("[scheduler] eod-digest failed:", err);
      }
    }
  }, { timezone: config.timezone });

  console.log("[scheduler] All jobs scheduled");
}
