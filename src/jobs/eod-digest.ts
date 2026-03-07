import { invokeAgent } from "../agent/agent.js";
import { supabase } from "../agent/tools/supabase.js";
import { DateTime } from "luxon";
import { config } from "../config.js";

export async function eodDigest() {
  const today = DateTime.now().setZone(config.timezone).toISODate();

  // Get today's processed meetings
  const { data: todayMeetings } = await supabase
    .from("meetings")
    .select("id, title")
    .gte("event_datetime", `${today}T00:00:00`)
    .lte("event_datetime", `${today}T23:59:59`);

  // Get all action items from today's meetings
  const meetingIds = (todayMeetings ?? []).map((m) => m.id);
  const { data: todayItems } = await supabase
    .from("action_items")
    .select("*")
    .in("meeting_id", meetingIds.length > 0 ? meetingIds : ["none"]);

  // Get items still pending from any day
  const { data: allPending } = await supabase
    .from("action_items")
    .select("*, meetings(title)")
    .eq("status", "pending_review");

  const triaged = (todayItems ?? []).filter((i) => i.status !== "pending_review");
  const pending = allPending ?? [];

  const prompt = `It's end of day. Send the EOD digest via slack_post_message.

## Today's stats:
- Meetings today: ${todayMeetings?.length ?? 0}
- Action items extracted today: ${todayItems?.length ?? 0}
- Items triaged today: ${triaged.length}
- Items still open (all time): ${pending.length}

## Open items:
${pending.map((item) => `- [${(item as any).meetings?.title}] ${item.description}`).join("\n") || "None!"}

## Your tasks:
1. Post a concise EOD summary to Slack
2. If there are open items, note they'll carry to tomorrow's morning briefing
3. Tone: Wrap-up, not urgent. Acknowledge what was accomplished.
4. If all items are triaged, celebrate briefly`;

  try {
    await invokeAgent(prompt);
    console.log("[eod-digest] Sent");
  } catch (err) {
    console.error("[eod-digest] Error:", err);
  }
}
