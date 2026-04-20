# Handoff: Bagel Calendar/Asana Tool Gaps — Calendar SA Missing, Asana Workflow TBD

## Session Metadata
- Created: 2026-04-19 (late Sunday night, ~11:30pm ET)
- Project: /Users/todellington/bagel
- Branch: main
- Session duration: continuation of obsidian-brain work, ~3 hours

### Recent Commits (for context)
  - a91b7b3 feat: safety net in poll-vault to mark inbox items processed
  - 00c022b feat: add date-range calendar + my-tasks Asana tools
  - ffdb251 feat: run poll-vault 24/7, not just business hours
  - 34fdc12 feat: add vault_delete_note tool for proper file moves
  - 8e6b95b Merge pull request #1 from mrtellington/feat/obsidian-brain

## Handoff Chain

- **Continues from**: [2026-04-17-obsidian-brain-implementation.md](./2026-04-17-obsidian-brain-implementation.md)
  - Obsidian Brain fully operational end-to-end; all fixes merged to main, deployed to VM
- **Supersedes**: None

## Current State Summary

Obsidian Brain is complete. Tonight's live-test DMs exposed two *separate* reliability issues in Bagel's calendar and Asana tools, plus one reliability pattern in the agent itself. All were surfaced by Tod asking a single question: "look at Monday's schedule and also help me organize any overdue tasks." Fixed some of it tonight; two items remain for a future session.

## What was shipped tonight (beyond the obsidian-brain handoff)

### 1. poll-vault 24/7 (commit `ffdb251`)
Previously the business-hours guard (M-F 9-6 ET) silenced poll-vault on weekends. A Saturday-morning clip would wait 48+ hours to be triaged. Added `alwaysJob` helper in `src/scheduler.ts` and switched poll-vault to it. Other jobs (meetings, threads, nudge, briefing, digest) stay gated — those are human-facing rhythm.

### 2. Date-range calendar + my-tasks Asana tools (commit `00c022b`)
Previously the only calendar tool was `calendar_get_today_events`. When Tod asked about Monday, the agent returned today's (empty Sunday) calendar and confidently said "your schedule is clear" — classic hallucination from tool-coverage gap.

- `calendar.getEventsForDate(dateStr)` + `calendar_get_events` tool
- `asana.getMyTasks({ dueBefore, dueAfter, includeCompleted })` + `asana_get_my_tasks` tool
- `invokeAgent` now injects today's date into the system prompt every call (using `luxon` + `config.timezone`), so the model can resolve "Monday"/"tomorrow" to YYYY-MM-DD before calling date-scoped tools
- System prompt: new "Tool honesty — CRITICAL" section forbidding plausible-sounding answers not verified by tool output

### 3. Safety net in poll-vault (commit `a91b7b3`)
The agent is unreliable about calling `vault_update_note` at the end of inbox triage. During tonight's live test, the RTK article was triaged THREE times in a row despite the prompt explicitly demanding `bagel-processed: true` as the last step. Infinite loop risk.

Deterministic fix: new step 5 in `src/jobs/poll-vault.ts` — after step 3 (agent invocation), track which files were processed; after step 4 (queue flush), re-parse each processed file and force-mark `bagel-processed: true` via `updateNoteFrontmatter` (direct git commit+push, not queued) if the agent skipped it. Validated: zero re-triages after deploy.

## Known gaps / pending work

### A. Calendar service account is not configured
**Root cause**: `GOOGLE_CALENDAR_SA_KEY_BASE64` is **empty string** in both the local `.env` and the VM's `/opt/bagel/.env` (length=0). `src/agent/tools/calendar.ts` has `if (!config.googleCalendarSaKeyBase64) return null` — so `calendarClient` is always null, and every calendar tool silently returns `[]`. Not a permissions issue; there's no credential at all.

Tod's Monday 2026-04-20 calendar visibly has 5 meetings (screenshot in session). Bagel says "clear."

**Fix path** (requires Tod's Google Calendar UI action):
1. Create/reuse a GCP service account with **Google Calendar API** enabled
   - Can scaffold via: `gcloud iam service-accounts create bagel-calendar-reader --display-name="Bagel Calendar Reader" --project=requests-9d412`
   - Generate key: `gcloud iam service-accounts keys create key.json --iam-account=bagel-calendar-reader@requests-9d412.iam.gserviceaccount.com`
2. Share `tod.ellington@whitestonebranding.com` calendar with the SA's email (Calendar → Settings for my calendars → Share with specific people → add SA email with "See all event details") — **manual step, Tod only**
3. `base64 -i key.json | pbcopy`, paste into both `.env` files as `GOOGLE_CALENDAR_SA_KEY_BASE64`
4. `sudo systemctl restart bagel` on the VM

**Anti-pattern worth fixing later**: the `?? ""` fallback in `config.ts` makes "calendar disabled" indistinguishable from "user has no events." Either (a) log "calendar disabled" at startup when the key is empty, or (b) make the key `required()` if `config.calendarEnabled` is true.

### B. Asana task-management workflow
Tod asked Bagel to "help me clean overdue tasks up by working with me to prioritize and get them [done]." The new `asana_get_my_tasks` tool LISTS tasks, but Bagel has no structured workflow for walking Tod through them one-by-one (like the meeting-triage flow does for action items).

**Suggested shape** (~30 min):
- New section in `SYSTEM_PROMPT` under "When Tod asks for a task cleanup session":
  1. Call `asana_get_my_tasks({ due_before: today })` for overdue
  2. Present them one at a time in Slack: task name, due date, project, "own / delegate / defer [date] / drop"
  3. Thread reply handler (like `poll-threads` does for meetings) interprets each response and calls `asana_update_task` accordingly
- New tool: `asana_defer_task(task_gid, new_due_date)` (just a wrapper over `updateTask`)
- Possibly: batch mode — "defer everything to next week" / "drop items 2, 4, 5"

Similar pattern to meeting action-item triage in `src/socket-mode.ts:handleThreadReply` — could model after that.

### C. Agent still skips housekeeping tool calls (observed twice tonight)
The agent skipped `vault_update_note` on the RTK article triage, AND skipped `vault_create_note` + `vault_delete_note` when Tod replied "File it" to the RTK triage. Both times it sent plausible confirmation DMs without actually calling the tools.

**This is a reliability pattern, not a single bug.** The "Tool honesty" system-prompt clause added tonight may help but is unproven. Durable fix patterns to consider for future sessions:
- Post-invocation tool-call validation in `invokeAgent` — inspect the stream, detect if expected tools were called, retry with a stern "you didn't call X — do it now" prompt
- Move housekeeping OUT of the agent entirely — let the agent decide WHAT to do, but have deterministic code DO it (pattern: safety net in poll-vault step 5)
- Split prompts — one call for the conversational reply, a second call strictly for the mutation with no other tools available

## Environment state

- VM: `bagel-vm` us-east1-b, project `requests-9d412`, service `bagel` (systemd) active
- Vault: `/opt/bagel/vault` (git remote: `mrtellington/bagel-brain`)
- Supabase: `ejaxcfnnavjsajdepfkw` (meeting-actions), migrations 001-004 applied
- All 4 Obsidian plugins installed + configured on Tod's Mac
- VM `.env` missing `GOOGLE_CALENDAR_SA_KEY_BASE64` value (key empty)

## Critical files (changed tonight)

| File | What changed |
|------|--------------|
| `src/scheduler.ts` | added `alwaysJob` helper; poll-vault uses it |
| `src/agent/tools/calendar.ts` | added `getEventsInRange` + `getEventsForDate` |
| `src/agent/tools/asana.ts` | added `getMyTasks` |
| `src/agent/tools/obsidian.ts` | added `vaultDeleteNote` (earlier this session) |
| `src/agent/agent.ts` | registered 3 new tools, "Tool honesty" prompt, dynamic date injection |
| `src/sources/obsidian.ts` | `commitAndPush(op, path, content)` now handles delete |
| `src/jobs/poll-vault.ts` | delete op reconciles cache; step 5 safety net for bagel-processed |
| `supabase/migrations/004_obsidian_delete_op.sql` | allows 'delete' op, content nullable |

## Decisions logged

| Decision | Rationale |
|----------|-----------|
| poll-vault 24/7, other jobs stay gated | Vault capture shouldn't wait until Monday; meetings/nudges/digests are human rhythm |
| Inject today's date into system prompt on every invocation | SYSTEM_PROMPT is a const — would stay stuck at VM boot date otherwise |
| Safety net writes directly to disk (not via queue) | Must take effect in the same poll-vault cycle; queued write wouldn't commit until next cycle, re-triage still fires |
| psql for migration instead of `supabase db push` | CLI 2.39.2 has a pooler-auth quirk; psql works with same password |

## Gotchas for next session

- Running poll-vault manually triggers DMs to Tod. To test without spamming, write a one-off that skips step 3 (agent invocation) or directly tests lower layers.
- `enqueueObsidianWrite` for `'delete'` op MUST pass `null` content, not empty string (the CHECK constraint allows null but not empty-content semantics).
- If you manually modify the vault's frontmatter, push BEFORE the next poll-vault cycle or the race will cause a stale re-parse.
- CLI pooler auth fails with correct password on Supabase CLI 2.39.2 — fall back to psql directly if `supabase db push` refuses to connect.
