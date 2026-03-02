# Bagel Agent — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Build an automated agent that extracts action items from Granola meetings, posts them to Slack for triage via thread replies, creates Asana tasks, and nudges on unaddressed items — all running on GCP.

**Architecture:** TypeScript service on GCP Compute Engine. Claude Agent SDK for AI reasoning with custom tools for Slack, Asana, Google Calendar, and Supabase. A separate Granola MCP bridge (Claude CLI cron) syncs meetings into Supabase. Business hours: M-F 9AM-6PM ET.

**Tech Stack:** TypeScript, Claude Agent SDK (`@anthropic-ai/claude-agent-sdk`), Supabase, Slack Web API, Asana REST API, Google Calendar API, node-cron, GCP Compute Engine

**Design Doc:** `docs/plans/2026-03-02-bagel-agent-design.md`

---

## Task 1: Project Scaffolding

**Files:**
- Create: `package.json`
- Create: `tsconfig.json`
- Create: `.env.example`
- Create: `.gitignore`
- Create: `src/index.ts` (placeholder)

**Step 1: Initialize the project**

```bash
cd ~/bagel
npm init -y
```

**Step 2: Install dependencies**

```bash
npm install @anthropic-ai/claude-agent-sdk @supabase/supabase-js googleapis @slack/web-api node-cron luxon dotenv zod
npm install -D typescript @types/node @types/luxon ts-node
```

**Step 3: Create tsconfig.json**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "outDir": "./dist",
    "rootDir": "./src",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "resolveJsonModule": true,
    "declaration": true,
    "declarationMap": true,
    "sourceMap": true
  },
  "include": ["src/**/*"],
  "exclude": ["node_modules", "dist"]
}
```

**Step 4: Create .env.example**

```
ANTHROPIC_API_KEY=
SLACK_BOT_TOKEN=
ASANA_PAT=
SUPABASE_URL=https://ejaxcfnnavjsajdepfkw.supabase.co
SUPABASE_SERVICE_ROLE_KEY=
GOOGLE_CALENDAR_SA_KEY_BASE64=

SLACK_CHANNEL_ID=D0AD2PW9GAX
ASANA_PROJECT_GID=1212738213310157
ASANA_BACKLOG_SECTION_GID=1213139850291370
GRANOLA_SOURCE_UUID=6d5dd263-00df-49f9-a9ea-5319cbe204d4
TIMEZONE=America/New_York
BUSINESS_HOURS_START=09:00
BUSINESS_HOURS_END=18:00
TOD_SLACK_USER_ID=U07GQ171UTZ
TOD_ASANA_EMAIL=tod.ellington@whitestonebranding.com
```

**Step 5: Create .gitignore**

```
node_modules/
dist/
.env
*.js.map
```

**Step 6: Create directory structure**

```bash
mkdir -p src/agent/tools src/sources src/jobs
mkdir -p bridge infra supabase/migrations
```

**Step 7: Create placeholder entry point**

`src/index.ts`:
```typescript
console.log("Bagel agent starting...");
```

**Step 8: Verify build**

```bash
npx tsc --noEmit
```

Expected: No errors.

**Step 9: Commit**

```bash
git add package.json package-lock.json tsconfig.json .env.example .gitignore src/index.ts
git commit -m "feat: scaffold Bagel agent project"
```

---

## Task 2: Config Module

**Files:**
- Create: `src/config.ts`

**Step 1: Write config module**

`src/config.ts`:
```typescript
import "dotenv/config";

function required(key: string): string {
  const value = process.env[key];
  if (!value) throw new Error(`Missing required env var: ${key}`);
  return value;
}

export const config = {
  anthropicApiKey: required("ANTHROPIC_API_KEY"),
  slackBotToken: required("SLACK_BOT_TOKEN"),
  asanaPat: required("ASANA_PAT"),
  supabaseUrl: required("SUPABASE_URL"),
  supabaseServiceRoleKey: required("SUPABASE_SERVICE_ROLE_KEY"),
  googleCalendarSaKeyBase64: process.env.GOOGLE_CALENDAR_SA_KEY_BASE64 ?? "",

  slackChannelId: process.env.SLACK_CHANNEL_ID ?? "D0AD2PW9GAX",
  asanaProjectGid: process.env.ASANA_PROJECT_GID ?? "1212738213310157",
  asanaBacklogSectionGid: process.env.ASANA_BACKLOG_SECTION_GID ?? "1213139850291370",
  granolaSourceUuid: process.env.GRANOLA_SOURCE_UUID ?? "6d5dd263-00df-49f9-a9ea-5319cbe204d4",
  timezone: process.env.TIMEZONE ?? "America/New_York",
  businessHoursStart: process.env.BUSINESS_HOURS_START ?? "09:00",
  businessHoursEnd: process.env.BUSINESS_HOURS_END ?? "18:00",
  todSlackUserId: process.env.TOD_SLACK_USER_ID ?? "U07GQ171UTZ",
  todAsanaEmail: process.env.TOD_ASANA_EMAIL ?? "tod.ellington@whitestonebranding.com",
} as const;
```

**Step 2: Verify build**

```bash
npx tsc --noEmit
```

**Step 3: Commit**

```bash
git add src/config.ts
git commit -m "feat: add config module with env var loading"
```

---

## Task 3: Supabase Client & Schema Migration

**Files:**
- Create: `src/agent/tools/supabase.ts`
- Create: `supabase/migrations/002_bagel_v2.sql`

**Step 1: Write Supabase client and tool functions**

`src/agent/tools/supabase.ts`:
```typescript
import { createClient } from "@supabase/supabase-js";
import { config } from "../../config.js";

export const supabase = createClient(config.supabaseUrl, config.supabaseServiceRoleKey);

// --- Query helpers used by agent tools ---

export async function getUnprocessedMeetings() {
  const { data, error } = await supabase
    .from("meetings")
    .select("*")
    .eq("processed", false)
    .order("created_at", { ascending: true });
  if (error) throw error;
  return data ?? [];
}

export async function markMeetingProcessed(meetingId: string) {
  const { error } = await supabase
    .from("meetings")
    .update({ processed: true })
    .eq("id", meetingId);
  if (error) throw error;
}

export async function createActionItem(item: {
  meeting_id: string;
  description: string;
  name?: string;
  responsible_party?: string;
  responsible_email?: string;
  suggested_due_date?: string;
  priority?: string;
  context?: string;
  suggested_action?: string;
}) {
  const { data, error } = await supabase
    .from("action_items")
    .insert({ ...item, status: "pending_review" })
    .select()
    .single();
  if (error) throw error;
  return data;
}

export async function getActionItemsForMeeting(meetingId: string) {
  const { data, error } = await supabase
    .from("action_items")
    .select("*")
    .eq("meeting_id", meetingId)
    .order("created_at", { ascending: true });
  if (error) throw error;
  return data ?? [];
}

export async function updateActionItem(
  itemId: string,
  updates: Record<string, unknown>
) {
  const { error } = await supabase
    .from("action_items")
    .update(updates)
    .eq("id", itemId);
  if (error) throw error;
}

export async function getPendingActionItems() {
  const { data, error } = await supabase
    .from("action_items")
    .select("*, meetings(title, event_datetime, slack_message_ts, slack_channel_id)")
    .eq("status", "pending_review")
    .order("created_at", { ascending: true });
  if (error) throw error;
  return data ?? [];
}

export async function isThreadReplyProcessed(threadTs: string, replyTs: string) {
  const { data } = await supabase
    .from("thread_replies")
    .select("id")
    .eq("slack_thread_ts", threadTs)
    .eq("slack_reply_ts", replyTs)
    .maybeSingle();
  return !!data;
}

export async function markThreadReplyProcessed(
  meetingId: string,
  threadTs: string,
  replyTs: string
) {
  const { error } = await supabase
    .from("thread_replies")
    .upsert({
      meeting_id: meetingId,
      slack_thread_ts: threadTs,
      slack_reply_ts: replyTs,
      processed: true,
    });
  if (error) throw error;
}
```

**Step 2: Write the database migration**

`supabase/migrations/002_bagel_v2.sql`:
```sql
-- Bagel v2 schema additions

-- Meetings: add calendar tracking
ALTER TABLE meetings ADD COLUMN IF NOT EXISTS calendar_event_id TEXT;

-- Action items: add triage fields
ALTER TABLE action_items ADD COLUMN IF NOT EXISTS suggested_due_date DATE;
ALTER TABLE action_items ADD COLUMN IF NOT EXISTS final_due_date DATE;
ALTER TABLE action_items ADD COLUMN IF NOT EXISTS priority TEXT DEFAULT 'medium';
ALTER TABLE action_items ADD COLUMN IF NOT EXISTS suggested_action TEXT;
ALTER TABLE action_items ADD COLUMN IF NOT EXISTS final_action TEXT;
ALTER TABLE action_items ADD COLUMN IF NOT EXISTS delegate_to TEXT;
ALTER TABLE action_items ADD COLUMN IF NOT EXISTS merged_with_task TEXT;
ALTER TABLE action_items ADD COLUMN IF NOT EXISTS nudge_count INTEGER DEFAULT 0;
ALTER TABLE action_items ADD COLUMN IF NOT EXISTS last_nudge_at TIMESTAMPTZ;

-- Thread reply dedup table
CREATE TABLE IF NOT EXISTS thread_replies (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  meeting_id UUID REFERENCES meetings(id),
  slack_thread_ts TEXT NOT NULL,
  slack_reply_ts TEXT NOT NULL,
  processed BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_thread_replies_dedup
  ON thread_replies(slack_thread_ts, slack_reply_ts);
```

**Step 3: Apply migration**

```bash
cd ~/bagel
supabase link --project-ref ejaxcfnnavjsajdepfkw
supabase db push
```

Expected: Migration applied, new columns and table created.

**Step 4: Verify build**

```bash
npx tsc --noEmit
```

**Step 5: Commit**

```bash
git add src/agent/tools/supabase.ts supabase/migrations/002_bagel_v2.sql
git commit -m "feat: add Supabase client, helpers, and v2 schema migration"
```

---

## Task 4: Slack Tools

**Files:**
- Create: `src/agent/tools/slack.ts`

**Step 1: Write Slack API wrapper**

`src/agent/tools/slack.ts`:
```typescript
import { WebClient } from "@slack/web-api";
import { config } from "../../config.js";

const slack = new WebClient(config.slackBotToken);

export async function postMessage(text: string, threadTs?: string) {
  const result = await slack.chat.postMessage({
    channel: config.slackChannelId,
    text,
    thread_ts: threadTs,
  });
  return { ts: result.ts, channel: result.channel };
}

export async function updateMessage(ts: string, text: string) {
  await slack.chat.update({
    channel: config.slackChannelId,
    ts,
    text,
  });
}

export async function getThreadReplies(threadTs: string) {
  const result = await slack.conversations.replies({
    channel: config.slackChannelId,
    ts: threadTs,
  });
  // Filter out the parent message — only return replies
  const messages = result.messages ?? [];
  return messages.filter((m) => m.ts !== threadTs);
}

export async function getUserInfo(userId: string) {
  const result = await slack.users.info({ user: userId });
  return result.user;
}
```

**Step 2: Verify build**

```bash
npx tsc --noEmit
```

**Step 3: Commit**

```bash
git add src/agent/tools/slack.ts
git commit -m "feat: add Slack API wrapper (post, update, read threads)"
```

---

## Task 5: Asana Tools

**Files:**
- Create: `src/agent/tools/asana.ts`

**Step 1: Write Asana API wrapper**

`src/agent/tools/asana.ts`:
```typescript
import { config } from "../../config.js";

const ASANA_BASE = "https://app.asana.com/api/1.0";

async function asanaFetch(path: string, options: RequestInit = {}) {
  const res = await fetch(`${ASANA_BASE}${path}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${config.asanaPat}`,
      "Content-Type": "application/json",
      ...options.headers,
    },
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Asana API error ${res.status}: ${body}`);
  }
  return res.json();
}

export async function createTask(task: {
  name: string;
  notes?: string;
  due_on?: string;
  assignee?: string;
  projects?: string[];
}) {
  const result = await asanaFetch("/tasks", {
    method: "POST",
    body: JSON.stringify({
      data: {
        ...task,
        projects: task.projects ?? [config.asanaProjectGid],
      },
    }),
  });
  return result.data;
}

export async function updateTask(taskGid: string, updates: Record<string, unknown>) {
  const result = await asanaFetch(`/tasks/${taskGid}`, {
    method: "PUT",
    body: JSON.stringify({ data: updates }),
  });
  return result.data;
}

export async function addTaskToSection(taskGid: string, sectionGid: string) {
  await asanaFetch(`/sections/${sectionGid}/addTask`, {
    method: "POST",
    body: JSON.stringify({ data: { task: taskGid } }),
  });
}

export async function searchTasks(query: string) {
  const result = await asanaFetch(
    `/workspaces/1201405786124364/tasks/search?text=${encodeURIComponent(query)}&opt_fields=name,completed,assignee.name,due_on,projects.name&limit=10`
  );
  return result.data ?? [];
}

export async function addComment(taskGid: string, text: string) {
  await asanaFetch(`/tasks/${taskGid}/stories`, {
    method: "POST",
    body: JSON.stringify({ data: { text } }),
  });
}

export async function findUserByEmail(email: string) {
  try {
    const result = await asanaFetch(
      `/workspaces/1201405786124364/users?opt_fields=name,email`
    );
    const users = result.data ?? [];
    return users.find(
      (u: { email: string }) => u.email.toLowerCase() === email.toLowerCase()
    );
  } catch {
    return null;
  }
}
```

**Step 2: Verify build**

```bash
npx tsc --noEmit
```

**Step 3: Commit**

```bash
git add src/agent/tools/asana.ts
git commit -m "feat: add Asana API wrapper (tasks, search, sections, comments)"
```

---

## Task 6: Google Calendar Tools

**Files:**
- Create: `src/agent/tools/calendar.ts`

**Step 1: Write Calendar API wrapper**

`src/agent/tools/calendar.ts`:
```typescript
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

export async function getTodayEvents() {
  if (!calendarClient) return [];
  const now = DateTime.now().setZone(config.timezone);
  const startOfDay = now.startOf("day").toISO();
  const endOfDay = now.endOf("day").toISO();

  const res = await calendarClient.events.list({
    calendarId: CALENDAR_ID,
    timeMin: startOfDay!,
    timeMax: endOfDay!,
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
```

**Step 2: Verify build**

```bash
npx tsc --noEmit
```

**Step 3: Commit**

```bash
git add src/agent/tools/calendar.ts
git commit -m "feat: add Google Calendar API wrapper (events, meeting check, gap finder)"
```

---

## Task 7: Agent Setup with Claude Agent SDK

**Files:**
- Create: `src/agent/agent.ts`

This is the core — creates a Claude Agent SDK instance with custom MCP tools for Slack, Asana, Calendar, and Supabase. The agent receives a prompt per job (e.g., "process this new meeting") and reasons about what tools to call.

**Step 1: Write the agent module**

`src/agent/agent.ts`:
```typescript
import { query, tool, createSdkMcpServer } from "@anthropic-ai/claude-agent-sdk";
import { z } from "zod";
import { config } from "../config.js";
import * as slack from "./tools/slack.js";
import * as asana from "./tools/asana.js";
import * as calendar from "./tools/calendar.js";
import * as db from "./tools/supabase.js";

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
    updates: z.record(z.unknown()).describe("Fields to update (name, notes, due_on, assignee, completed)"),
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
    updates: z.record(z.unknown()).describe("Fields to update"),
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

// --- MCP Server ---

const bagelTools = createSdkMcpServer({
  name: "bagel-tools",
  tools: [
    slackPostMessage, slackUpdateMessage, slackGetThreadReplies,
    asanaCreateTask, asanaUpdateTask, asanaMoveToBacklog, asanaSearchTasks, asanaAddComment,
    calendarGetToday, calendarIsInMeeting, calendarNextGap,
    dbGetUnprocessedMeetings, dbMarkMeetingProcessed, dbCreateActionItem,
    dbGetActionItems, dbUpdateActionItem, dbGetPendingItems,
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
- Escalate tone after 4+ hours of no response`;

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
      model: "sonnet",
      maxTurns: 20,
    },
  });

  for await (const message of result) {
    if (message.type === "assistant" && "content" in message) {
      for (const block of message.content) {
        if (block.type === "text") {
          messages.push(block.text);
        }
      }
    }
  }

  return messages.join("\n");
}
```

**Step 2: Verify build**

```bash
npx tsc --noEmit
```

**Step 3: Commit**

```bash
git add src/agent/agent.ts
git commit -m "feat: add Claude Agent SDK setup with 16 tools and system prompt"
```

---

## Task 8: Granola MCP Bridge

**Files:**
- Create: `bridge/granola-sync.sh`
- Create: `bridge/install-bridge-cron.sh`

**Step 1: Write the bridge script**

`bridge/granola-sync.sh`:
```bash
#!/bin/bash
# Granola MCP Bridge — polls Granola via Claude Code MCP and syncs to Supabase
# Runs via cron every 5 min during business hours

set -euo pipefail

SUPABASE_URL="${SUPABASE_URL:-https://ejaxcfnnavjsajdepfkw.supabase.co}"
SUPABASE_KEY="${SUPABASE_SERVICE_ROLE_KEY}"
SOURCE_UUID="6d5dd263-00df-49f9-a9ea-5319cbe204d4"
LOG_FILE="${HOME}/.bagel/bridge.log"

mkdir -p "$(dirname "$LOG_FILE")"

log() {
  echo "[$(date -u +%Y-%m-%dT%H:%M:%SZ)] $*" >> "$LOG_FILE"
}

log "Bridge run starting"

# Use Claude Code to poll Granola MCP and output JSON
RESULT=$(claude -p "Use the Granola MCP tools to:
1. Call list_meetings with time_range 'this_week'
2. For each meeting, output a JSON array with objects containing: id, title, date, participants (array of {name, email})

Return ONLY valid JSON — no markdown, no explanation. Format:
[{\"id\": \"uuid\", \"title\": \"...\", \"date\": \"...\", \"participants\": [{\"name\": \"...\", \"email\": \"...\"}]}]

If no meetings, return []" \
  --output-format json \
  --max-turns 3 \
  2>>"$LOG_FILE" || true)

if [ -z "$RESULT" ] || [ "$RESULT" = "[]" ]; then
  log "No meetings found or empty result"
  exit 0
fi

log "Got meetings from Granola, checking against Supabase"

# For each meeting, check if it exists in Supabase, if not get details and insert
claude -p "You have these meetings from Granola: $RESULT

For each meeting:
1. Check Supabase if it already exists: query the meetings table where external_id equals the meeting id
2. If it does NOT exist, get the full meeting details and transcript from Granola MCP using get_meetings and get_meeting_transcript
3. Insert into Supabase meetings table with:
   - source_id: '$SOURCE_UUID'
   - external_id: the Granola meeting id
   - title: meeting title
   - event_datetime: meeting date
   - attendees: participant array as JSONB
   - enhanced_notes: the AI summary from get_meetings
   - transcript: the full transcript from get_meeting_transcript
   - processed: false

Use the Bash tool to make curl calls to Supabase REST API:
  URL: $SUPABASE_URL/rest/v1/meetings
  Headers: apikey: $SUPABASE_KEY, Authorization: Bearer $SUPABASE_KEY

Report how many new meetings were synced." \
  --max-turns 15 \
  --allowedTools "mcp__claude_ai_Granola__list_meetings,mcp__claude_ai_Granola__get_meetings,mcp__claude_ai_Granola__get_meeting_transcript,Bash" \
  2>>"$LOG_FILE" | tail -5 >> "$LOG_FILE"

log "Bridge run complete"
```

**Step 2: Write the cron installer**

`bridge/install-bridge-cron.sh`:
```bash
#!/bin/bash
# Installs the Granola bridge cron job
# Runs every 5 min, Monday-Friday, 9 AM - 6 PM ET

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
BRIDGE_SCRIPT="$SCRIPT_DIR/granola-sync.sh"

chmod +x "$BRIDGE_SCRIPT"

# Create crontab entry (every 5 min, M-F, 9-17 hours ET)
# Note: cron uses the system timezone, ensure TZ=America/New_York
CRON_ENTRY="*/5 9-17 * * 1-5 TZ=America/New_York $BRIDGE_SCRIPT"

# Add to crontab if not already present
(crontab -l 2>/dev/null | grep -v "granola-sync" ; echo "$CRON_ENTRY") | crontab -

echo "Granola bridge cron installed:"
echo "  $CRON_ENTRY"
echo ""
echo "View logs: tail -f ~/.bagel/bridge.log"
```

**Step 3: Make scripts executable**

```bash
chmod +x bridge/granola-sync.sh bridge/install-bridge-cron.sh
```

**Step 4: Commit**

```bash
git add bridge/
git commit -m "feat: add Granola MCP bridge (Claude CLI cron sync)"
```

---

## Task 9: Poll Meetings Job

**Files:**
- Create: `src/jobs/poll-meetings.ts`

**Step 1: Write the meeting polling job**

`src/jobs/poll-meetings.ts`:
```typescript
import { invokeAgent } from "../agent/agent.js";
import { getUnprocessedMeetings } from "../agent/tools/supabase.js";

export async function pollMeetings() {
  const meetings = await getUnprocessedMeetings();

  if (meetings.length === 0) return;

  for (const meeting of meetings) {
    console.log(`[poll-meetings] Processing: ${meeting.title}`);

    const attendeeList = Array.isArray(meeting.attendees)
      ? meeting.attendees
          .map((a: { name?: string; email?: string }) => `${a.name ?? "Unknown"} <${a.email ?? ""}>`)
          .join(", ")
      : "Unknown";

    const prompt = `A new meeting has been synced from Granola. Process it:

## Meeting Details
- **ID:** ${meeting.id}
- **Title:** ${meeting.title}
- **Date:** ${meeting.event_datetime}
- **Attendees:** ${attendeeList}

## AI Summary (from Granola)
${meeting.enhanced_notes ?? "No summary available"}

## Transcript
${meeting.transcript ? meeting.transcript.slice(0, 8000) : "No transcript available"}

## Your tasks:
1. Extract action items from the summary and transcript
2. For each item, determine: description, responsible party, due date (infer from context), priority, and suggested triage (own/delegate/park)
3. Check if any items might match existing Asana tasks (search Asana)
4. Flag any external (non-Whitestone) participants
5. Store each action item in Supabase via db_create_action_item
6. Format and post a summary to Slack via slack_post_message
7. Mark the meeting as processed via db_mark_meeting_processed

Follow the Slack format defined in your system prompt.`;

    try {
      await invokeAgent(prompt);
      console.log(`[poll-meetings] Done: ${meeting.title}`);
    } catch (err) {
      console.error(`[poll-meetings] Error processing ${meeting.title}:`, err);
    }
  }
}
```

**Step 2: Verify build**

```bash
npx tsc --noEmit
```

**Step 3: Commit**

```bash
git add src/jobs/poll-meetings.ts
git commit -m "feat: add poll-meetings job (detect + process new meetings)"
```

---

## Task 10: Poll Threads Job

**Files:**
- Create: `src/jobs/poll-threads.ts`

**Step 1: Write the thread polling job**

`src/jobs/poll-threads.ts`:
```typescript
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
      // Skip bot messages (from Bagel itself)
      if (reply.bot_id || reply.user === config.todSlackUserId === false) continue;
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
```

**Step 2: Verify build**

```bash
npx tsc --noEmit
```

**Step 3: Commit**

```bash
git add src/jobs/poll-threads.ts
git commit -m "feat: add poll-threads job (monitor Slack replies, invoke triage)"
```

---

## Task 11: Nudge Job

**Files:**
- Create: `src/jobs/nudge.ts`

**Step 1: Write the nudge job**

`src/jobs/nudge.ts`:
```typescript
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
```

**Step 2: Verify build**

```bash
npx tsc --noEmit
```

**Step 3: Commit**

```bash
git add src/jobs/nudge.ts
git commit -m "feat: add nudge job (calendar-aware reminders for pending items)"
```

---

## Task 12: Morning Briefing & EOD Digest

**Files:**
- Create: `src/jobs/morning-briefing.ts`
- Create: `src/jobs/eod-digest.ts`

**Step 1: Write morning briefing**

`src/jobs/morning-briefing.ts`:
```typescript
import { invokeAgent } from "../agent/agent.js";
import { getPendingActionItems } from "../agent/tools/supabase.js";

export async function morningBriefing() {
  const pendingItems = await getPendingActionItems();

  const prompt = `It's morning. Send Tod his daily briefing via slack_post_message.

## Carry-forward items from previous days:
${pendingItems.length > 0
    ? pendingItems
        .map((item) => `- [${(item as any).meetings?.title}] ${item.description}`)
        .join("\n")
    : "None — all caught up!"}

## Your tasks:
1. Get today's calendar (calendar_get_today_events)
2. Identify triage gaps — windows between meetings where Tod could triage items
3. Post a morning briefing to Slack with:
   - Carry-forward open items (grouped by meeting)
   - Today's meeting schedule
   - Suggested triage windows
   - Brief, energizing tone — "Good morning" not "URGENT"
4. If there are carry-forward items, remind him he can reply in the original threads or say "own all" to sweep`;

  try {
    await invokeAgent(prompt);
    console.log("[morning-briefing] Sent");
  } catch (err) {
    console.error("[morning-briefing] Error:", err);
  }
}
```

**Step 2: Write EOD digest**

`src/jobs/eod-digest.ts`:
```typescript
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

  const prompt = `It's end of day. Send Tod his EOD digest via slack_post_message.

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
```

**Step 3: Verify build**

```bash
npx tsc --noEmit
```

**Step 4: Commit**

```bash
git add src/jobs/morning-briefing.ts src/jobs/eod-digest.ts
git commit -m "feat: add morning briefing and EOD digest jobs"
```

---

## Task 13: Scheduler with Business Hours Gate

**Files:**
- Create: `src/scheduler.ts`

**Step 1: Write the scheduler**

`src/scheduler.ts`:
```typescript
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
```

**Step 2: Verify build**

```bash
npx tsc --noEmit
```

**Step 3: Commit**

```bash
git add src/scheduler.ts
git commit -m "feat: add scheduler with business hours gate and all cron jobs"
```

---

## Task 14: Entry Point

**Files:**
- Modify: `src/index.ts`
- Modify: `package.json` (add scripts)

**Step 1: Write the entry point**

`src/index.ts`:
```typescript
import { startScheduler } from "./scheduler.js";
import { config } from "./config.js";

console.log("=================================");
console.log("  Bagel Agent Service Starting");
console.log(`  Timezone: ${config.timezone}`);
console.log(`  Hours: ${config.businessHoursStart} - ${config.businessHoursEnd}`);
console.log(`  Slack: ${config.slackChannelId}`);
console.log(`  Asana: ${config.asanaProjectGid}`);
console.log("=================================");

startScheduler();

// Keep process alive
process.on("SIGTERM", () => {
  console.log("Bagel agent shutting down...");
  process.exit(0);
});

process.on("SIGINT", () => {
  console.log("Bagel agent interrupted, shutting down...");
  process.exit(0);
});
```

**Step 2: Add scripts to package.json**

Add to `package.json` scripts:
```json
{
  "scripts": {
    "build": "tsc",
    "start": "node dist/index.js",
    "dev": "ts-node --esm src/index.ts"
  }
}
```

**Step 3: Build and verify**

```bash
npm run build
```

Expected: Compiles to `dist/` with no errors.

**Step 4: Commit**

```bash
git add src/index.ts package.json
git commit -m "feat: add entry point and build scripts"
```

---

## Task 15: GCP Infrastructure

**Files:**
- Create: `infra/setup-vm.sh`
- Create: `infra/bagel.service`
- Create: `infra/cloudbuild.yaml`
- Create: `Dockerfile`

**Step 1: Write VM setup script**

`infra/setup-vm.sh`:
```bash
#!/bin/bash
# One-time setup for GCP Compute Engine VM
set -euo pipefail

echo "=== Bagel Agent VM Setup ==="

# Install Node.js 20
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt-get install -y nodejs

# Install Claude Code CLI (for Granola bridge)
npm install -g @anthropic-ai/claude-code

# Create app directory
sudo mkdir -p /opt/bagel
sudo chown $USER:$USER /opt/bagel

# Create log directory
mkdir -p ~/.bagel

# Install systemd service
sudo cp /opt/bagel/infra/bagel.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable bagel

echo "=== Setup complete ==="
echo "Next steps:"
echo "1. Authenticate Claude CLI: claude login"
echo "2. Set secrets in Secret Manager"
echo "3. Deploy code to /opt/bagel"
echo "4. Run: sudo systemctl start bagel"
echo "5. Install bridge cron: /opt/bagel/bridge/install-bridge-cron.sh"
```

**Step 2: Write systemd service file**

`infra/bagel.service`:
```ini
[Unit]
Description=Bagel Agent Service
After=network.target

[Service]
Type=simple
User=bagel
WorkingDirectory=/opt/bagel
ExecStart=/usr/bin/node dist/index.js
Restart=always
RestartSec=10
Environment=NODE_ENV=production

# Load secrets from environment file
EnvironmentFile=/opt/bagel/.env

# Logging
StandardOutput=journal
StandardError=journal
SyslogIdentifier=bagel

[Install]
WantedBy=multi-user.target
```

**Step 3: Write Cloud Build config**

`infra/cloudbuild.yaml`:
```yaml
steps:
  - name: 'node:20'
    entrypoint: 'npm'
    args: ['ci']

  - name: 'node:20'
    entrypoint: 'npm'
    args: ['run', 'build']

  - name: 'gcr.io/cloud-builders/gcloud'
    entrypoint: 'bash'
    args:
      - '-c'
      - |
        gcloud compute scp --recurse \
          dist/ package.json package-lock.json bridge/ infra/ \
          bagel-vm:/opt/bagel/ \
          --zone=us-east1-b
        gcloud compute ssh bagel-vm --zone=us-east1-b \
          --command="cd /opt/bagel && npm ci --production && sudo systemctl restart bagel"
```

**Step 4: Write Dockerfile (alternative to VM deploy)**

`Dockerfile`:
```dockerfile
FROM node:20-slim
WORKDIR /app
COPY package*.json ./
RUN npm ci --production
COPY dist/ ./dist/
COPY bridge/ ./bridge/
CMD ["node", "dist/index.js"]
```

**Step 5: Commit**

```bash
git add infra/ Dockerfile
git commit -m "feat: add GCP infrastructure (VM setup, systemd, Cloud Build)"
```

---

## Task 16: Source Plugin Interface (Future-Proofing)

**Files:**
- Create: `src/sources/source.ts`
- Create: `src/sources/granola.ts`

**Step 1: Write the source interface**

`src/sources/source.ts`:
```typescript
export interface Participant {
  name: string;
  email: string;
  organization?: string;
  isExternal?: boolean;
}

export interface SourceContent {
  id: string;
  source: string;
  title: string;
  date: Date;
  participants: Participant[];
  body: string;
  transcript?: string;
  metadata: Record<string, unknown>;
}

export interface Source {
  name: string;
  pollInterval: number; // minutes

  poll(): Promise<SourceContent[]>;
  getContent(id: string): Promise<SourceContent>;
}
```

**Step 2: Write the Granola source (reads from Supabase)**

`src/sources/granola.ts`:
```typescript
import { Source, SourceContent, Participant } from "./source.js";
import { getUnprocessedMeetings, supabase } from "../agent/tools/supabase.js";

export class GranolaSource implements Source {
  name = "granola";
  pollInterval = 5;

  async poll(): Promise<SourceContent[]> {
    const meetings = await getUnprocessedMeetings();
    return meetings.map((m) => this.toSourceContent(m));
  }

  async getContent(id: string): Promise<SourceContent> {
    const { data, error } = await supabase
      .from("meetings")
      .select("*")
      .eq("id", id)
      .single();
    if (error || !data) throw new Error(`Meeting not found: ${id}`);
    return this.toSourceContent(data);
  }

  private toSourceContent(meeting: Record<string, any>): SourceContent {
    const attendees: Participant[] = Array.isArray(meeting.attendees)
      ? meeting.attendees.map((a: any) => ({
          name: a.name ?? "Unknown",
          email: a.email ?? "",
          organization: a.organization,
          isExternal: a.email ? !a.email.endsWith("@whitestonebranding.com") : undefined,
        }))
      : [];

    return {
      id: meeting.id,
      source: "granola",
      title: meeting.title,
      date: new Date(meeting.event_datetime),
      participants: attendees,
      body: meeting.enhanced_notes ?? "",
      transcript: meeting.transcript,
      metadata: {
        external_id: meeting.external_id,
        raw_payload: meeting.raw_payload,
      },
    };
  }
}
```

**Step 3: Verify build**

```bash
npx tsc --noEmit
```

**Step 4: Commit**

```bash
git add src/sources/
git commit -m "feat: add Source plugin interface and Granola implementation"
```

---

## Task 17: Create .env with Real Credentials & Smoke Test

**Step 1: Create .env from .env.example**

```bash
cp .env.example .env
```

Then fill in real values from `~/docs/plans/config-values.md`:
- `ANTHROPIC_API_KEY` — user's key
- `SLACK_BOT_TOKEN` — `xoxb-773352188980-...`
- `ASANA_PAT` — `2/1208461833471002/...`
- `SUPABASE_SERVICE_ROLE_KEY` — from config-values.md
- `GOOGLE_CALENDAR_SA_KEY_BASE64` — from GCP service account setup

**Step 2: Build the project**

```bash
npm run build
```

Expected: Clean compile, no errors.

**Step 3: Smoke test — run the service**

```bash
npm start
```

Expected output:
```
=================================
  Bagel Agent Service Starting
  Timezone: America/New_York
  Hours: 09:00 - 18:00
  Slack: D0AD2PW9GAX
  Asana: 1212738213310157
=================================
[scheduler] Starting (America/New_York, 09:00-18:00 M-F)
[scheduler] All jobs scheduled
```

Kill with Ctrl+C after verifying it starts.

**Step 4: Commit (do NOT commit .env)**

```bash
git status  # verify .env is gitignored
git add -A
git commit -m "feat: complete Bagel agent v2 — ready for deployment"
```

---

## Task 18: Deploy to GCP & End-to-End Test

**Step 1: Create GCP Compute Engine VM**

```bash
gcloud compute instances create bagel-vm \
  --zone=us-east1-b \
  --machine-type=e2-small \
  --image-family=ubuntu-2204-lts \
  --image-project=ubuntu-os-cloud \
  --boot-disk-size=20GB \
  --tags=bagel
```

**Step 2: SSH into VM and run setup**

```bash
gcloud compute ssh bagel-vm --zone=us-east1-b
# Then run infra/setup-vm.sh
```

**Step 3: Authenticate Claude CLI on VM**

```bash
claude login
```

Follow the auth flow. This enables the Granola MCP bridge.

**Step 4: Set up secrets and .env on VM**

Copy credentials to `/opt/bagel/.env` on the VM.

**Step 5: Deploy code and start service**

```bash
sudo systemctl start bagel
sudo journalctl -u bagel -f  # watch logs
```

**Step 6: Install Granola bridge cron**

```bash
/opt/bagel/bridge/install-bridge-cron.sh
```

**Step 7: End-to-end test**

1. Create a test meeting in Granola (or wait for the bridge to pick up a real one)
2. Watch bridge logs: `tail -f ~/.bagel/bridge.log`
3. Watch service logs: `sudo journalctl -u bagel -f`
4. Verify: meeting appears in Supabase → action items posted to Slack → reply in thread → Asana tasks created

**Step 8: Decommission old pipeline**

After verifying Bagel v2 works:
- Deactivate n8n workflow `xE1wftiN4UYKsfzU` (Meeting Intake)
- Deactivate n8n workflow `a8jEkq30GFAjOTNd` (Slack Action Handler)
- Pause Zapier Zap `347428399`
- Remove Slack interactivity URL pointing to n8n

---

## Summary

| Task | What | Files |
|------|------|-------|
| 1 | Project scaffolding | package.json, tsconfig, .gitignore |
| 2 | Config module | src/config.ts |
| 3 | Supabase client + migration | src/agent/tools/supabase.ts, migration SQL |
| 4 | Slack tools | src/agent/tools/slack.ts |
| 5 | Asana tools | src/agent/tools/asana.ts |
| 6 | Calendar tools | src/agent/tools/calendar.ts |
| 7 | Agent SDK setup | src/agent/agent.ts |
| 8 | Granola MCP bridge | bridge/*.sh |
| 9 | Poll meetings job | src/jobs/poll-meetings.ts |
| 10 | Poll threads job | src/jobs/poll-threads.ts |
| 11 | Nudge job | src/jobs/nudge.ts |
| 12 | Morning + EOD jobs | src/jobs/morning-briefing.ts, eod-digest.ts |
| 13 | Scheduler | src/scheduler.ts |
| 14 | Entry point | src/index.ts |
| 15 | GCP infrastructure | infra/*, Dockerfile |
| 16 | Source plugin interface | src/sources/*.ts |
| 17 | Credentials + smoke test | .env, build, run |
| 18 | GCP deploy + E2E test | VM setup, deploy, verify |
