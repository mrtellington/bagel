# Handoff: Bagel Phase 1 — Meeting Action Items Pipeline (Supabase Edge Functions)

## Session Metadata
- Created: 2026-02-07 21:36:10
- Project: /Users/todellington (new directory: ~/bagel)
- Branch: N/A (new project, not yet initialized)
- Session duration: ~30 minutes (planning verification + initial setup attempt)

## Handoff Chain

- **Continues from**: `/Users/todellington/.claude/handoffs/2026-02-06-091033-meeting-actions-pipeline-task5-zapier.md`
- **Supersedes**: None

> This session began implementing the Phase 1 plan to migrate the meeting action items pipeline from n8n to Supabase Edge Functions. No code was written yet — the session focused on gathering context and verifying the plan before the first `supabase init`.

## Current State Summary

The user has a detailed implementation plan (provided in the conversation) to migrate the Granola → Slack → Asana meeting action items pipeline from n8n workflows to Supabase Edge Functions (TypeScript/Deno). This session gathered all context from previous handoffs, the plan transcript, and config-values.md to prepare for implementation. **No files have been created yet.** The `~/bagel` directory does not exist. The next agent should begin with project initialization.

## Codebase Understanding

### Architecture Overview

**Current (n8n — being replaced):**
```
Granola → Zapier → n8n webhook → Store in Supabase → Anthropic AI → Parse → Slack DM → Asana
```

**New (Supabase Edge Functions):**
```
Granola → Zapier → POST to Supabase Edge Function (granola-intake)
  → Parse payload → Store meeting in Supabase
  → Anthropic API: extract topics + action items
  → Create ALL Asana tasks upfront in Task Triage
  → Store items in Supabase (with Asana GIDs)
  → Send Slack DM: summary + topics + items with Approve/Park/Assign buttons
  → User reviews in Slack
  → Button clicks → slack-actions Edge Function
    → Park: immediate (move Asana to Backlog, update Supabase + Slack)
    → Approve: open modal (date picker + project) → process submission
    → Assign: open modal (user picker + date + project) → process submission
```

**Key design changes from n8n version:**
1. **Asana tasks created UPFRONT** (not on button click) — every action item gets a task immediately
2. **Topics extraction** — new AI output: 3-6 topic phrases per meeting
3. **Slack modals** for Approve/Assign — replaces direct action, allows due date + project selection
4. **Message rebuild strategy** — on every action, rebuild entire Slack message from Supabase state (avoids stale data)

### Critical Files

| File | Purpose | Relevance |
|------|---------|-----------|
| `/Users/todellington/docs/plans/config-values.md` | All service IDs, tokens, GIDs | Primary config reference — has every value needed |
| Plan in conversation | Full implementation plan | The user's message contains the complete architecture + code structure |
| `/Users/todellington/.claude/handoffs/2026-02-06-091033-meeting-actions-pipeline-task5-zapier.md` | Previous handoff | Context on n8n workflow state (both active, credentials hardcoded) |

### Key Patterns Discovered

- **Supabase project is shared** with `alteryx-newhire-swag` — same project ID `ejaxcfnnavjsajdepfkw`, but the `~/bagel` directory will be a separate `supabase init` linked to the same project
- **Existing tables** (`sources`, `meetings`, `action_items`) already exist in the Supabase DB — migration only adds columns
- **Supabase CLI v2.39.2** is installed but outdated (v2.75.0 available) — should work fine
- **Slack DM channel** is `D0AD2PW9GAX` (confirmed in config-values.md). Previous handoff mentioned `D07H1LNSBA9` — that was incorrect/outdated
- **Zapier payload fields**: `meeting_title`, `enhanced_notes`, `attendees_name` (array), `attendees_email` (array), `transcript`, `date_time`, `external_id`

## Work Completed

### Tasks Finished

- [x] Gathered and verified all context from previous handoffs and config-values.md
- [x] Verified Supabase CLI is installed (v2.39.2)
- [x] Confirmed ~/bagel directory does not exist (fresh start)
- [x] Confirmed database tables exist (sources, meetings, action_items) — migration just adds columns

### Files Modified

None — no code written yet.

### Decisions Made

| Decision | Options Considered | Rationale |
|----------|-------------------|-----------|
| Separate ~/bagel directory | Reuse existing alteryx-newhire-swag supabase dir vs new dir | Clean separation of concerns — meeting pipeline has different functions/migrations than swag ordering |

## Pending Work

## Immediate Next Steps

1. **Initialize ~/bagel project**
   ```bash
   mkdir -p ~/bagel && cd ~/bagel
   supabase init
   supabase link --project-ref ejaxcfnnavjsajdepfkw
   supabase functions new granola-intake
   supabase functions new slack-actions
   ```

2. **Create database migration** (`supabase/migrations/001_add_columns.sql`)
   ```sql
   ALTER TABLE meetings ADD COLUMN IF NOT EXISTS slack_message_ts TEXT;
   ALTER TABLE meetings ADD COLUMN IF NOT EXISTS slack_channel_id TEXT;
   ALTER TABLE meetings ADD COLUMN IF NOT EXISTS topics JSONB;
   ALTER TABLE action_items ADD COLUMN IF NOT EXISTS name TEXT;
   ```
   Then: `supabase db push`

3. **Write shared utilities** (`supabase/functions/_shared/`)
   - `types.ts` — TypeScript interfaces for Meeting, ActionItem, ParsedPayload, AIResponse, Slack payloads
   - `supabase.ts` — DB operations (createMeeting, updateMeeting, createActionItem, updateActionItem, getMeetingWithItems)
   - `anthropic.ts` — Claude API call with system prompt prioritizing enhanced_notes over transcript
   - `asana.ts` — createTask, updateTask, addTaskToSection, addTaskToProject, removeTaskFromProject, listProjects
   - `slack.ts` — postMessage, updateMessage, openModal, getUserInfo
   - `blocks.ts` — buildMeetingMessage, buildUpdatedMessage (Slack Block Kit)
   - `modals.ts` — buildApproveModal, buildAssignModal

4. **Write granola-intake function** (`supabase/functions/granola-intake/index.ts`)
   - Parse Zapier payload → store meeting → Anthropic AI → create Asana tasks → send Slack DM
   - Deploy with `--no-verify-jwt`

5. **Write slack-actions function** (`supabase/functions/slack-actions/index.ts`)
   - Handle block_actions (Park=immediate, Approve/Assign=open modals)
   - Handle view_submission (process modal forms → update Asana/Supabase/Slack)
   - Deploy with `--no-verify-jwt`

6. **Set Supabase secrets**
   ```
   ANTHROPIC_API_KEY (need from user)
   SLACK_BOT_TOKEN
   ASANA_PAT
   SUPABASE_SERVICE_ROLE_KEY
   ```

7. **Update external services**
   - Zapier webhook URL → `https://ejaxcfnnavjsajdepfkw.supabase.co/functions/v1/granola-intake`
   - Slack interactivity URL → `https://ejaxcfnnavjsajdepfkw.supabase.co/functions/v1/slack-actions`
   - Deactivate n8n workflows

### Blockers/Open Questions

- [ ] User's Anthropic API key — currently only stored as n8n credential (ID: `fV95BFx1dQTyIKMK`), need it as a Supabase secret
- [ ] `supabase link` may prompt for database password — user may need to provide it

### Deferred Items

- Updating Zapier webhook URL (Step 6 in plan) — do after granola-intake is tested
- Updating Slack interactivity URL — do after slack-actions is tested
- Deactivating n8n workflows — do after both new functions are verified

## Context for Resuming Agent

## Important Context

1. **The full implementation plan is in the user's message** — it contains the complete architecture, project structure, all function specs, AI prompts, Slack message format, modal definitions, config values table, and implementation order. READ IT CAREFULLY.

2. **Database tables already exist** — `sources`, `meetings`, `action_items` are already in Supabase. The migration ONLY adds new columns (`slack_message_ts`, `slack_channel_id`, `topics` to meetings; `name` to action_items).

3. **Config values are in** `/Users/todellington/docs/plans/config-values.md` — all IDs, tokens, GIDs are there. Key values also in the plan's "Config Values" table.

4. **Supabase Edge Functions use Deno** — imports use URL-based imports (e.g., `https://esm.sh/@supabase/supabase-js`), NOT npm. The runtime is Deno, not Node.js.

5. **Two Edge Functions, shared code pattern** — Supabase Edge Functions support a `_shared/` directory under `functions/` for shared modules. Import with relative paths like `../_shared/types.ts`.

6. **Slack sends URL-encoded payloads** for interactivity — the `slack-actions` function must parse `application/x-www-form-urlencoded` body and extract the `payload` field (JSON string).

7. **Slack buttons have 2000 char value limit** — Button values contain `JSON.stringify({item_id, asana_gid, name, meeting_id})`. Keep concise. Modal `private_metadata` has same limit — includes `{modal_type, item_id, asana_gid, item_name, meeting_id, channel_id, message_ts}`.

8. **Message rebuild strategy** — Every button/modal action rebuilds the ENTIRE Slack message from Supabase state. This avoids stale data issues and `private_metadata` size limits.

9. **Granola source UUID** — `6d5dd263-00df-49f9-a9ea-5319cbe204d4` (use as `source_id` when creating meetings).

10. **Default section GID** — `1212738213310158` (the default/first section in Task Triage project, where new tasks land).

### Assumptions Made

- Supabase CLI can link to the existing project and deploy functions alongside the alteryx-newhire-swag functions
- The `_shared/` directory pattern works for Supabase Edge Functions (standard Deno import)
- Anthropic API can be called directly via HTTP from Edge Functions (no SDK needed, but SDK via esm.sh is also an option)

### Potential Gotchas

- **Deno, not Node** — No `require()`, no `node_modules`. Use `https://esm.sh/` for npm packages or Deno standard library.
- **Supabase Edge Functions env vars** — Access via `Deno.env.get('VAR_NAME')`, set via `supabase secrets set`
- **CORS** — Edge Functions may need CORS headers if called from browser, but Zapier and Slack are server-side so likely not needed
- **Slack 3-second timeout** — Slack expects a response within 3 seconds for interactivity payloads. For modals, return 200 immediately, then process async. For `block_actions`, return 200 fast then do work.
- **`supabase db push` vs `supabase migration up`** — `db push` applies migrations directly to remote. Use that since we're not using local dev.

## Environment State

### Tools/Services Used

| Tool | URL/ID | Status |
|------|--------|--------|
| Supabase | `ejaxcfnnavjsajdepfkw` | Active, tables exist |
| Supabase CLI | v2.39.2 | Installed |
| Slack App "Bagel" | `A0ACT45NCGP` | Installed, interactivity enabled |
| Zapier Zap | `347428399` | LIVE, pointing to n8n (will update later) |
| n8n Meeting Intake | `xE1wftiN4UYKsfzU` | Active (will deactivate later) |
| n8n Slack Action Handler | `a8jEkq30GFAjOTNd` | Active (will deactivate later) |
| Asana Task Triage | `1212738213310157` | Ready |

### Active Processes

- Zapier Zap 347428399 is LIVE and sending to n8n (don't change until new functions are tested)
- Both n8n workflows are ACTIVE (keep running until switchover)

### Environment Variables (Names Only)

Secrets to set in Supabase:
- `ANTHROPIC_API_KEY`
- `SLACK_BOT_TOKEN`
- `ASANA_PAT`
- `SUPABASE_SERVICE_ROLE_KEY`

## Related Resources

- Implementation Plan: User's message in this conversation (contains full spec)
- Config Values: `/Users/todellington/docs/plans/config-values.md`
- Previous Handoff: `/Users/todellington/.claude/handoffs/2026-02-06-091033-meeting-actions-pipeline-task5-zapier.md`
- Slack App Dashboard: https://api.slack.com/apps/A0ACT45NCGP
- Asana Task Triage: https://app.asana.com/1/1201405786124364/project/1212738213310157/list

---

**Security Note**: Config-values.md contains actual tokens/keys. The plan message also contains secrets. Neither should be shared externally.
