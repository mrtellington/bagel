# Handoff: Obsidian Brain — Code Complete, Awaiting Migration + Plugins

## Session Metadata
- Created: 2026-04-17
- Project: /Users/todellington/bagel
- Branch: feat/obsidian-brain (8 commits ahead of main)
- Session duration: ~3 hours (across 2026-04-10 to 2026-04-17)

### Recent Commits (for context)
  - e4a5778 feat: wire poll-vault cron, URL detection in DMs, vault startup log
  - 3736c4d feat: add poll-vault cron job — sync, inbox triage, queue flush
  - 2614e34 feat: register vault tools and add Obsidian system prompt to agent
  - 445b732 feat: add Obsidian vault tool handlers — search, create, update, list
  - 8c9e5f4 feat: add Supabase helpers for obsidian_notes and obsidian_queue
  - 73eb832 feat: add Obsidian vault source — git pull, markdown parser, inbox detection
  - 10b4ef9 feat: add Obsidian repo URL and local path config
  - 5a690cb feat: add obsidian_notes and obsidian_queue tables (migration 003)

## Handoff Chain

- **Continues from**: [2026-03-06-095757-socket-mode-setup-pending.md](./2026-03-06-095757-socket-mode-setup-pending.md)
  - Previous title: Bagel Socket Mode — Code Complete, Awaiting Slack Token
  - Socket Mode was activated during this session (SLACK_APP_TOKEN configured)
- **Supersedes**: None

## Current State Summary

Obsidian Brain is fully operational end-to-end as of 2026-04-19. Migration 003 applied, Obsidian plugins installed (obsidian-git + Dataview + Templater + Web Clipper), full round-trip smoke test passed: Web Clipper → GitHub → VM pull → Supabase sync → agent triage → Slack DM → "file it" reply → file moved on GitHub. During the smoke test a **product bug** was found and fixed: the agent was claiming "filed/moved" but only calling `vault_create_note`, leaving the original in `00-inbox/` (no `vault_delete_note` tool existed). Added `vault_delete_note`, migration 004 (allows `'delete'` op in queue + nullable content), updated `commitAndPush` to handle deletes via `git rm`, updated poll-vault to reconcile the Supabase cache on delete, and updated the system prompt so "file it" performs a two-step create+delete. Deployed to VM and validated with a one-shot cleanup that moved the smoke-test article from `00-inbox` to `10-articles` and cleared the stale Supabase row.

## What Was Built

### Obsidian Brain Integration
Git-backed Obsidian vault (`mrtellington/bagel-brain`, private) as Bagel's long-term knowledge brain. The vault syncs to the VM via Git. Articles captured via Obsidian Web Clipper or Slack DMs land in an inbox, Bagel proactively surfaces them in Slack for triage, and the full vault is searchable from any Slack DM.

### Architecture
```
YOUR MAC                    GITHUB                    GCP VM (bagel-vm)
──────────                  ──────                    ─────────────────
Obsidian app
  + obsidian-git ──push──→  mrtellington/bagel-brain ──pull──→ poll-vault (every 5 min)
  + Web Clipper                        ↑                              ↓
                                 ←─commit──────────────────── Bagel writes notes
                                                                      ↓
SLACK                                                         Supabase (cache)
  ↕ Socket Mode ←───────────────────────────────────────────── Bagel DMs you
```

### Vault Structure (at /Users/todellington/Documents/Obsidian)
```
00-inbox/       ← new captures land here
10-articles/    ← processed articles
20-meetings/    ← meeting notes from Granola
30-projects/    ← project notes
40-people/      ← contact notes
50-reference/   ← evergreen reference material
templates/      ← note templates
```

## Architecture Overview

- **Entry point**: `src/index.ts` — starts scheduler + Socket Mode, now logs vault name
- **Obsidian source**: `src/sources/obsidian.ts` — git pull/push, markdown+frontmatter parsing, vault walking
- **Vault tools**: `src/agent/tools/obsidian.ts` — vaultSearch, vaultCreateNote, vaultUpdateNote, vaultListRecent
- **Supabase helpers**: `src/agent/tools/supabase.ts` — 8 new obsidian-specific functions appended
- **Agent**: `src/agent/agent.ts` — 4 new vault tools registered, system prompt updated with Obsidian context
- **Poll-vault job**: `src/jobs/poll-vault.ts` — cron every 5 min: pull, sync to Supabase, process inbox, flush write queue
- **Scheduler**: `src/scheduler.ts` — poll-vault added alongside existing jobs
- **Socket Mode**: `src/socket-mode.ts` — URL detection in DMs routes to vault capture flow

## Critical Files

| File | Purpose | Relevance |
|------|---------|-----------|
| `src/sources/obsidian.ts` | New file — git ops, markdown parser, inbox detection | Core vault module |
| `src/agent/tools/obsidian.ts` | New file — vault tool handlers | Agent uses these for vault ops |
| `src/jobs/poll-vault.ts` | New file — cron job for vault sync + inbox triage | Proactive processing |
| `src/agent/tools/supabase.ts` | Modified — added 8 obsidian helper functions | Data layer |
| `src/agent/agent.ts` | Modified — 4 tools + system prompt update | Agent integration |
| `src/socket-mode.ts` | Modified — URL detection in handleDirectMessage | Slack DM capture flow |
| `src/scheduler.ts` | Modified — added poll-vault cron | Job scheduling |
| `src/config.ts` | Modified — added obsidianRepoUrl, obsidianLocalPath | Config |
| `supabase/migrations/003_obsidian_brain.sql` | New file — obsidian_notes + obsidian_queue tables | **MUST RUN** |

## Decisions Made

| Decision | Options Considered | Rationale |
|----------|-------------------|-----------|
| Git-backed vault (not Local REST API) | REST API bridge, file watcher, MCP, Git | Tod wanted nothing running on his Mac; Git + obsidian-git plugin = zero local services |
| Supabase as cache only | Supabase as source of truth | Vault is source of truth; Supabase is rebuilable cache. Adding new sources later = no schema changes |
| Write queue pattern | Direct git commits from agent | Decouples agent response time from git commit latency; retries on failure |
| execFileSync over execSync | execSync (shell), execFileSync (no shell) | Security: execFileSync avoids shell injection by passing args as array |
| Standalone module (not Source interface) | Implement Source interface | ObsidianNote doesn't have participants/transcripts; forcing Source would be awkward |
| URL detection heuristic in Socket Mode | Always capture URLs, never capture URLs | Detects "save"/"clip"/"capture" keywords or URL-only messages; falls through to normal DM handler otherwise |

## Immediate Next Steps

### 1. Run Supabase migration ✅ DONE (2026-04-19)

Applied via `PGPASSWORD='…' psql … -f supabase/migrations/003_obsidian_brain.sql` against project `ejaxcfnnavjsajdepfkw` (meeting-actions). Both tables verified via REST. Not recorded in `supabase_migrations.schema_migrations` — if using `supabase db push` in future, run `supabase migration repair --status applied 003` first.

### 2. Install Obsidian plugins ✅ DONE (2026-04-19)

Installed obsidian-git (Vinzent), Dataview, Templater, Web Clipper. Registry renamed obsidian-git to just "Git" — search by author "Vinzent" to find it. Web Clipper configured with vault `Obsidian`, default folder `00-inbox` on Default template.

### 3. vault_delete_note tool + move semantics ✅ DONE (2026-04-19)

Smoke test revealed the agent hallucinated "moved" when filing — only create existed, no delete tool. Added:
- Migration `004_obsidian_delete_op.sql` (CHECK constraint allows `'delete'`; `content` nullable)
- `vault.vaultDeleteNote` + `vault_delete_note` tool in agent
- `commitAndPush(operation, filePath, content)` — `delete` does `git rm`, else write+add
- `poll-vault.ts` step 4 reconciles Supabase `obsidian_notes` cache on delete
- System prompt: "file it" must call both `vault_create_note` AND `vault_delete_note`

### — Legacy step 2 (plugin install) details, kept for reference —

In Obsidian app → Settings → Community plugins → Browse:

1. **Obsidian Git** — Install + Enable
   - Settings: Auto push interval: 5 min, Auto pull interval: 5 min
   - Commit message: `vault: {{date}} auto`

2. **Dataview** — Install + Enable
   - Settings: Enable JavaScript Queries: ON

3. **Templater** — Install + Enable
   - Settings: Template folder location: `templates`

4. **Obsidian Web Clipper** — browser extension from Chrome Web Store
   - Configure to save to `00-inbox` folder

### 3. Merge feature branch ✅ DONE

PR #1 merged to main (commit 8e6b95b).

### 4. Smoke test (Task 11 from plan)

1. DM Bagel: "save this https://www.linkedin.com/pulse/how-i-built-my-ai-chief-staff-zapier-sdk-wade-foster-rudbc/"
2. DM Bagel: "what do I know about AI agents?"
3. Clip an article with Web Clipper, wait 10 min for Bagel to surface it
4. Reply to Bagel's triage message in thread

## Also Completed This Session

- **Socket Mode activated** — generated SLACK_APP_TOKEN, configured Slack app dashboard (Socket Mode ON, Event Subscriptions with message.im, App Home messages tab enabled)
- **SLACK_APP_TOKEN** added to both local `.env` and VM `/opt/bagel/.env`
- **Local smoke test** passed — `[socket-mode] Connected — listening for DMs`
- **GitHub repo created** — `mrtellington/bagel-brain` (private), deploy key added with write access
- **VM vault cloned** — `/opt/bagel/vault` contains the scaffolded vault
- **GCP project identified** — `requests-9d412` (was previously using wrong project `n8n-todproject`)

## Environment Variables

**New (added this session):**
- `SLACK_APP_TOKEN` — App-level token for Socket Mode (added to both local and VM)
- `OBSIDIAN_REPO_URL` — `git@github.com:mrtellington/bagel-brain.git` (added to both local and VM)
- `OBSIDIAN_LOCAL_PATH` — `/opt/bagel/vault` on VM, not set locally (defaults used)

**Existing (unchanged):**
- `ANTHROPIC_API_KEY`, `SLACK_BOT_TOKEN`, `ASANA_PAT`, `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `GOOGLE_CALENDAR_SA_KEY_BASE64`

## Potential Gotchas

- **Supabase migration must run before restart** — poll-vault will fail silently if the tables don't exist (Supabase queries return errors, caught by try/catch)
- **obsidian-git must be installed** — without it, the vault never pushes to GitHub, and Bagel never sees new notes
- **VM deploy key is write-enabled** — required for Bagel to commit back to the repo. The key is at `/home/bagel/.ssh/id_ed25519`
- **Git conflicts** — Bagel writes to `00-inbox/` with timestamped filenames; user edits happen in other folders after filing. Collision surface is near zero.
- **Business hours guard** — poll-vault only runs M-F 9am-6pm ET (same as all other jobs). Notes clipped outside hours will be processed next business day morning.
- **The `feat/obsidian-brain` branch is deployed to the VM but not yet merged to main** — merge before next deployment

## Design Documents

- Spec: `docs/superpowers/specs/2026-04-16-obsidian-brain-design.md`
- Implementation plan: `docs/superpowers/plans/2026-04-16-obsidian-brain.md`

## Blockers

None — feature is fully operational.

## Future Phases (Out of Scope)

- Gmail → Obsidian pipeline
- Slack channel scanning → Obsidian
- AI-powered auto-linking (Smart Connections plugin)
- Obsidian graph visualization in Slack
- Daily knowledge digest from vault

---

**Security Reminder**: Before finalizing, run `validate_handoff.py` to check for accidental secret exposure.
