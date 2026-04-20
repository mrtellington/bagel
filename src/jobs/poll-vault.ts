import { invokeAgent } from "../agent/agent.js";
import {
  pullVault,
  listVaultFiles,
  parseNote,
  commitAndPush,
  updateNoteFrontmatter,
} from "../sources/obsidian.js";
import {
  upsertObsidianNote,
  getUncommittedObsidianWrites,
  markObsidianWriteCommitted,
  deleteObsidianNote,
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
  const processedInThisRun: string[] = [];
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
      processedInThisRun.push(filePath);
      console.log(`[poll-vault] Done: ${note.title}`);
    } catch (err) {
      console.error(`[poll-vault] Error processing ${filePath}:`, err);
    }
  }

  // Step 4: Flush write queue — commit any pending writes to GitHub
  const pendingWrites = await getUncommittedObsidianWrites();
  for (const entry of pendingWrites) {
    try {
      commitAndPush(entry.operation, entry.file_path, entry.content);
      await markObsidianWriteCommitted(entry.id);
      if (entry.operation === "delete") {
        await deleteObsidianNote(entry.file_path);
      }
      console.log(`[poll-vault] Committed queued write: ${entry.operation} ${entry.file_path}`);
    } catch (err) {
      console.error(`[poll-vault] Failed to commit ${entry.operation} ${entry.file_path}:`, err);
    }
  }

  // Step 5: Safety net — ensure every note we invoked the agent on is marked
  // processed on disk. The agent is not reliable about calling vault_update_note
  // as the last step; this prevents infinite re-triage.
  for (const filePath of processedInThisRun) {
    try {
      const fresh = parseNote(filePath);
      if (!fresh.bagelProcessed) {
        console.log(`[poll-vault] Safety net: marking ${filePath} bagel-processed=true (agent skipped)`);
        updateNoteFrontmatter(filePath, { "bagel-processed": true });
      }
    } catch (err) {
      console.error(`[poll-vault] Safety-net failed for ${filePath}:`, err);
    }
  }

  if (hasChanges || pendingWrites.length > 0 || processedInThisRun.length > 0) {
    console.log(
      `[poll-vault] Synced ${files.length} files, processed inbox, committed ${pendingWrites.length} writes`
    );
  }
}
