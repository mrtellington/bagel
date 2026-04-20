import { google } from "googleapis";
import { config } from "../../config.js";
import { DateTime } from "luxon";

function getCalendarClient() {
  if (!config.googleCalendarSaKeyBase64) {
    return null;
  }
  const keyJson = JSON.parse(
    Buffer.from(config.googleCalendarSaKeyBase64, "base64").toString()
  );
  const auth = new google.auth.GoogleAuth({
    credentials: keyJson,
    scopes: ["https://www.googleapis.com/auth/calendar.readonly"],
  });
  return google.calendar({ version: "v3", auth });
}

const calendarClient = getCalendarClient();

// Tod's calendar ID — typically the primary email
const CALENDAR_ID = config.todAsanaEmail;

export async function getEventsInRange(startIso: string, endIso: string) {
  if (!calendarClient) return [];

  const res = await calendarClient.events.list({
    calendarId: CALENDAR_ID,
    timeMin: startIso,
    timeMax: endIso,
    singleEvents: true,
    orderBy: "startTime",
  });

  return (res.data.items ?? []).map((e) => ({
    id: e.id,
    summary: e.summary,
    start: e.start?.dateTime ?? e.start?.date,
    end: e.end?.dateTime ?? e.end?.date,
    attendees: (e.attendees ?? []).map((a) => ({
      email: a.email,
      name: a.displayName,
      responseStatus: a.responseStatus,
    })),
  }));
}

export async function getTodayEvents() {
  const now = DateTime.now().setZone(config.timezone);
  return getEventsInRange(now.startOf("day").toISO()!, now.endOf("day").toISO()!);
}

export async function getEventsForDate(dateStr: string) {
  // dateStr: "YYYY-MM-DD" in Tod's timezone; supports "monday", "tomorrow" via agent-side resolution.
  const day = DateTime.fromISO(dateStr, { zone: config.timezone });
  if (!day.isValid) {
    throw new Error(`Invalid date: ${dateStr} (${day.invalidReason})`);
  }
  return getEventsInRange(day.startOf("day").toISO()!, day.endOf("day").toISO()!);
}

export async function isInMeeting(): Promise<boolean> {
  if (!calendarClient) return false;
  const now = DateTime.now().setZone(config.timezone);
  const events = await getTodayEvents();
  return events.some((e) => {
    const start = DateTime.fromISO(e.start!).setZone(config.timezone);
    const end = DateTime.fromISO(e.end!).setZone(config.timezone);
    return now >= start && now <= end;
  });
}

export async function getNextGap(minMinutes: number = 15) {
  if (!calendarClient) return null;
  const now = DateTime.now().setZone(config.timezone);
  const events = await getTodayEvents();

  // Filter to future events
  const upcoming = events.filter(
    (e) => DateTime.fromISO(e.end!).setZone(config.timezone) > now
  );

  if (upcoming.length === 0) {
    return { start: now.toISO(), duration: "rest of day" };
  }

  // Check gap between now and first upcoming event
  const firstStart = DateTime.fromISO(upcoming[0].start!).setZone(config.timezone);
  if (firstStart > now) {
    const gapMinutes = firstStart.diff(now, "minutes").minutes;
    if (gapMinutes >= minMinutes) {
      return {
        start: now.toISO(),
        duration: `${Math.round(gapMinutes)} minutes`,
        beforeMeeting: upcoming[0].summary,
      };
    }
  }

  // Check gaps between events
  for (let i = 0; i < upcoming.length - 1; i++) {
    const gapStart = DateTime.fromISO(upcoming[i].end!).setZone(config.timezone);
    const gapEnd = DateTime.fromISO(upcoming[i + 1].start!).setZone(config.timezone);
    const gapMinutes = gapEnd.diff(gapStart, "minutes").minutes;
    if (gapMinutes >= minMinutes && gapStart > now) {
      return {
        start: gapStart.toISO(),
        duration: `${Math.round(gapMinutes)} minutes`,
        beforeMeeting: upcoming[i + 1].summary,
      };
    }
  }

  return null;
}
