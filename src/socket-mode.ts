import { SocketModeClient } from "@slack/socket-mode";
import { config } from "./config.js";
import { invokeAgent } from "./agent/agent.js";
import { supabase, isThreadReplyProcessed, markThreadReplyProcessed } from "./agent/tools/supabase.js";

const socketMode = new SocketModeClient({ appToken: config.slackAppToken });

// Handle all incoming Slack events
socketMode.on("message", async ({ event, ack }: { event: Record<string, any>; ack: () => Promise<void> }) => {
  await ack();

  // Ignore bot messages (including our own)
  if (event.bot_id || event.bot_profile) return;

  // Only process DMs from Tod
  if (event.channel !== config.slackChannelId) return;
  if (event.user !== config.todSlackUserId) return;

  const text = event.text ?? "";
  if (!text.trim()) return;

  console.log(`[socket-mode] DM received: "${text.substring(0, 80)}..."`);

  try {
    if (event.thread_ts && event.thread_ts !== event.ts) {
      // --- Thread reply: triage command ---
      await handleThreadReply(event);
    } else {
      // --- Top-level DM: ad-hoc query/command ---
      await handleDirectMessage(event);
    }
  } catch (err) {
    console.error("[socket-mode] Error handling message:", err);
  }
});

async function handleDirectMessage(event: Record<string, any>) {
  const text = event.text ?? "";

  const prompt = `Tod sent you a direct message in Slack:

"${text}"

Respond helpfully. You have access to tools for:
- Searching past meetings (db_search_meetings)
- Checking calendar (calendar_get_today_events)
- Searching Asana tasks (asana_search_tasks)
- Getting pending action items (db_get_pending_action_items)
- Posting Slack messages (slack_post_message)

Respond by posting a Slack message in the DM channel. Be concise and helpful.
If you search for meetings or tasks, summarize the results in a readable format.
If you don't find what Tod is looking for, say so and suggest alternatives.`;

  const response = await invokeAgent(prompt);
  console.log(`[socket-mode] DM handled, agent response length: ${response.length}`);
}

async function handleThreadReply(event: Record<string, any>) {
  const threadTs = event.thread_ts;
  const replyTs = event.ts;

  // Dedup: skip if already processed
  const processed = await isThreadReplyProcessed(threadTs, replyTs);
  if (processed) return;

  // Find the meeting associated with this thread
  const { data: meeting } = await supabase
    .from("meetings")
    .select("id, title, slack_message_ts")
    .eq("slack_message_ts", threadTs)
    .single();

  if (!meeting) {
    console.log(`[socket-mode] Thread reply in unknown thread ${threadTs}, skipping`);
    return;
  }

  // Get action items for context
  const { data: items } = await supabase
    .from("action_items")
    .select("*")
    .eq("meeting_id", meeting.id)
    .order("created_at", { ascending: true });

  const prompt = `Tod replied in the Slack thread for meeting "${meeting.title}".

## His reply:
"${event.text}"

## Current action items for this meeting:
${(items ?? []).map((item: any, i: number) => `${i + 1}. [${item.status}] ${item.description} (suggested: ${item.suggested_action}, responsible: ${item.responsible_party})`).join("\n")}

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

  await invokeAgent(prompt);
  await markThreadReplyProcessed(meeting.id, threadTs, replyTs);
  console.log(`[socket-mode] Thread reply processed for "${meeting.title}"`);
}

export async function startSocketMode() {
  console.log("[socket-mode] Connecting to Slack...");
  await socketMode.start();
  console.log("[socket-mode] Connected — listening for DMs");
}
