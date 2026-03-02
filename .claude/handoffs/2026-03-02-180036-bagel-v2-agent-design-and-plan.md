# Handoff: Bagel v2 — Agent Design & Implementation Plan Complete

## Session Metadata
- Created: 2026-03-02 18:00:36
- Project: /Users/todellington/bagel
- Branch: main
- Session duration: ~2 hours (design brainstorming + implementation plan writing)

### Recent Commits (for context)
  - d7403ef Add Bagel v2 18-task implementation plan
  - 3c3e32f Add Bagel v2 agent design document
  - c2b2672 Add Phase 1 handoff document

## Handoff Chain

- **Continues from**: `.claude/handoffs/2026-02-07-213610-bagel-phase1-supabase-edge-functions.md`
- **Supersedes**: The Phase 1 Supabase Edge Functions approach — replaced with Claude Agent SDK architecture

> The Phase 1 plan (Supabase Edge Functions) was never implemented. This session redesigned the entire system using the Claude Agent SDK with a TypeScript service, keeping Supabase only for state/database. The new design is a fully automated agent that polls for meetings, extracts action items via Claude, triages via Slack thread replies, and manages Asana tasks.

## Current State Summary

This session completed the full brainstorming → design → implementation plan cycle for Bagel v2. The design document (`docs/plans/2026-03-02-bagel-agent-design.md`) and 18-task implementation plan (`docs/plans/2026-03-02-bagel-implementation-plan.md`) are both committed. **No implementation code has been written yet.** The user was offered execution options (subagent-driven vs parallel session) and chose to save a handoff before deciding. The next agent should read both plan documents and begin implementation.

## Codebase Understanding

### Architecture Overview

**Bagel v2 Architecture:**
```
Granola MCP Bridge (cron) → Supabase DB ← Agent Service (Node.js)
                                              ↓
                              Claude Agent SDK (query() with tools)
                                    ↓                    ↓
                              Slack Web API         Asana REST API
                                    ↓
                            Google Calendar API
```

Three main loops running on node-cron:
1. **Poll Meetings** (every 2 min) — check Supabase for unprocessed meetings, invoke agent to extract items + post Slack
2. **Poll Threads** (every 30 sec) — check Slack thread replies for triage commands, invoke agent to interpret + act
3. **Nudge** (every 15 min) — check pending items, respect calendar, send reminders

Plus two scheduled daily jobs:
- **Morning Briefing** (8:55 AM ET) — carry-forward items + today's calendar
- **EOD Digest** (5:45 PM ET) — today's stats, open items

**Key design decision**: Granola API is Enterprise-only, so a "bridge" pattern is used — a Claude CLI cron job runs locally (or on the GCP VM), polls the Granola MCP, and writes new meetings into Supabase. The main agent service then reads from Supabase.

### Critical Files

| File | Purpose | Relevance |
|------|---------|-----------|
| `docs/plans/2026-03-02-bagel-agent-design.md` | Full architecture design doc | **READ FIRST** — covers architecture, data flow, Slack UX, calendar, deployment, database schema |
| `docs/plans/2026-03-02-bagel-implementation-plan.md` | 18-task step-by-step implementation plan | **READ SECOND** — has complete code for every file, exact commands, test steps |
| `/Users/todellington/docs/plans/config-values.md` | All service credentials, IDs, GIDs, tokens | **REFERENCE** — has every API key and ID needed (Supabase, Slack, Asana, etc.) |
| `.claude/handoffs/2026-02-07-213610-bagel-phase1-supabase-edge-functions.md` | Prior Phase 1 handoff (superseded) | Historical context only — approach was replaced |

### Key Patterns Discovered

- **Granola MCP tools available**: `list_meetings`, `get_meetings`, `get_meeting_transcript`, `query_granola_meetings` — cloud connectors via Claude, no direct API
- **Granola MCP has no webhooks or push** — must poll and deduplicate by `external_id`
- **Slack "Bagel" is an app** with DM channel `D0AD2PW9GAX`, bot user ID `U0AD6H624F8`
- **Triage via Slack thread replies** — user types natural language like "own 1,3 — delegate 2 to karie — park 4" and the agent interprets
- **Message rebuild strategy** — on every triage action, the agent rebuilds the entire Slack message from Supabase state (avoids stale data)
- **External participant detection** — agent flags non-Whitestone attendees (e.g., Emily Myers from PrintForce), suggests internal owner for follow-up
- **Existing Asana task matching** — agent searches Asana before creating duplicates, can merge or add comments
- **Business hours gate** — all jobs run M-F 9 AM – 6 PM ET only
- **Source plugin interface** — designed for future extensibility (email, Slack messages as sources)
- **Supabase project shared** with `alteryx-newhire-swag` — same project ID `ejaxcfnnavjsajdepfkw`

## Work Completed

### Tasks Finished

- [x] Explored existing project context (prior handoff, config values, n8n workflows)
- [x] Tested all 4 Granola MCP tools to verify data access
- [x] Identified Slack "Bagel" channel and bot identity
- [x] Evaluated 3 architecture approaches (TypeScript service, Agent SDK, Supabase Edge Functions)
- [x] Designed full architecture with user through 5 iterative sections
- [x] Wrote and committed design document (`docs/plans/2026-03-02-bagel-agent-design.md`)
- [x] Researched Claude Agent SDK TypeScript API (npm, GitHub, official docs)
- [x] Wrote and committed 18-task implementation plan (`docs/plans/2026-03-02-bagel-implementation-plan.md`)

### Files Created

| File | Changes | Rationale |
|------|---------|-----------|
| `docs/plans/2026-03-02-bagel-agent-design.md` | New — full design document | Captures architecture, UX, deployment, schema decisions |
| `docs/plans/2026-03-02-bagel-implementation-plan.md` | New — 18-task implementation plan | Step-by-step with complete code, commands, and test steps |

### Decisions Made

| Decision | Options Considered | Rationale |
|----------|-------------------|-----------|
| Claude Agent SDK Hybrid over plain TypeScript | (A) Direct TypeScript APIs, (B) Agent SDK, (C) Supabase Edge Functions | Agent SDK gives Claude reasoning for triage interpretation + extensibility; direct APIs for integrations (Slack/Asana/Calendar) avoid MCP overhead |
| Slack thread replies for triage | Buttons, conversational DM, thread replies, agent-decides | Thread replies allow natural language commands, no modal complexity, keeps conversation contextual |
| Granola MCP bridge pattern | Direct API, MCP bridge, polling | Granola API is Enterprise-only; bridge uses Claude CLI to poll MCP and write to Supabase |
| GCP Compute Engine deployment | Local Mac, Cloud Run, GCE, Fly.io | User is GCP admin, prefers Google products; GCE runs persistent service + cron easily |
| Keep Supabase for database | Migrate to Cloud SQL, keep Supabase | Supabase already has tables + RLS set up, no benefit to migrating |
| Slack-first (no frontend) for V1 | Slack-only, custom frontend, hybrid | Zero friction — user already in Slack between meetings; frontend can come later |

## Pending Work

## Immediate Next Steps

1. **Choose execution approach**: Subagent-driven (current session) or parallel session with `executing-plans` skill
2. **Execute Task 1**: Project scaffolding — `npm init`, install dependencies, create `tsconfig.json`, project structure
3. **Execute Task 2**: Database migration — add triage columns and `thread_replies` table to Supabase
4. **Execute Tasks 3-7**: Build all API wrapper modules (config, Supabase client, Slack, Asana, Calendar)
5. **Execute Tasks 8-13**: Build agent tools, agent module, and all scheduler jobs
6. **Execute Tasks 14-18**: Scheduler, entry point, bridge script, deployment infra, integration tests

### Blockers/Open Questions

- [ ] **Anthropic API key** — needed as environment variable for the agent; currently only in n8n credentials. User needs to provide or retrieve it.
- [ ] **Google Calendar service account** — needs to be created in GCP console and JSON key generated. Plan Task 7 covers setup but requires user to do GCP console steps.
- [ ] **GCP VM setup** — Task 17 covers infrastructure scripts but actual provisioning requires user's GCP project access.
- [ ] **`supabase link` may prompt for database password** — user may need to provide it during Task 2.

### Deferred Items

- Frontend agent interface — user wants Slack-first for V1, frontend later as Bagel evolves into "executive assistant"
- Email source plugin — architecture supports it but not in V1 scope
- Slack message source plugin — same, future scope
- n8n workflow deactivation — only after new agent is fully tested and verified
- Zapier webhook URL update — only after granola-intake equivalent is working

## Context for Resuming Agent

## Important Context

1. **READ THE IMPLEMENTATION PLAN FIRST**: `docs/plans/2026-03-02-bagel-implementation-plan.md` — it contains complete code for every file, exact shell commands, and test steps for all 18 tasks. The plan header says to use `superpowers:executing-plans` skill.

2. **READ THE DESIGN DOC**: `docs/plans/2026-03-02-bagel-agent-design.md` — it has the full architecture, database schema, Slack message format, triage grammar, and project structure.

3. **Credentials are in**: `/Users/todellington/docs/plans/config-values.md` — all Supabase, Slack, Asana IDs and tokens. **Do not hardcode secrets** — use environment variables loaded from `.env` (local) or GCP Secret Manager (production).

4. **Claude Agent SDK**: The TypeScript SDK is `@anthropic-ai/claude-agent-sdk` on npm. Key functions: `query()` to invoke the agent, `tool()` to define tools with Zod schemas, `createSdkMcpServer()` for optional MCP server exposure. The plan uses `query()` with `model: "sonnet"` and `bypassPermissions: true`.

5. **Supabase tables already exist**: `sources`, `meetings`, `action_items` are in the database. The migration (Task 2) only ADDS columns — `slack_message_ts`, `slack_channel_id`, `topics`, `triage_status` to meetings; `name`, `priority`, `suggested_due_date`, `triage_action`, `assigned_to`, `asana_gid` to action_items. Plus a new `thread_replies` table.

6. **Slack app "Bagel"** is already installed in Whitestone workspace with `chat:write`, `im:write`, `users:read` scopes. It needs `channels:history` or `im:history` scope added for reading thread replies (the plan notes this in Task 5).

7. **The user goes back-to-back in meetings** — the nudge system and morning briefing are core features, not nice-to-haves.

8. **External participants** (non-Whitestone people) — the agent must flag these in action items and suggest an internal Whitestone owner for delegation.

9. **Existing Asana task matching** — before creating a new Asana task, the agent should search for similar existing tasks and offer to merge/comment instead of duplicate.

10. **Three main scheduler loops**: poll-meetings (2 min), poll-threads (30 sec), nudge (15 min) — all gated by business hours (M-F 9 AM – 6 PM ET). Plus morning-briefing (8:55 AM) and eod-digest (5:45 PM).

### Assumptions Made

- Claude Agent SDK TypeScript package is available on npm as `@anthropic-ai/claude-agent-sdk`
- The `query()` function accepts tool definitions created with `tool()` and returns agent responses
- Slack Web API `@slack/web-api` v7 supports `conversations.replies` for reading thread replies
- Google Calendar API can be accessed via service account (no OAuth flow needed)
- Supabase project can be linked from `~/bagel` alongside the existing `alteryx-newhire-swag` project
- GCP Compute Engine e2-small (~$13/mo) has enough resources for the Node.js agent + cron

### Potential Gotchas

- **Claude Agent SDK is relatively new** — the plan's API usage is based on research of docs/npm but may need adjustment if the actual SDK differs
- **Granola MCP bridge** requires Claude CLI to be installed and authenticated on the deployment VM — this is non-trivial for GCP
- **Slack scope changes** may require app reinstall in the workspace
- **Supabase CLI version** is v2.39.2 (outdated, v2.75.0 available) — may need update
- **Deno vs Node.js**: The old Phase 1 plan used Supabase Edge Functions (Deno). The new plan is pure Node.js/TypeScript — don't confuse the two
- **Rate limits**: Slack API has rate limits (~1 req/sec for posting). The poll-threads job running every 30 sec needs to be efficient
- **Business hours timezone**: All scheduling uses America/New_York — this is hardcoded in the scheduler

## Environment State

### Tools/Services Used

| Tool/Service | Identifier | Status |
|------|--------|--------|
| Supabase | Project `ejaxcfnnavjsajdepfkw` | Active, tables exist |
| Supabase CLI | v2.39.2 | Installed (may need update) |
| Slack App "Bagel" | App ID `A0ACT45NCGP` | Installed, interactivity enabled |
| Zapier Zap | `347428399` | LIVE, pointing to n8n (don't change yet) |
| n8n Meeting Intake | Workflow `xE1wftiN4UYKsfzU` | Active (keep running until switchover) |
| n8n Slack Action Handler | Workflow `a8jEkq30GFAjOTNd` | Active (keep running until switchover) |
| Asana Task Triage | Project `1212738213310157` | Ready |
| Granola MCP | Cloud connector | Available, tested all 4 tools |
| Google Calendar | Not yet configured | Needs service account setup |

### Active Processes

- Zapier Zap 347428399 is LIVE and sending to n8n (don't change until new agent is tested)
- Both n8n workflows are ACTIVE (keep running until switchover)
- No new processes started in this session

### Environment Variables (Names Only)

Required for the agent (to be set in `.env` and GCP Secret Manager):
- `ANTHROPIC_API_KEY`
- `SLACK_BOT_TOKEN`
- `ASANA_PAT`
- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`
- `GOOGLE_CALENDAR_CREDENTIALS` (service account JSON)
- `SLACK_CHANNEL_ID`
- `ASANA_WORKSPACE_GID`
- `ASANA_PROJECT_GID`
- `ASANA_BACKLOG_SECTION_GID`
- `GRANOLA_SOURCE_UUID`
- `TOD_SLACK_USER_ID`

## Related Resources

- **Design Document**: `docs/plans/2026-03-02-bagel-agent-design.md` (committed)
- **Implementation Plan**: `docs/plans/2026-03-02-bagel-implementation-plan.md` (committed)
- **Config Values**: `/Users/todellington/docs/plans/config-values.md`
- **Prior Phase 1 Handoff**: `.claude/handoffs/2026-02-07-213610-bagel-phase1-supabase-edge-functions.md` (superseded)
- **Slack App Dashboard**: https://api.slack.com/apps/A0ACT45NCGP
- **Asana Task Triage**: https://app.asana.com/1/1201405786124364/project/1212738213310157/list
- **Claude Agent SDK (npm)**: https://www.npmjs.com/package/@anthropic-ai/claude-agent-sdk
- **Claude Agent SDK (docs)**: https://docs.anthropic.com/en/docs/agents/agent-sdk

---

**Security Reminder**: `config-values.md` contains actual tokens/keys. Never commit it to the bagel repo. Use environment variables only.
