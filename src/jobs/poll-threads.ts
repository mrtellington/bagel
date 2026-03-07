import { invokeAgent } from "../agent/agent.js";
import { supabase, isThreadReplyProcessed, markThreadReplyProcessed } from "../agent/tools/supabase.js";
import { getThreadReplies } from "../agent/tools/slack.js";
import { config } from "../config.js";
import { sanitizeSlackInput, buildTriagePrompt } from "../prompts.js";

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
      // Skip bot messages — only process the owner's replies
      if (reply.bot_id || reply.user !== config.ownerSlackUserId) continue;
      if (!reply.ts) continue;

      // Check if we already processed this reply
      const processed = await isThreadReplyProcessed(meeting.slack_message_ts, reply.ts);
      if (processed) continue;

      console.log(`[poll-threads] New reply in ${meeting.title} (${(reply.text ?? "").length} chars)`);

      // Get all action items for context
      const { data: items } = await supabase
        .from("action_items")
        .select("*")
        .eq("meeting_id", meeting.id)
        .order("created_at", { ascending: true });

      const sanitizedReply = sanitizeSlackInput(reply.text ?? "");

      const prompt = buildTriagePrompt({
        meetingTitle: meeting.title,
        sanitizedReply,
        actionItems: items ?? [],
        slackMessageTs: meeting.slack_message_ts,
      });

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
