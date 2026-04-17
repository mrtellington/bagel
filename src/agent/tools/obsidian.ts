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
