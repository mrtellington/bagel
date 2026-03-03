import { invokeAgent } from "../agent/agent.js";
import { supabase, isThreadReplyProcessed, markThreadReplyProcessed } from "../agent/tools/supabase.js";
import { getThreadReplies } from "../agent/tools/slack.js";
import { config } from "../config.js";

export async function pollThreads() {
  // Get meetings that have been posted to Slack but still have pending items
  const { data: meetings, error } = await supabase
    .from("meetings")
    .select("id, title, slack_message_ts, slack_channel_id")
    .eq("processed", true)
    .not("slack_message_ts", "is", null);

  if (error || !meetings?.length) return;

  for (const meeting of meetings) {
    if (!meeting.slack_message_ts) continue;

    // Check if there are any pending items for this meeting
    const { data: pendingItems } = await supabase
      .from("action_items")
      .select("id")
      .eq("meeting_id", meeting.id)
      .eq("status", "pending_review")
      .limit(1);

    if (!pendingItems?.length) continue;

    // Get thread replies
    const replies = await getThreadReplies(meeting.slack_message_ts);

    for (const reply of replies) {
      // Skip bot messages — only process Tod's replies
      if (reply.bot_id || reply.user !== config.todSlackUserId) continue;
      if (!reply.ts) continue;

      // Check if we already processed this reply
      const processed = await isThreadReplyProcessed(meeting.slack_message_ts, reply.ts);
      if (processed) continue;

      console.log(`[poll-threads] New reply in ${meeting.title}: ${reply.text}`);

      // Get all action items for context
      const { data: items } = await supabase
        .from("action_items")
        .select("*")
        .eq("meeting_id", meeting.id)
        .order("created_at", { ascending: true });

      const prompt = `Tod replied in the Slack thread for meeting "${meeting.title}".

## His reply:
"${reply.text}"

## Current action items for this meeting:
${(items ?? []).map((item, i) => `${i + 1}. [${item.status}] ${item.description} (suggested: ${item.suggested_action}, responsible: ${item.responsible_party})`).join("\n")}

## Thread message_ts: ${meeting.slack_message_ts}

## Your tasks:
1. Interpret Tod's reply — he may use natural language, shorthand, or numbered references
2. For each triaged item:
   a. If "own" → create Asana task assigned to Tod (${config.todAsanaEmail})
   b. If "delegate to [name]" → find that person's email, create Asana task assigned to them
   c. If "park" → create Asana task, then move it to backlog section
   d. If "merge with existing" → search Asana for the match, add a comment instead of creating new task
3. Update each action item in Supabase with: final_action, final_due_date, delegate_to, asana_task_id
4. Update the original Slack message (ts: ${meeting.slack_message_ts}) — replace ⬜ with ✅ for triaged items
5. Reply in the thread confirming what was created

Be flexible with Tod's language. "give karie the rest" means delegate untriaged items to Karie.`;

      try {
        await invokeAgent(prompt);
        await markThreadReplyProcessed(meeting.id, meeting.slack_message_ts, reply.ts);
        console.log(`[poll-threads] Processed reply in ${meeting.title}`);
      } catch (err) {
        console.error(`[poll-threads] Error processing reply:`, err);
      }
    }
  }
}
