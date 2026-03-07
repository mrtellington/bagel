import { invokeAgent } from "../agent/agent.js";
import { getPendingActionItems } from "../agent/tools/supabase.js";

export async function morningBriefing() {
  const pendingItems = await getPendingActionItems();

  const prompt = `It's morning. Send the daily briefing via slack_post_message.

## Carry-forward items from previous days:
${pendingItems.length > 0
    ? pendingItems
        .map((item) => `- [${(item as any).meetings?.title}] ${item.description}`)
        .join("\n")
    : "None — all caught up!"}

## Your tasks:
1. Get today's calendar (calendar_get_today_events)
2. Identify triage gaps — windows between meetings where items could be triaged
3. Post a morning briefing to Slack with:
   - Carry-forward open items (grouped by meeting)
   - Today's meeting schedule
   - Suggested triage windows
   - Brief, energizing tone — "Good morning" not "URGENT"
4. If there are carry-forward items, remind that replying in the original threads or saying "own all" will sweep them`;

  try {
    await invokeAgent(prompt);
    console.log("[morning-briefing] Sent");
  } catch (err) {
    console.error("[morning-briefing] Error:", err);
  }
}
