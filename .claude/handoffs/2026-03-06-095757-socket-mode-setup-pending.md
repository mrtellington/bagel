# Handoff: Bagel Socket Mode — Code Complete, Awaiting Slack Token

## Session Metadata
- Created: 2026-03-06 09:57:57
- Project: /Users/todellington/bagel
- Branch: main
- Session duration: ~2 hours

### Recent Commits (for context)
  - c8e8248 feat: start Socket Mode on boot alongside existing cron jobs
  - 44d93ca feat: add Socket Mode handler for DMs and thread replies
  - 306f058 feat: add searchMeetings tool for ad-hoc DM queries
  - 63831b9 feat: add @slack/socket-mode dependency and config
  - 3dfd4bc chore: add .worktrees/ to gitignore

## Handoff Chain

- **Continues from**: [2026-03-02-210138-bagel-v2-implementation-complete.md](./2026-03-02-210138-bagel-v2-implementation-complete.md)
  - Previous title: Bagel v2 Agent — Implementation Complete, Ready for Deployment
- **Supersedes**: None

## Current State Summary

All Socket Mode code has been implemented and merged to `main`. The Bagel bot can now receive real-time Slack DMs and thread replies via a persistent WebSocket connection. The only remaining blocker is a manual step: Tod must generate an app-level token (`xapp-1-...`) in the Slack app dashboard, add it to `.env` and the VM `.env`, then do a smoke test and VM deployment. No code changes are needed — this is purely a configuration and deployment task.

## Architecture Overview

- **Entry point**: `src/index.ts` — starts scheduler (cron jobs) AND Socket Mode on boot
- **Socket Mode handler**: `src/socket-mode.ts` — handles incoming DMs and thread replies in real time via WebSocket
- **Agent**: `src/agent/agent.ts` — `invokeAgent(prompt)` using Claude Agent SDK with `claude-sonnet-4-6`, max 20 turns
- **Tools**: `src/agent/tools/` — slack.ts, asana.ts, calendar.ts, supabase.ts
- **Scheduler**: `src/scheduler.ts` — 5 cron jobs (poll-meetings, poll-threads, nudge, morning-briefing, eod-digest), all unchanged
- **Config**: `src/config.ts` — all env vars; `slackAppToken` is `required()` so service won't start without it

## Critical Files

| File | Purpose | Relevance |
|------|---------|-----------|
| `src/socket-mode.ts` | New file — real-time DM/thread handler | Core of this feature |
| `src/config.ts` | Env var config | Contains new `slackAppToken` field |
| `src/agent/tools/supabase.ts` | DB helpers | Contains new `searchMeetings()` function |
| `src/agent/agent.ts` | Agent + tool registry | Contains new `db_search_meetings` tool |
| `.env` | Local secrets | Needs `SLACK_APP_TOKEN=xapp-1-...` added |

## Files Modified

| File | Changes | Rationale |
|------|---------|-----------|
| `package.json` | Added `@slack/socket-mode` | Socket Mode WebSocket client |
| `src/config.ts` | Added `slackAppToken: required("SLACK_APP_TOKEN")` | New env var |
| `.env.example` | Added `SLACK_APP_TOKEN=` line | Documentation |
| `src/agent/tools/supabase.ts` | Added `searchMeetings()` | Agent needs to search past meetings for DM queries |
| `src/agent/agent.ts` | Added `dbSearchMeetings` tool + registered it | Exposes `db_search_meetings` to agent |
| `src/socket-mode.ts` | Created new file | Core Socket Mode handler |
| `src/index.ts` | Added `startSocketMode()` call | Start WebSocket on boot |
| `.gitignore` | Added `.worktrees/` | Prevent worktree contents from being committed |

## Decisions Made

| Decision | Options Considered | Rationale |
|----------|-------------------|-----------|
| Socket Mode over Events API | Events API (requires public URL), Socket Mode (WebSocket) | VM has no public URL; Socket Mode connects outbound |
| Filter DMs to Tod's user ID only | Process all DMs | Only Tod uses this bot; prevents accidental processing |
| Dedup via `thread_replies` table | Lock table, flag on action_items | Already exists in codebase; same pattern as poll-threads cron |
| `searchMeetings` uses `ilike` | Full-text search (`to_tsvector`) | Low volume, simple title matching is sufficient |

## Immediate Next Steps

1. **Complete Slack app prerequisites** (manual, in browser at https://api.slack.com/apps/A0ACT45NCGP):
   - Basic Information → App-Level Tokens → Generate token with `connections:write` scope → copy `xapp-1-...` token
   - Socket Mode (sidebar) → Toggle ON
   - Event Subscriptions → Toggle ON → Add bot event: `message.im` → Save
   - App Home → Check "Allow users to send Slash commands and messages from the messages tab"

2. **Add token to local `.env`**: `SLACK_APP_TOKEN=xapp-1-...`

3. **Smoke test locally**: `npx tsc && node dist/index.js`
   - Expected output: `[socket-mode] Connected — listening for DMs`
   - Test by DMing the Bagel bot in Slack

4. **Deploy to VM**:
   ```bash
   npx tsc
   tar czf /tmp/bagel-update.tar.gz dist/ package.json package-lock.json
   gcloud compute scp --zone=us-east1-b /tmp/bagel-update.tar.gz bagel-vm:/tmp/
   gcloud compute ssh bagel-vm --zone=us-east1-b --command="cd /opt/bagel && sudo -u bagel tar xzf /tmp/bagel-update.tar.gz && sudo -u bagel npm ci --omit=dev && sudo systemctl restart bagel && sleep 3 && sudo systemctl status bagel --no-pager"
   ```

5. **Add token to VM .env**:
   ```bash
   gcloud compute ssh bagel-vm --zone=us-east1-b --command="echo 'SLACK_APP_TOKEN=xapp-1-...' | sudo tee -a /opt/bagel/.env && sudo chmod 600 /opt/bagel/.env && sudo chown bagel:bagel /opt/bagel/.env && sudo systemctl restart bagel"
   ```

6. **Verify VM logs**: `gcloud compute ssh bagel-vm --zone=us-east1-b --command="sudo journalctl -u bagel -n 20 --no-pager"`

## Important Context

The code is done and on `main` — do not re-implement anything. The only work left is Slack dashboard config + adding the token to `.env` files. The service will crash on startup without `SLACK_APP_TOKEN` because `config.ts` uses `required()` which throws if the env var is missing — this is intentional. VM deployment uses the tarball pattern (avoids the `dist/dist/index.js` nesting bug that occurred previously with direct directory copies). The VM service runs as the `bagel` user at `/opt/bagel/`, managed by systemd `bagel.service`. GCP VM is `bagel-vm` in zone `us-east1-b`. Tod purchased $100 Claude API credit; runtime uses `claude-sonnet-4-6` (~$0.50–$0.80/day at normal usage).

## Assumptions Made

- The Slack app (A0ACT45NCGP) is already installed in the workspace and has bot token permissions
- `message.im` events will only fire for DMs in Tod's DM channel with the bot
- The `thread_replies` Supabase table already exists (created in the v2 migration)
- GCP CLI (`gcloud`) is configured and authenticated on the local machine

## Potential Gotchas

- **Don't copy the whole repo to VM** — `.env` is gitignored locally but must be manually managed on the VM via the `tee -a` command shown above
- **VM npm install**: After copying `package.json` + `package-lock.json`, run `npm ci --omit=dev` (not `npm install`) for reproducible installs
- **Channel ID filter**: `src/socket-mode.ts` checks `event.channel !== config.slackChannelId`. The `SLACK_CHANNEL_ID` env var (default `D0AD2PW9GAX`) is Tod's DM channel — verify this is correct if DMs aren't being processed
- **Socket Mode auto-reconnects**: `SocketModeClient` has `autoReconnectEnabled: true` by default — no special restart handling needed for connection drops

## Blockers

- **Slack app-level token not yet generated** — Tod must complete the 4 Slack dashboard steps before the service can start

## Environment Variables

- `SLACK_BOT_TOKEN` — existing, already set everywhere
- `SLACK_APP_TOKEN` — **NEW, must be added** to both local `.env` and VM `/opt/bagel/.env`
- All others (`ANTHROPIC_API_KEY`, `ASANA_PAT`, `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, etc.) — unchanged

---

**Security Reminder**: Before finalizing, run `validate_handoff.py` to check for accidental secret exposure.
