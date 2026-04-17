# Obsidian Brain Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Connect Bagel to a Git-backed Obsidian vault so it can capture articles, proactively triage inbox items, and answer knowledge queries via Slack.

**Architecture:** A private GitHub repo mirrors the Obsidian vault via the `obsidian-git` plugin. Bagel on the GCP VM clones the repo, polls for changes every 5 min, caches parsed notes in Supabase, and writes back by committing to the repo. Four new agent tools expose vault operations. A new cron job handles proactive inbox processing.

**Tech Stack:** Node.js/TypeScript, Supabase (cache + queue), Git CLI on VM, existing Claude Agent SDK + Slack Socket Mode infrastructure.

**Spec:** `docs/superpowers/specs/2026-04-16-obsidian-brain-design.md`

---

## File Map

| File | Action | Responsibility |
|------|--------|---------------|
| `src/config.ts` | Modify | Add `obsidianRepoUrl`, `obsidianLocalPath` env vars |
| `src/sources/obsidian.ts` | Create | Git operations (clone/pull), markdown+frontmatter parsing, inbox detection |
| `src/agent/tools/obsidian.ts` | Create | Supabase CRUD for `obsidian_notes` and `obsidian_queue` tables |
| `src/agent/tools/supabase.ts` | Modify | Add obsidian table query helpers |
| `src/agent/agent.ts` | Modify | Register 4 vault tools, update system prompt with Obsidian context |
| `src/jobs/poll-vault.ts` | Create | Cron job: pull repo, sync to Supabase, process inbox, flush write queue |
| `src/socket-mode.ts` | Modify | Detect URL-sharing DMs and route to vault capture flow |
| `src/scheduler.ts` | Modify | Register `poll-vault` cron job |
| `src/index.ts` | Modify | Log Obsidian config on startup |
| `supabase/migrations/003_obsidian_brain.sql` | Create | `obsidian_notes` and `obsidian_queue` tables |
| `.env.example` | Modify | Add `OBSIDIAN_REPO_URL`, `OBSIDIAN_LOCAL_PATH` |

---

## Task 1: Supabase Migration — obsidian_notes and obsidian_queue tables

**Files:**
- Create: `supabase/migrations/003_obsidian_brain.sql`

- [ ] **Step 1: Write the migration**

```sql
-- Obsidian Brain: note cache and write queue

CREATE TABLE IF NOT EXISTS obsidian_notes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  file_path TEXT UNIQUE NOT NULL,
  title TEXT,
  source TEXT,
  captured_at DATE,
  tags TEXT[] DEFAULT '{}',
  status TEXT DEFAULT 'inbox',
  bagel_processed BOOLEAN DEFAULT false,
  body TEXT,
  frontmatter JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_obsidian_notes_status ON obsidian_notes(status);
CREATE INDEX IF NOT EXISTS idx_obsidian_notes_bagel_processed ON obsidian_notes(bagel_processed);
CREATE INDEX IF NOT EXISTS idx_obsidian_notes_tags ON obsidian_notes USING GIN(tags);

CREATE TABLE IF NOT EXISTS obsidian_queue (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  operation TEXT NOT NULL CHECK (operation IN ('create', 'update')),
  file_path TEXT NOT NULL,
  content TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now(),
  committed_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_obsidian_queue_uncommitted ON obsidian_queue(committed_at) WHERE committed_at IS NULL;
```

- [ ] **Step 2: Run the migration against Supabase**

```bash
cd /Users/todellington/bagel
# Get the Supabase URL and key from .env
source .env
psql "$SUPABASE_URL" -f supabase/migrations/003_obsidian_brain.sql
```

If `psql` isn't available or the URL isn't a direct Postgres connection, use the Supabase dashboard SQL editor instead: navigate to the project's SQL Editor, paste the migration contents, and run it.

Expected: Tables `obsidian_notes` and `obsidian_queue` created with indexes.

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/003_obsidian_brain.sql
git commit -m "feat: add obsidian_notes and obsidian_queue tables (migration 003)"
```

---

## Task 2: Config — add Obsidian env vars

**Files:**
- Modify: `src/config.ts`
- Modify: `.env.example`

- [ ] **Step 1: Update config.ts**

Add two new fields to the config object (after the existing `todAsanaEmail` line):

```typescript
// In src/config.ts, add to the config object:
  obsidianRepoUrl: required("OBSIDIAN_REPO_URL"),
  obsidianLocalPath: process.env.OBSIDIAN_LOCAL_PATH ?? "/opt/bagel/vault",
```

The full config object should now end with:

```typescript
  todAsanaEmail: process.env.TOD_ASANA_EMAIL ?? "tod.ellington@whitestonebranding.com",
  obsidianRepoUrl: required("OBSIDIAN_REPO_URL"),
  obsidianLocalPath: process.env.OBSIDIAN_LOCAL_PATH ?? "/opt/bagel/vault",
} as const;
```

- [ ] **Step 2: Update .env.example**

Add these two lines at the end of `.env.example`:

```
OBSIDIAN_REPO_URL=git@github.com:mrtellington/bagel-brain.git
OBSIDIAN_LOCAL_PATH=/opt/bagel/vault
```

- [ ] **Step 3: Add to local .env**

```bash
echo 'OBSIDIAN_REPO_URL=git@github.com:mrtellington/bagel-brain.git' >> /Users/todellington/bagel/.env
echo 'OBSIDIAN_LOCAL_PATH=/opt/bagel/vault' >> /Users/todellington/bagel/.env
```

Note: The actual repo URL will be confirmed when Tod creates the GitHub repo. Update `.env` to match.

- [ ] **Step 4: Verify build**

```bash
cd /Users/todellington/bagel && npx tsc --noEmit
```

Expected: Build succeeds (the service will fail at runtime without the env var set, which is intentional — `required()` throws).

- [ ] **Step 5: Commit**

```bash
git add src/config.ts .env.example
git commit -m "feat: add Obsidian repo URL and local path config"
```

---

## Task 3: Obsidian source — git operations + markdown parser

**Files:**
- Create: `src/sources/obsidian.ts`

This is the core module that interacts with the Git repo and parses Obsidian markdown files. It does NOT use the `Source` interface from `source.ts` because Obsidian notes are not `SourceContent` (they don't have participants or transcripts). It's a standalone module.

- [ ] **Step 1: Create src/sources/obsidian.ts**

```typescript
import { execFileSync } from "child_process";
import { readFileSync, writeFileSync, readdirSync, statSync, existsSync, mkdirSync } from "fs";
import { join, relative, extname, dirname } from "path";
import { config } from "../config.js";

export interface ObsidianNote {
  filePath: string;       // relative to vault root, e.g. "00-inbox/2026-04-16-article.md"
  title: string;
  source?: string;        // URL if captured from web
  capturedAt?: string;    // YYYY-MM-DD
  tags: string[];
  status: string;         // inbox | processed
  bagelProcessed: boolean;
  body: string;           // markdown content without frontmatter
  frontmatter: Record<string, unknown>;
}

/**
 * Clone the vault repo if it doesn't exist locally, or pull latest changes.
 * Returns true if there were new changes, false if already up-to-date.
 */
export function pullVault(): boolean {
  const localPath = config.obsidianLocalPath;

  if (!existsSync(join(localPath, ".git"))) {
    console.log("[obsidian] Cloning vault repo...");
    execFileSync("git", ["clone", config.obsidianRepoUrl, localPath], {
      stdio: "pipe",
      timeout: 60_000,
    });
    return true;
  }

  try {
    const result = execFileSync("git", ["pull", "--ff-only"], {
      cwd: localPath,
      encoding: "utf-8",
      timeout: 30_000,
    });
    const upToDate = result.includes("Already up to date");
    if (!upToDate) {
      console.log("[obsidian] Pulled new changes");
    }
    return !upToDate;
  } catch (err) {
    console.error("[obsidian] Git pull failed:", err);
    return false;
  }
}

/**
 * Parse a single markdown file into an ObsidianNote.
 */
export function parseNote(filePath: string): ObsidianNote {
  const fullPath = join(config.obsidianLocalPath, filePath);
  const raw = readFileSync(fullPath, "utf-8");
  const { frontmatter, body } = parseFrontmatter(raw);

  return {
    filePath,
    title: (frontmatter.title as string) ?? fileNameToTitle(filePath),
    source: frontmatter.source as string | undefined,
    capturedAt: frontmatter.captured as string | undefined,
    tags: Array.isArray(frontmatter.tags) ? frontmatter.tags.map(String) : [],
    status: (frontmatter.status as string) ?? "inbox",
    bagelProcessed: frontmatter["bagel-processed"] === true,
    body,
    frontmatter,
  };
}

/**
 * Walk the vault and return all markdown files as relative paths.
 * Skips .obsidian/, .git/, and templates/ directories.
 */
export function listVaultFiles(): string[] {
  const files: string[] = [];
  const skipDirs = new Set([".obsidian", ".git", "templates", "node_modules"]);

  function walk(dir: string) {
    for (const entry of readdirSync(dir)) {
      if (skipDirs.has(entry)) continue;
      const full = join(dir, entry);
      const stat = statSync(full);
      if (stat.isDirectory()) {
        walk(full);
      } else if (extname(entry) === ".md") {
        files.push(relative(config.obsidianLocalPath, full));
      }
    }
  }

  walk(config.obsidianLocalPath);
  return files;
}

/**
 * Get all unprocessed notes in the 00-inbox/ folder.
 */
export function getInboxNotes(): ObsidianNote[] {
  return listVaultFiles()
    .filter((f) => f.startsWith("00-inbox/"))
    .map(parseNote)
    .filter((n) => !n.bagelProcessed);
}

/**
 * Commit a new or updated file to the vault repo and push.
 * content should be the full markdown including frontmatter.
 */
export function commitAndPush(filePath: string, content: string): void {
  const fullPath = join(config.obsidianLocalPath, filePath);

  // Ensure parent directory exists
  mkdirSync(dirname(fullPath), { recursive: true });

  // Write file
  writeFileSync(fullPath, content, "utf-8");

  // Git add, commit, push
  const cwd = config.obsidianLocalPath;
  try {
    execFileSync("git", ["add", filePath], { cwd, stdio: "pipe" });
    execFileSync("git", ["commit", "-m", `bagel: ${filePath}`], { cwd, stdio: "pipe" });
    execFileSync("git", ["push"], { cwd, stdio: "pipe", timeout: 30_000 });
    console.log(`[obsidian] Committed and pushed: ${filePath}`);
  } catch (err) {
    console.error(`[obsidian] Git commit/push failed for ${filePath}:`, err);
    throw err;
  }
}

/**
 * Update frontmatter in an existing note (e.g., set bagel-processed: true).
 * Preserves the body content.
 */
export function updateNoteFrontmatter(
  filePath: string,
  updates: Record<string, unknown>
): void {
  const note = parseNote(filePath);
  const merged = { ...note.frontmatter, ...updates };
  const content = serializeFrontmatter(merged) + note.body;
  commitAndPush(filePath, content);
}

// --- Internal helpers ---

function parseFrontmatter(raw: string): {
  frontmatter: Record<string, unknown>;
  body: string;
} {
  const match = raw.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
  if (!match) return { frontmatter: {}, body: raw };

  const yamlBlock = match[1];
  const body = match[2];

  // Simple YAML parser — handles the flat key-value + array format we use
  const frontmatter: Record<string, unknown> = {};
  for (const line of yamlBlock.split("\n")) {
    const kv = line.match(/^(\S+):\s*(.*)$/);
    if (!kv) continue;
    const [, key, rawValue] = kv;
    let value: unknown = rawValue.trim();

    // Handle arrays: [tag1, tag2]
    if (typeof value === "string" && value.startsWith("[") && value.endsWith("]")) {
      value = value
        .slice(1, -1)
        .split(",")
        .map((s) => s.trim().replace(/^["']|["']$/g, ""))
        .filter(Boolean);
    }
    // Handle booleans
    else if (value === "true") value = true;
    else if (value === "false") value = false;
    // Handle quoted strings
    else if (
      typeof value === "string" &&
      ((value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'")))
    ) {
      value = value.slice(1, -1);
    }

    frontmatter[key] = value;
  }

  return { frontmatter, body };
}

function serializeFrontmatter(fm: Record<string, unknown>): string {
  const lines = ["---"];
  for (const [key, value] of Object.entries(fm)) {
    if (Array.isArray(value)) {
      lines.push(`${key}: [${value.map((v) => String(v)).join(", ")}]`);
    } else if (typeof value === "boolean") {
      lines.push(`${key}: ${value}`);
    } else if (typeof value === "string" && value.includes(":")) {
      lines.push(`${key}: "${value}"`);
    } else {
      lines.push(`${key}: ${String(value)}`);
    }
  }
  lines.push("---\n");
  return lines.join("\n");
}

function fileNameToTitle(filePath: string): string {
  const name = filePath.split("/").pop() ?? filePath;
  return name
    .replace(/\.md$/, "")
    .replace(/^\d{4}-\d{2}-\d{2}(-\d{4})?-/, "") // strip date prefix
    .replace(/-/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase());
}
```

- [ ] **Step 2: Verify build**

```bash
cd /Users/todellington/bagel && npx tsc --noEmit
```

Expected: Compiles with no errors.

- [ ] **Step 3: Commit**

```bash
git add src/sources/obsidian.ts
git commit -m "feat: add Obsidian vault source — git pull, markdown parser, inbox detection"
```

---

## Task 4: Supabase helpers — obsidian note CRUD

**Files:**
- Modify: `src/agent/tools/supabase.ts`

- [ ] **Step 1: Add obsidian helpers to supabase.ts**

Append these functions at the end of `src/agent/tools/supabase.ts`:

```typescript
// --- Obsidian note cache ---

export async function upsertObsidianNote(note: {
  file_path: string;
  title?: string;
  source?: string;
  captured_at?: string;
  tags?: string[];
  status?: string;
  bagel_processed?: boolean;
  body?: string;
  frontmatter?: Record<string, unknown>;
}) {
  const { error } = await supabase
    .from("obsidian_notes")
    .upsert(
      { ...note, updated_at: new Date().toISOString() },
      { onConflict: "file_path" }
    );
  if (error) throw error;
}

export async function searchObsidianNotes(query: string, limit: number = 10) {
  const { data, error } = await supabase
    .from("obsidian_notes")
    .select("*")
    .or(`title.ilike.%${query}%,body.ilike.%${query}%`)
    .order("updated_at", { ascending: false })
    .limit(limit);
  if (error) throw error;
  return data ?? [];
}

export async function getRecentObsidianNotes(limit: number = 10) {
  const { data, error } = await supabase
    .from("obsidian_notes")
    .select("*")
    .order("created_at", { ascending: false })
    .limit(limit);
  if (error) throw error;
  return data ?? [];
}

export async function getUnprocessedObsidianInbox() {
  const { data, error } = await supabase
    .from("obsidian_notes")
    .select("*")
    .eq("bagel_processed", false)
    .like("file_path", "00-inbox/%")
    .order("created_at", { ascending: true });
  if (error) throw error;
  return data ?? [];
}

export async function enqueueObsidianWrite(operation: "create" | "update", filePath: string, content: string) {
  const { data, error } = await supabase
    .from("obsidian_queue")
    .insert({ operation, file_path: filePath, content })
    .select()
    .single();
  if (error) throw error;
  return data;
}

export async function getUncommittedObsidianWrites() {
  const { data, error } = await supabase
    .from("obsidian_queue")
    .select("*")
    .is("committed_at", null)
    .order("created_at", { ascending: true });
  if (error) throw error;
  return data ?? [];
}

export async function markObsidianWriteCommitted(queueId: string) {
  const { error } = await supabase
    .from("obsidian_queue")
    .update({ committed_at: new Date().toISOString() })
    .eq("id", queueId);
  if (error) throw error;
}

export async function deleteObsidianNote(filePath: string) {
  const { error } = await supabase
    .from("obsidian_notes")
    .delete()
    .eq("file_path", filePath);
  if (error) throw error;
}
```

- [ ] **Step 2: Verify build**

```bash
cd /Users/todellington/bagel && npx tsc --noEmit
```

Expected: Compiles with no errors.

- [ ] **Step 3: Commit**

```bash
git add src/agent/tools/supabase.ts
git commit -m "feat: add Supabase helpers for obsidian_notes and obsidian_queue"
```

---

## Task 5: Agent tools — vault_search, vault_create_note, vault_update_note, vault_list_recent

**Files:**
- Create: `src/agent/tools/obsidian.ts`

This file defines the tool handler functions that the agent calls. They use the Supabase helpers from Task 4 and the git operations from Task 3.

- [ ] **Step 1: Create src/agent/tools/obsidian.ts**

```typescript
import { DateTime } from "luxon";
import { config } from "../../config.js";
import {
  searchObsidianNotes,
  getRecentObsidianNotes,
  enqueueObsidianWrite,
} from "./supabase.js";

/**
 * Search the Obsidian vault by keyword across titles and body text.
 */
export async function vaultSearch(query: string, limit: number = 10) {
  return searchObsidianNotes(query, limit);
}

/**
 * Create a new note in the vault. Writes to the queue; poll-vault commits it.
 * Returns the queued entry.
 */
export async function vaultCreateNote(args: {
  title: string;
  folder?: string;
  source?: string;
  tags?: string[];
  body: string;
}) {
  const folder = args.folder ?? "00-inbox";
  const date = DateTime.now().setZone(config.timezone).toFormat("yyyy-MM-dd");
  const slug = args.title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "")
    .slice(0, 60);
  const filePath = `${folder}/${date}-${slug}.md`;

  const tags = args.tags ?? [];
  const frontmatter = [
    "---",
    `title: "${args.title}"`,
    args.source ? `source: "${args.source}"` : null,
    `captured: ${date}`,
    `tags: [${tags.join(", ")}]`,
    `status: inbox`,
    `bagel-processed: false`,
    "---",
    "",
  ]
    .filter((line) => line !== null)
    .join("\n");

  const content = frontmatter + args.body + "\n";
  const queued = await enqueueObsidianWrite("create", filePath, content);
  return { filePath, queued };
}

/**
 * Update an existing note's frontmatter. Writes to the queue; poll-vault commits it.
 */
export async function vaultUpdateNote(args: {
  filePath: string;
  frontmatterUpdates?: Record<string, unknown>;
  newBody?: string;
}) {
  // Read the current cached version from Supabase to merge changes
  const existing = await searchObsidianNotes(args.filePath, 1);
  if (existing.length === 0) {
    throw new Error(`Note not found in cache: ${args.filePath}`);
  }

  const note = existing[0];
  const currentFm = (note.frontmatter as Record<string, unknown>) ?? {};
  const mergedFm = { ...currentFm, ...(args.frontmatterUpdates ?? {}) };
  const body = args.newBody ?? note.body ?? "";

  // Serialize
  const lines = ["---"];
  for (const [key, value] of Object.entries(mergedFm)) {
    if (Array.isArray(value)) {
      lines.push(`${key}: [${value.map(String).join(", ")}]`);
    } else if (typeof value === "boolean") {
      lines.push(`${key}: ${value}`);
    } else if (typeof value === "string" && value.includes(":")) {
      lines.push(`${key}: "${value}"`);
    } else {
      lines.push(`${key}: ${String(value)}`);
    }
  }
  lines.push("---\n");
  const content = lines.join("\n") + body + "\n";

  const queued = await enqueueObsidianWrite("update", args.filePath, content);
  return { filePath: args.filePath, queued };
}

/**
 * List N most recently captured notes.
 */
export async function vaultListRecent(limit: number = 10) {
  return getRecentObsidianNotes(limit);
}
```

- [ ] **Step 2: Verify build**

```bash
cd /Users/todellington/bagel && npx tsc --noEmit
```

Expected: Compiles with no errors.

- [ ] **Step 3: Commit**

```bash
git add src/agent/tools/obsidian.ts
git commit -m "feat: add Obsidian vault tool handlers — search, create, update, list"
```

---

## Task 6: Register tools + update system prompt in agent.ts

**Files:**
- Modify: `src/agent/agent.ts`

- [ ] **Step 1: Add import for obsidian tools**

At the top of `src/agent/agent.ts`, after the existing imports, add:

```typescript
import * as vault from "./tools/obsidian.js";
```

- [ ] **Step 2: Add tool definitions**

After the existing `dbSearchMeetings` tool definition (around line 214), add these four tools:

```typescript
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
```

- [ ] **Step 3: Register tools in the MCP server**

Update the `createSdkMcpServer` tools array to include the new vault tools. The array should end with:

```typescript
const bagelTools = createSdkMcpServer({
  name: "bagel-tools",
  tools: [
    slackPostMessage, slackUpdateMessage, slackGetThreadReplies,
    asanaCreateTask, asanaUpdateTask, asanaMoveToBacklog, asanaSearchTasks, asanaAddComment,
    calendarGetToday, calendarIsInMeeting, calendarNextGap,
    dbGetUnprocessedMeetings, dbMarkMeetingProcessed, dbCreateActionItem,
    dbGetActionItems, dbUpdateActionItem, dbGetPendingItems, dbSearchMeetings,
    vaultSearchTool, vaultCreateNoteTool, vaultUpdateNoteTool, vaultListRecentTool,
  ],
});
```

- [ ] **Step 4: Update system prompt with Obsidian context**

In the `SYSTEM_PROMPT` string, add this section after the existing "When nudging:" section (before the final backtick):

```
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
```

- [ ] **Step 5: Verify build**

```bash
cd /Users/todellington/bagel && npx tsc --noEmit
```

Expected: Compiles with no errors.

- [ ] **Step 6: Commit**

```bash
git add src/agent/agent.ts
git commit -m "feat: register vault tools and add Obsidian system prompt to agent"
```

---

## Task 7: poll-vault cron job

**Files:**
- Create: `src/jobs/poll-vault.ts`

- [ ] **Step 1: Create the poll-vault job**

```typescript
import { invokeAgent } from "../agent/agent.js";
import {
  pullVault,
  listVaultFiles,
  parseNote,
  commitAndPush,
} from "../sources/obsidian.js";
import {
  upsertObsidianNote,
  getUncommittedObsidianWrites,
  markObsidianWriteCommitted,
} from "../agent/tools/supabase.js";

export async function pollVault() {
  // Step 1: Pull latest from GitHub
  const hasChanges = pullVault();

  // Step 2: Sync vault files to Supabase cache
  const files = listVaultFiles();
  for (const filePath of files) {
    try {
      const note = parseNote(filePath);
      await upsertObsidianNote({
        file_path: note.filePath,
        title: note.title,
        source: note.source,
        captured_at: note.capturedAt,
        tags: note.tags,
        status: note.status,
        bagel_processed: note.bagelProcessed,
        body: note.body,
        frontmatter: note.frontmatter,
      });
    } catch (err) {
      console.error(`[poll-vault] Error parsing ${filePath}:`, err);
    }
  }

  // Step 3: Process unprocessed inbox items
  const inboxFiles = files.filter((f) => f.startsWith("00-inbox/"));
  for (const filePath of inboxFiles) {
    try {
      const note = parseNote(filePath);
      if (note.bagelProcessed) continue;

      console.log(`[poll-vault] Processing inbox item: ${note.title}`);

      const prompt = `A new item appeared in the Obsidian vault inbox.

## Note Details
- **File:** ${note.filePath}
- **Title:** ${note.title}
${note.source ? `- **Source:** ${note.source}` : ""}
- **Tags:** ${note.tags.length > 0 ? note.tags.join(", ") : "none"}

## Content
${note.body.slice(0, 6000)}

## Your tasks:
1. Search the vault for related notes (vault_search with 2-3 key terms from the content)
2. Generate a 2-3 sentence summary
3. Suggest tags (3-5 relevant tags)
4. Suggest which folder to file it in (10-articles, 20-meetings, 30-projects, 40-people, or 50-reference)
5. Post a message to Slack (slack_post_message) with:
   - "New in your vault: *[Title]*"
   - Your summary
   - Suggested tags and folder
   - Any connections to existing notes
   - Ask: "File it, or want to talk it through?"
6. Update the note's frontmatter: set bagel-processed to true (vault_update_note)`;

      await invokeAgent(prompt);
      console.log(`[poll-vault] Done: ${note.title}`);
    } catch (err) {
      console.error(`[poll-vault] Error processing ${filePath}:`, err);
    }
  }

  // Step 4: Flush write queue — commit any pending writes to GitHub
  const pendingWrites = await getUncommittedObsidianWrites();
  for (const entry of pendingWrites) {
    try {
      commitAndPush(entry.file_path, entry.content);
      await markObsidianWriteCommitted(entry.id);
      console.log(`[poll-vault] Committed queued write: ${entry.file_path}`);
    } catch (err) {
      console.error(`[poll-vault] Failed to commit ${entry.file_path}:`, err);
    }
  }

  if (hasChanges || pendingWrites.length > 0) {
    console.log(
      `[poll-vault] Synced ${files.length} files, processed inbox, committed ${pendingWrites.length} writes`
    );
  }
}
```

- [ ] **Step 2: Verify build**

```bash
cd /Users/todellington/bagel && npx tsc --noEmit
```

Expected: Compiles with no errors.

- [ ] **Step 3: Commit**

```bash
git add src/jobs/poll-vault.ts
git commit -m "feat: add poll-vault cron job — sync, inbox triage, queue flush"
```

---

## Task 8: Wire up scheduler + Socket Mode URL detection

**Files:**
- Modify: `src/scheduler.ts`
- Modify: `src/socket-mode.ts`
- Modify: `src/index.ts`

- [ ] **Step 1: Add poll-vault to scheduler**

In `src/scheduler.ts`, add the import at the top:

```typescript
import { pollVault } from "./jobs/poll-vault.js";
```

Add the cron schedule inside `startScheduler()`, after the existing `poll-meetings` line:

```typescript
  // Poll Obsidian vault for new notes — every 5 minutes
  cron.schedule("*/5 * * * *", guardedJob("poll-vault", pollVault));
```

- [ ] **Step 2: Add URL detection to socket-mode.ts**

In `src/socket-mode.ts`, update the `handleDirectMessage` function to detect URLs and route them to vault capture. Replace the existing `handleDirectMessage` function:

```typescript
async function handleDirectMessage(event: Record<string, any>) {
  const text = event.text ?? "";

  // Detect URLs — if the message contains a link, route to vault capture
  const urlMatch = text.match(/https?:\/\/[^\s>]+/);
  const isCapture = urlMatch && (
    text.toLowerCase().includes("save") ||
    text.toLowerCase().includes("clip") ||
    text.toLowerCase().includes("capture") ||
    // If the message is mostly just a URL, treat it as a capture
    text.trim().replace(urlMatch[0], "").trim().length < 20
  );

  const prompt = isCapture
    ? `Tod shared a URL in Slack and wants to save it to his Obsidian vault.

His message: "${text}"
Detected URL: ${urlMatch![0]}

## Your tasks:
1. Use vault_create_note to create a note in 00-inbox with:
   - title: infer from the URL or surrounding text
   - source: the URL
   - body: "Captured from Slack. Awaiting content extraction."
   - tags: infer 2-3 tags from context
2. Search the vault for related notes (vault_search)
3. Reply via slack_post_message with:
   - Confirmation that it was saved
   - Any related notes you found
   - Ask: "Want me to summarize it or file it somewhere specific?"`
    : `Tod sent you a direct message in Slack:

"${text}"

Respond helpfully. You have access to tools for:
- Searching past meetings (db_search_meetings)
- Checking calendar (calendar_get_today_events)
- Searching Asana tasks (asana_search_tasks)
- Getting pending action items (db_get_pending_action_items)
- Searching the Obsidian vault (vault_search)
- Listing recent vault notes (vault_list_recent)
- Creating vault notes (vault_create_note)
- Posting Slack messages (slack_post_message)

Respond by posting a Slack message in the DM channel. Be concise and helpful.
If you search for meetings, tasks, or vault notes, summarize the results in a readable format.
If you don't find what Tod is looking for, say so and suggest alternatives.`;

  const response = await invokeAgent(prompt);
  console.log(`[socket-mode] DM handled, agent response length: ${response.length}`);
}
```

- [ ] **Step 3: Add Obsidian config to startup log**

In `src/index.ts`, add a log line inside the startup banner, after the Asana line:

```typescript
console.log(`  Vault: ${config.obsidianRepoUrl.split("/").pop()?.replace(".git", "")}`);
```

The full banner should now read:

```typescript
console.log("=================================");
console.log("  Bagel Agent Service Starting");
console.log(`  Timezone: ${config.timezone}`);
console.log(`  Hours: ${config.businessHoursStart} - ${config.businessHoursEnd}`);
console.log(`  Slack: ${config.slackChannelId}`);
console.log(`  Asana: ${config.asanaProjectGid}`);
console.log(`  Vault: ${config.obsidianRepoUrl.split("/").pop()?.replace(".git", "")}`);
console.log("=================================");
```

- [ ] **Step 4: Verify build**

```bash
cd /Users/todellington/bagel && npx tsc --noEmit
```

Expected: Compiles with no errors.

- [ ] **Step 5: Commit**

```bash
git add src/scheduler.ts src/socket-mode.ts src/index.ts
git commit -m "feat: wire poll-vault cron, URL detection in DMs, vault startup log"
```

---

## Task 9: Obsidian vault setup — scaffold folders + templates

**Files:**
- These files are in the Obsidian vault (`/Users/todellington/Documents/Obsidian`), NOT the Bagel codebase

- [ ] **Step 1: Initialize the vault as a Git repo and create folder structure**

```bash
cd /Users/todellington/Documents/Obsidian
git init
mkdir -p 00-inbox 10-articles 20-meetings 30-projects 40-people 50-reference templates
```

- [ ] **Step 2: Create .gitkeep files so empty folders are tracked**

```bash
cd /Users/todellington/Documents/Obsidian
for dir in 00-inbox 10-articles 20-meetings 30-projects 40-people 50-reference; do
  touch "$dir/.gitkeep"
done
```

- [ ] **Step 3: Create the article template**

Create `templates/article.md`:

```markdown
---
title: "{{title}}"
source: "{{url}}"
captured: {{date}}
tags: []
status: inbox
bagel-processed: false
---

{{content}}
```

- [ ] **Step 4: Create .gitignore for Obsidian workspace files**

Create `.gitignore` in the vault root:

```
.obsidian/workspace.json
.obsidian/workspace-mobile.json
.obsidian/workspace.json.bak
.trash/
```

- [ ] **Step 5: Create a GitHub repo and push**

```bash
cd /Users/todellington/Documents/Obsidian
git add -A
git commit -m "init: scaffold Obsidian vault with PARA folder structure"
```

Then Tod creates the repo on GitHub (`mrtellington/bagel-brain`, private) and pushes:

```bash
git remote add origin git@github.com:mrtellington/bagel-brain.git
git branch -M main
git push -u origin main
```

Note: If the repo name differs from `bagel-brain`, update the `OBSIDIAN_REPO_URL` in both local `.env` and VM `.env`.

- [ ] **Step 6: Install obsidian-git plugin in Obsidian**

In Obsidian app:
1. Settings → Community plugins → Turn off Restricted Mode (if not done)
2. Browse community plugins → search "Obsidian Git" → Install → Enable
3. Settings → Obsidian Git:
   - Auto push interval: 5 (minutes)
   - Auto pull interval: 5 (minutes)
   - Auto backup after stop editing: ON
   - Commit message: `vault: {{date}} auto`

- [ ] **Step 7: Install Dataview plugin**

In Obsidian app:
1. Browse community plugins → search "Dataview" → Install → Enable
2. Settings → Dataview → Enable JavaScript Queries: ON

- [ ] **Step 8: Install Templater plugin**

In Obsidian app:
1. Browse community plugins → search "Templater" → Install → Enable
2. Settings → Templater → Template folder location: `templates`

- [ ] **Step 9: Install Obsidian Web Clipper**

Install the browser extension:
- Chrome: search "Obsidian Web Clipper" in Chrome Web Store
- Configure it to save to the `00-inbox` folder with the article template

---

## Task 10: VM setup — deploy and configure Git access

**Files:**
- VM configuration (no codebase files)

- [ ] **Step 1: Deploy updated code to VM**

```bash
cd /Users/todellington/bagel
npx tsc
tar czf /tmp/bagel-update.tar.gz dist/ package.json package-lock.json
gcloud compute scp --zone=us-east1-b --project=requests-9d412 /tmp/bagel-update.tar.gz bagel-vm:/tmp/
gcloud compute ssh bagel-vm --zone=us-east1-b --project=requests-9d412 --command="cd /opt/bagel && sudo -u bagel tar xzf /tmp/bagel-update.tar.gz && sudo -u bagel npm ci --omit=dev"
```

- [ ] **Step 2: Set up Git SSH on the VM for vault access**

The VM needs SSH access to the private GitHub repo. Generate a deploy key:

```bash
gcloud compute ssh bagel-vm --zone=us-east1-b --project=requests-9d412 --command="
  sudo -u bagel ssh-keygen -t ed25519 -f /home/bagel/.ssh/id_ed25519 -N '' -C 'bagel-vm-vault'
  sudo -u bagel cat /home/bagel/.ssh/id_ed25519.pub
"
```

Copy the public key output. Go to GitHub → `mrtellington/bagel-brain` → Settings → Deploy keys → Add deploy key. Paste the key. Check "Allow write access". Save.

- [ ] **Step 3: Configure Git and test clone**

```bash
gcloud compute ssh bagel-vm --zone=us-east1-b --project=requests-9d412 --command="
  sudo -u bagel bash -c '
    ssh-keyscan github.com >> ~/.ssh/known_hosts 2>/dev/null
    git config --global user.name \"Bagel Bot\"
    git config --global user.email \"bagel@whitestonebranding.com\"
    git clone git@github.com:mrtellington/bagel-brain.git /opt/bagel/vault
  '
"
```

Expected: Repo clones successfully to `/opt/bagel/vault`.

- [ ] **Step 4: Add OBSIDIAN_REPO_URL to VM .env**

```bash
gcloud compute ssh bagel-vm --zone=us-east1-b --project=requests-9d412 --command="
  echo 'OBSIDIAN_REPO_URL=git@github.com:mrtellington/bagel-brain.git' | sudo tee -a /opt/bagel/.env
  echo 'OBSIDIAN_LOCAL_PATH=/opt/bagel/vault' | sudo tee -a /opt/bagel/.env
  sudo chmod 600 /opt/bagel/.env
  sudo chown bagel:bagel /opt/bagel/.env
"
```

- [ ] **Step 5: Restart and verify**

```bash
gcloud compute ssh bagel-vm --zone=us-east1-b --project=requests-9d412 --command="
  sudo systemctl restart bagel
  sleep 5
  sudo journalctl -u bagel -n 30 --no-pager
"
```

Expected: Startup log shows `Vault: bagel-brain` and `[socket-mode] Connected — listening for DMs`. No errors from poll-vault.

---

## Task 11: End-to-end smoke test

- [ ] **Step 1: Test article capture via Slack**

DM the Bagel bot in Slack: "save this https://www.linkedin.com/pulse/how-i-built-my-ai-chief-staff-zapier-sdk-wade-foster-rudbc/"

Expected: Bagel responds with confirmation, summary attempt, and the note is queued. Within 5 minutes, the note should appear in `00-inbox/` in your Obsidian vault.

- [ ] **Step 2: Test knowledge query**

DM Bagel: "what do I know about AI agents?"

Expected: Bagel searches the vault and returns the article you just saved (if poll-vault has run), or says "nothing yet" if the cache hasn't populated.

- [ ] **Step 3: Test proactive inbox processing**

Use the Obsidian Web Clipper to clip any article. Wait 10 minutes (obsidian-git push + poll-vault pull cycle). Bagel should DM you with a summary and triage questions.

- [ ] **Step 4: Test thread reply flow**

When Bagel surfaces an inbox item, reply in the thread: "file it to articles, tag it ai and productivity"

Expected: Bagel updates the note's frontmatter and moves it (via vault_update_note).

- [ ] **Step 5: Verify vault sync roundtrip**

Check that:
- Notes created by Bagel appear in Obsidian (after obsidian-git pull)
- Notes clipped in Obsidian appear in Bagel's Slack messages (after obsidian-git push + poll-vault)
- Frontmatter updates from Bagel are reflected in Obsidian
