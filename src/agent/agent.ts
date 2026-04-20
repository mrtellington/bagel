import { query, tool, createSdkMcpServer } from "@anthropic-ai/claude-agent-sdk";
import { z } from "zod";
import { config } from "../config.js";
import * as slack from "./tools/slack.js";
import * as asana from "./tools/asana.js";
import * as calendar from "./tools/calendar.js";
import * as db from "./tools/supabase.js";
import * as vault from "./tools/obsidian.js";

// --- Tool definitions ---

const slackPostMessage = tool(
  "slack_post_message",
  "Post a message to the Bagel Slack DM channel. Returns the message timestamp (ts). Use thread_ts to reply in a thread.",
  { text: z.string().describe("Message text (Slack mrkdwn format)"), thread_ts: z.string().optional().describe("Parent message ts to reply in thread") },
  async ({ text, thread_ts }) => {
    const result = await slack.postMessage(text, thread_ts);
    return { content: [{ type: "text" as const, text: JSON.stringify(result) }] };
  }
);

const slackUpdateMessage = tool(
  "slack_update_message",
  "Update an existing Slack message by its timestamp.",
  { ts: z.string().describe("Message timestamp to update"), text: z.string().describe("New message text") },
  async ({ ts, text }) => {
    await slack.updateMessage(ts, text);
    return { content: [{ type: "text" as const, text: "Message updated" }] };
  }
);

const slackGetThreadReplies = tool(
  "slack_get_thread_replies",
  "Get all replies in a Slack thread. Returns array of messages (excluding parent).",
  { thread_ts: z.string().describe("Parent message timestamp") },
  async ({ thread_ts }) => {
    const replies = await slack.getThreadReplies(thread_ts);
    return { content: [{ type: "text" as const, text: JSON.stringify(replies) }] };
  }
);

const asanaCreateTask = tool(
  "asana_create_task",
  "Create a task in Asana Task Triage project. Returns the created task with GID.",
  {
    name: z.string().describe("Task name"),
    notes: z.string().optional().describe("Task description/notes"),
    due_on: z.string().optional().describe("Due date in YYYY-MM-DD format"),
    assignee: z.string().optional().describe("Assignee email address"),
  },
  async ({ name, notes, due_on, assignee }) => {
    const task = await asana.createTask({ name, notes, due_on, assignee });
    return { content: [{ type: "text" as const, text: JSON.stringify(task) }] };
  }
);

const asanaUpdateTask = tool(
  "asana_update_task",
  "Update an existing Asana task.",
  {
    task_gid: z.string().describe("Asana task GID"),
    updates: z.record(z.string(), z.unknown()).describe("Fields to update (name, notes, due_on, assignee, completed)"),
  },
  async ({ task_gid, updates }) => {
    const task = await asana.updateTask(task_gid, updates);
    return { content: [{ type: "text" as const, text: JSON.stringify(task) }] };
  }
);

const asanaMoveToBacklog = tool(
  "asana_move_to_backlog",
  "Move a task to the Backlog / Parked section in Task Triage.",
  { task_gid: z.string().describe("Asana task GID") },
  async ({ task_gid }) => {
    await asana.addTaskToSection(task_gid, config.asanaBacklogSectionGid);
    return { content: [{ type: "text" as const, text: "Task moved to Backlog" }] };
  }
);

const asanaSearchTasks = tool(
  "asana_search_tasks",
  "Search for existing Asana tasks by text query. Use to find potential duplicates before creating.",
  { query: z.string().describe("Search text") },
  async ({ query: q }) => {
    const tasks = await asana.searchTasks(q);
    return { content: [{ type: "text" as const, text: JSON.stringify(tasks) }] };
  }
);

const asanaAddComment = tool(
  "asana_add_comment",
  "Add a comment/story to an existing Asana task. Use when merging meeting context into an existing task.",
  { task_gid: z.string().describe("Asana task GID"), text: z.string().describe("Comment text") },
  async ({ task_gid, text }) => {
    await asana.addComment(task_gid, text);
    return { content: [{ type: "text" as const, text: "Comment added" }] };
  }
);

const calendarGetToday = tool(
  "calendar_get_today_events",
  "Get all of Tod's calendar events for today. Use for morning briefings and scheduling awareness.",
  {},
  async () => {
    const events = await calendar.getTodayEvents();
    return { content: [{ type: "text" as const, text: JSON.stringify(events) }] };
  }
);

const calendarIsInMeeting = tool(
  "calendar_is_in_meeting",
  "Check if Tod is currently in a meeting. Use before sending nudges.",
  {},
  async () => {
    const inMeeting = await calendar.isInMeeting();
    return { content: [{ type: "text" as const, text: JSON.stringify({ in_meeting: inMeeting }) }] };
  }
);

const calendarNextGap = tool(
  "calendar_next_gap",
  "Find the next free gap in Tod's calendar of at least N minutes.",
  { min_minutes: z.number().optional().describe("Minimum gap duration in minutes (default 15)") },
  async ({ min_minutes }) => {
    const gap = await calendar.getNextGap(min_minutes ?? 15);
    return { content: [{ type: "text" as const, text: JSON.stringify(gap) }] };
  }
);

const dbGetUnprocessedMeetings = tool(
  "db_get_unprocessed_meetings",
  "Get meetings from Supabase that haven't been processed yet.",
  {},
  async () => {
    const meetings = await db.getUnprocessedMeetings();
    return { content: [{ type: "text" as const, text: JSON.stringify(meetings) }] };
  }
);

const dbMarkMeetingProcessed = tool(
  "db_mark_meeting_processed",
  "Mark a meeting as processed in Supabase.",
  { meeting_id: z.string().describe("Meeting UUID") },
  async ({ meeting_id }) => {
    await db.markMeetingProcessed(meeting_id);
    return { content: [{ type: "text" as const, text: "Meeting marked as processed" }] };
  }
);

const dbCreateActionItem = tool(
  "db_create_action_item",
  "Store an extracted action item in Supabase.",
  {
    meeting_id: z.string(),
    description: z.string(),
    name: z.string().optional(),
    responsible_party: z.string().optional(),
    responsible_email: z.string().optional(),
    suggested_due_date: z.string().optional(),
    priority: z.string().optional(),
    context: z.string().optional(),
    suggested_action: z.string().optional(),
  },
  async (args) => {
    const item = await db.createActionItem(args);
    return { content: [{ type: "text" as const, text: JSON.stringify(item) }] };
  }
);

const dbGetActionItems = tool(
  "db_get_action_items_for_meeting",
  "Get all action items for a specific meeting.",
  { meeting_id: z.string() },
  async ({ meeting_id }) => {
    const items = await db.getActionItemsForMeeting(meeting_id);
    return { content: [{ type: "text" as const, text: JSON.stringify(items) }] };
  }
);

const dbUpdateActionItem = tool(
  "db_update_action_item",
  "Update an action item's status, triage decision, delegate, due date, etc.",
  {
    item_id: z.string(),
    updates: z.record(z.string(), z.unknown()).describe("Fields to update"),
  },
  async ({ item_id, updates }) => {
    await db.updateActionItem(item_id, updates);
    return { content: [{ type: "text" as const, text: "Action item updated" }] };
  }
);

const dbGetPendingItems = tool(
  "db_get_pending_action_items",
  "Get all action items still pending review, with their meeting info.",
  {},
  async () => {
    const items = await db.getPendingActionItems();
    return { content: [{ type: "text" as const, text: JSON.stringify(items) }] };
  }
);

const dbSearchMeetings = tool(
  "db_search_meetings",
  "Search past meetings by title keyword. Use when Tod asks about a specific meeting. Returns matching meetings with notes and attendees.",
  {
    query: z.string().describe("Search term to match against meeting titles"),
    days_back: z.number().optional().describe("How many days back to search (default 7)"),
    limit: z.number().optional().describe("Max results (default 10)"),
  },
  async ({ query: q, days_back, limit }) => {
    const meetings = await db.searchMeetings(q, days_back ?? 7, limit ?? 10);
    return { content: [{ type: "text" as const, text: JSON.stringify(meetings) }] };
  }
);

const vaultSearchTool = tool(
  "vault_search",
  "Search the Obsidian vault by keyword. Searches note titles and body text. Use to answer knowledge queries like 'what do I know about AI agents?'",
  {
    query: z.string().describe("Search term"),
    limit: z.number().optional().describe("Max results (default 10)"),
  },
  async ({ query: q, limit }) => {
    const results = await vault.vaultSearch(q, limit ?? 10);
    return { content: [{ type: "text" as const, text: JSON.stringify(results) }] };
  }
);

const vaultCreateNoteTool = tool(
  "vault_create_note",
  "Create a new note in the Obsidian vault. Default folder is 00-inbox. Use when Tod shares a URL or asks to save something.",
  {
    title: z.string().describe("Note title"),
    body: z.string().describe("Note body in markdown"),
    folder: z.string().optional().describe("Target folder (default: 00-inbox). Options: 00-inbox, 10-articles, 20-meetings, 30-projects, 40-people, 50-reference"),
    source: z.string().optional().describe("Source URL if captured from web"),
    tags: z.array(z.string()).optional().describe("Tags for the note"),
  },
  async ({ title, body, folder, source, tags }) => {
    const result = await vault.vaultCreateNote({ title, body, folder, source, tags });
    return { content: [{ type: "text" as const, text: JSON.stringify(result) }] };
  }
);

const vaultUpdateNoteTool = tool(
  "vault_update_note",
  "Update an existing Obsidian note. Can change frontmatter fields (tags, status, bagel-processed) or replace the body.",
  {
    file_path: z.string().describe("Relative vault path, e.g. '00-inbox/2026-04-16-article.md'"),
    frontmatter_updates: z.record(z.string(), z.unknown()).optional().describe("Frontmatter fields to update"),
    new_body: z.string().optional().describe("New body content (replaces existing body)"),
  },
  async ({ file_path, frontmatter_updates, new_body }) => {
    const result = await vault.vaultUpdateNote({
      filePath: file_path,
      frontmatterUpdates: frontmatter_updates,
      newBody: new_body,
    });
    return { content: [{ type: "text" as const, text: JSON.stringify(result) }] };
  }
);

const vaultListRecentTool = tool(
  "vault_list_recent",
  "List the N most recently captured notes in the Obsidian vault. Use for 'what have I saved recently?' queries.",
  {
    limit: z.number().optional().describe("Number of results (default 10)"),
  },
  async ({ limit }) => {
    const results = await vault.vaultListRecent(limit ?? 10);
    return { content: [{ type: "text" as const, text: JSON.stringify(results) }] };
  }
);

const vaultDeleteNoteTool = tool(
  "vault_delete_note",
  "Delete a note from the Obsidian vault. Use as the second half of a move: call vault_create_note for the new location first, then vault_delete_note for the original inbox path.",
  {
    file_path: z.string().describe("Relative vault path to delete, e.g. '00-inbox/2026-04-16-article.md'"),
  },
  async ({ file_path }) => {
    const result = await vault.vaultDeleteNote({ filePath: file_path });
    return { content: [{ type: "text" as const, text: JSON.stringify(result) }] };
  }
);

// --- MCP Server ---

const bagelTools = createSdkMcpServer({
  name: "bagel-tools",
  tools: [
    slackPostMessage, slackUpdateMessage, slackGetThreadReplies,
    asanaCreateTask, asanaUpdateTask, asanaMoveToBacklog, asanaSearchTasks, asanaAddComment,
    calendarGetToday, calendarIsInMeeting, calendarNextGap,
    dbGetUnprocessedMeetings, dbMarkMeetingProcessed, dbCreateActionItem,
    dbGetActionItems, dbUpdateActionItem, dbGetPendingItems, dbSearchMeetings,
    vaultSearchTool, vaultCreateNoteTool, vaultUpdateNoteTool, vaultListRecentTool, vaultDeleteNoteTool,
  ],
});

// --- System prompt ---

const SYSTEM_PROMPT = `You are Bagel, Tod Ellington's executive assistant at Whitestone Branding.

Your job is to ensure no action item falls through the cracks after meetings. You extract action items, post them to Slack for Tod's triage, create Asana tasks based on his decisions, and nudge him when items are unaddressed.

## Context
- Tod is COO/CTO at Whitestone Branding (promotional products company)
- His Asana email: ${config.todAsanaEmail}
- His Slack user ID: ${config.todSlackUserId}
- Task Triage project GID: ${config.asanaProjectGid}
- Backlog section GID: ${config.asanaBacklogSectionGid}
- Business hours: Monday-Friday, 9 AM - 6 PM Eastern

## When extracting action items from meetings:
1. Only include items where someone committed to doing something or was assigned a task
2. Do NOT include general discussion points, completed items, or informational updates
3. Infer due dates from context (explicit dates, relative references like "by Friday", deadlines mentioned)
4. Set priority: 🔴 high (client-facing, explicit deadlines, someone waiting), 🟡 medium (committed, no hard deadline), 🟢 low (milestones, nice-to-haves)
5. For each item, suggest: own (Tod does it), delegate (assign to someone else), or park (backlog)
6. Flag external participants who aren't Whitestone employees — they can't own Asana tasks, suggest an internal owner to follow up
7. Search Asana for existing tasks that might match — flag with 🔗 if found

## When formatting Slack messages:
- Use Slack mrkdwn format
- Number action items sequentially
- Include due date and priority for each
- Include your suggestion (own/delegate/park) with brief reasoning
- End with "Reply in thread to triage ↓"

## When processing triage replies:
- Tod will reply in the thread with natural language like "own 1,3 — delegate 2 to karie — park 4"
- Interpret flexibly — he might say "give karie everything except 1" or "park the vendor stuff"
- Create Asana tasks based on his decisions
- Update the original Slack message with ✅ markers
- Reply in thread confirming what was created

## When nudging:
- Check if Tod is in a meeting first — don't nudge during meetings
- Find gaps in his calendar to nudge
- Be concise — he's busy
- Escalate tone after 4+ hours of no response

## Obsidian Knowledge Vault
You have access to Tod's Obsidian vault — his long-term knowledge brain.

Vault structure:
- 00-inbox: new captures waiting for review
- 10-articles: processed articles and reads
- 20-meetings: meeting notes
- 30-projects: project notes
- 40-people: contact notes
- 50-reference: evergreen reference material

When Tod shares a URL or says "save this":
1. Use vault_create_note to save it to 00-inbox with title, source URL, and tags
2. Respond with a summary and ask if he wants you to file it or ask questions to draw out his thinking

When Tod asks a knowledge question ("what do I know about X?"):
1. Use vault_search to find relevant notes
2. Summarize findings, highlight cross-note connections
3. If relevant Asana tasks exist, mention them

When processing inbox items proactively:
1. Summarize the content
2. Suggest tags and a target folder
3. Note any connections to existing vault notes
4. Ask Tod if he wants to file it or discuss it further

When Tod says "file it" or tells you to move an inbox note to a folder:
1. Call vault_create_note with the target folder (e.g. 10-articles), preserving title/source/tags and applying the tags you suggested
2. Call vault_delete_note on the ORIGINAL inbox path to remove it from 00-inbox
3. Both operations queue writes that commit on the next poll-vault cycle (≤5 min)
4. Confirm with a brief Slack reply — include the new path. Don't say "moved" or "filed!" without calling both tools; moving is a two-step operation.`;

// --- Agent invocation ---

export async function invokeAgent(prompt: string): Promise<string> {
  const messages: string[] = [];

  const result = query({
    prompt,
    options: {
      systemPrompt: SYSTEM_PROMPT,
      mcpServers: { "bagel-tools": bagelTools },
      permissionMode: "bypassPermissions",
      allowDangerouslySkipPermissions: true,
      model: "claude-sonnet-4-6",
      maxTurns: 20,
    },
  });

  for await (const message of result) {
    if (message.type === "assistant" && "message" in message) {
      for (const block of (message as { type: "assistant"; message: { content: Array<{ type: string; text?: string }> } }).message.content) {
        if (block.type === "text" && block.text) {
          messages.push(block.text);
        }
      }
    }
  }

  return messages.join("\n");
}
