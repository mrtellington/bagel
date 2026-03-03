import { invokeAgent } from "../agent/agent.js";
import { getPendingActionItems } from "../agent/tools/supabase.js";
import { DateTime } from "luxon";
import { config } from "../config.js";

export async function checkNudges() {
  const pendingItems = await getPendingActionItems();
  if (pendingItems.length === 0) return;

  const now = DateTime.now().setZone(config.timezone);

  // Group items by meeting
  const byMeeting = new Map<string, typeof pendingItems>();
  for (const item of pendingItems) {
    const meetingId = item.meeting_id;
    if (!byMeeting.has(meetingId)) byMeeting.set(meetingId, []);
    byMeeting.get(meetingId)!.push(item);
  }

  // Check which meetings need nudging
  const needsNudge: Array<{
    meetingTitle: string;
    itemCount: number;
    hoursSincePost: number;
    slackThreadTs: string;
    nudgeCount: number;
  }> = [];

  for (const [, items] of byMeeting) {
    const meeting = (items[0] as any).meetings;
    if (!meeting?.slack_message_ts) continue;

    const oldestItem = items[0];
    const createdAt = DateTime.fromISO(oldestItem.created_at).setZone(config.timezone);
    const hoursSince = now.diff(createdAt, "hours").hours;

    const maxNudgeCount = Math.max(...items.map((i) => i.nudge_count ?? 0));

    // Nudge at 1 hour, then every 3 hours after
    const shouldNudge =
      (maxNudgeCount === 0 && hoursSince >= 1) ||
      (maxNudgeCount > 0 && hoursSince >= 1 + maxNudgeCount * 3);

    if (shouldNudge) {
      needsNudge.push({
        meetingTitle: meeting.title,
        itemCount: items.length,
        hoursSincePost: Math.round(hoursSince),
        slackThreadTs: meeting.slack_message_ts,
        nudgeCount: maxNudgeCount,
      });
    }
  }

  if (needsNudge.length === 0) return;

  const prompt = `Time to nudge Tod about unaddressed action items.

## Pending items:
${needsNudge.map((n) => `- "${n.meetingTitle}": ${n.itemCount} items, ${n.hoursSincePost}h since posted, nudged ${n.nudgeCount} times`).join("\n")}

## Your tasks:
1. First, check if Tod is currently in a meeting (calendar_is_in_meeting)
2. If he IS in a meeting, find the next gap (calendar_next_gap) and skip this nudge
3. If he is NOT in a meeting, send a nudge via slack_post_message (NOT in a thread — direct message)
4. Tone: ${needsNudge.some((n) => n.nudgeCount >= 2) ? "Firmer — these items have been waiting. Mention the risk of things slipping." : "Gentle — just a reminder. Keep it brief."}
5. Include meeting names and item counts
6. If there's a gap before his next meeting, mention it: "You've got X minutes before your next meeting"

After nudging, update each pending item's nudge_count and last_nudge_at via db_update_action_item.`;

  try {
    await invokeAgent(prompt);
    console.log(`[nudge] Sent nudge for ${needsNudge.length} meetings`);
  } catch (err) {
    console.error(`[nudge] Error:`, err);
  }
}
