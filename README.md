# Bagel

> Automated executive assistant that extracts action items from meetings, routes them to Slack for triage, and creates Asana tasks — so nothing falls through the cracks.

---

## What It Does

Bagel watches your Granola AI meeting notes, extracts action items using Claude, and posts them to your Slack DM for quick triage. You reply in-thread with natural language ("own 1,3 — delegate 2 to karie — park 4"), and Bagel creates the Asana tasks, assigns them, and confirms. It also nudges you on unaddressed items and sends a morning briefing + end-of-day digest.

You can also DM the Bagel bot directly to ask questions like: "What did I commit to in my meeting with Ryan last week?"

**Vision:** Evolves into a chief-of-staff agent across all communication channels (email, Slack messages, calendar) — not just meetings.

---

## Current Status

> **As of 2026-03-07**

| Component | Status |
|-----------|--------|
| Full agent implementation (Tasks 1-16) | Complete — committed to `main` |
| Socket Mode DM handler | Complete — committed to `main` |
| GCP VM deployment (`bagel-vm`) | Running — `us-east1-b` |
| Granola MCP bridge cron | Running on VM |
| Cron scheduler (5 jobs) | Running |
| **Socket Mode activation** | **BLOCKED** — needs `SLACK_APP_TOKEN` |

### Only Remaining Blocker

Tod must complete these steps in the [Slack app dashboard](https://api.slack.com/apps/A0ACT45NCGP):

1. **Basic Information > App-Level Tokens** — Generate token with `connections:write` scope, copy the `xapp-1-...` value
2. **Socket Mode** (sidebar) — Toggle ON
3. **Event Subscriptions** — Toggle ON, add bot event `message.im`, Save
4. **App Home** — Enable "Allow users to send Slash commands and messages from the messages tab"

Then add the token to `.env` and the VM:

```bash
# Local .env
SLACK_APP_TOKEN=xapp-1-...

# VM
gcloud compute ssh bagel-vm --zone=us-east1-b --command="echo 'SLACK_APP_TOKEN=xapp-1-...' | sudo tee -a /opt/bagel/.env && sudo chmod 600 /opt/bagel/.env && sudo chown bagel:bagel /opt/bagel/.env && sudo systemctl restart bagel"
```

Full deployment steps: [`.claude/handoffs/2026-03-06-095757-socket-mode-setup-pending.md`](.claude/handoffs/2026-03-06-095757-socket-mode-setup-pending.md)

---

## Architecture

```
GCP COMPUTE ENGINE (bagel-vm, e2-small, us-east1-b)
+-----------------------------------------------------+
|                                                      |
|  GRANOLA MCP BRIDGE              BAGEL AGENT SERVICE |
|  +------------------+           +------------------+ |
|  | Claude Code CLI   |  writes   | Node.js / TS     | |
|  | (authed + cron)   |---------->| Claude Agent SDK | |
|  |                   | Supabase  |                  | |
|  | Granola MCP:      |           | Direct APIs:     | |
|  | - list_meetings   |           | - Slack (bot)    | |
|  | - get_meetings    |           | - Asana (PAT)    | |
|  | - get_transcript  |           | - Calendar (SA)  | |
|  |                   |           | - Supabase       | |
|  | Every 5 min       |           | - Anthropic      | |
|  | M-F 9a-6p ET      |           |                  | |
|  +------------------+           +------------------+ |
|                                                      |
|  systemd . Cloud Logging . Secret Manager            |
+-----------------------------------------------------+
         |              |              |
    +----+----+    +----+---+    +----+---+
    |Supabase |    | Slack  |    | Asana  |
    |(state)  |    |(Bagel) |    |(tasks) |
    +---------+    +--------+    +--------+
```

### Two components on one VM

**1. Granola MCP Bridge** — A cron job that invokes the `claude` CLI every 5 min to poll Granola via MCP tools and write new meetings to Supabase. Granola's API is Enterprise-only; the MCP connector (authenticated through the Claude account) is the only data access path.

**2. Bagel Agent Service** — A Node.js/TypeScript process running continuously under systemd. Claude Agent SDK handles AI reasoning; direct API clients handle Slack, Asana, Google Calendar, and Supabase.

---

## How It Works

### Meeting lifecycle

```
1. DETECT  -- Granola bridge polls MCP, inserts new meetings into Supabase
2. INGEST  -- Agent detects new row (summary + transcript + participants)
3. EXTRACT -- Claude analyzes content, extracts action items with:
              due dates, priority, suggested triage (own/delegate/park),
              external participant flags, existing Asana task matches
4. POST    -- Agent formats and posts to Bagel Slack DM (D0AD2PW9GAX)
5. TRIAGE  -- Agent monitors thread for replies, interprets natural language, acts
6. NUDGE   -- Agent checks for unaddressed items and sends reminders
```

### Scheduler loops

| Loop | Interval | Purpose |
|------|----------|---------|
| Poll Supabase | 5 min | Detect new meetings from bridge |
| Poll Slack threads | 2 min | Check for triage replies |
| Nudge check | 30 min | Remind about unaddressed items |
| Morning briefing | 8:55 AM ET | Daily summary + open items |
| End-of-day digest | 5:45 PM ET | Triage summary + carry-forward |

All loops respect business hours: **Monday-Friday, 9:00 AM - 6:00 PM ET**.

---

## Slack UX

### Action item post format

```
=====================================
BCSI + Whitestone
Feb 27 . 45 min . 5 attendees
=====================================

Topics: print integration, business card program, Liftoff setup

-- Action Items ----------------------

1. [ ] [HIGH] Remind Cristian Monday about SOW development
   due: Mon Mar 3 . priority: high
   -> suggesting: own

2. [ ] [MED]  Register for PrintForce portal
   due: Tue Mar 4 . priority: medium
   -> suggesting: delegate to Karie

Reply in thread to triage
```

### Triage commands (natural language — all of these work)

| What you type | What happens |
|---|---|
| `own 1,3` | Assigns items 1 and 3 to you in Asana |
| `delegate 2 to karie` | Creates task assigned to Karie |
| `park 4` | Moves item to Backlog / Parked section |
| `own all` | Takes everything |
| `park the vendor stuff, own the rest` | Agent reasons about which items match |
| `give karie everything except 1` | Natural language, agent figures it out |
| `1 me, 2-4 karie, 5 park` | Shorthand works |
| `merge 7 with existing` | Adds meeting context as comment on matched Asana task |
| `own 1, due tomorrow` | Overrides suggested due date |
| `bump 3 to high` | Overrides suggested priority |

---

## Project Structure

```
bagel/
├── src/
│   ├── index.ts                    # Entry point -- starts scheduler + Socket Mode
│   ├── scheduler.ts                # Business hours gate + 5 cron loops
│   ├── socket-mode.ts              # Real-time DM + thread reply handler (WebSocket)
│   ├── config.ts                   # All env vars (throws on missing required vars)
│   ├── agent/
│   │   ├── agent.ts                # Claude Agent SDK: invokeAgent(prompt)
│   │   └── tools/
│   │       ├── slack.ts            # Slack Web API wrapper
│   │       ├── asana.ts            # Asana REST API wrapper
│   │       ├── calendar.ts         # Google Calendar API (service account)
│   │       └── supabase.ts         # Supabase client + DB helpers
│   ├── sources/
│   │   ├── source.ts               # Source plugin interface (extensible)
│   │   └── granola.ts              # Reads meetings from Supabase
│   └── jobs/
│       ├── poll-meetings.ts        # Detect new meetings -> invoke agent
│       ├── poll-threads.ts         # Check Slack replies -> invoke agent
│       ├── nudge.ts                # Check unaddressed items -> send reminders
│       ├── morning-briefing.ts     # 8:55 AM ET daily job
│       └── eod-digest.ts           # 5:45 PM ET daily job
├── bridge/
│   ├── granola-sync.sh             # Claude CLI script for Granola MCP polling
│   └── install-bridge-cron.sh      # Sets up crontab on the VM
├── infra/
│   ├── cloudbuild.yaml             # CI/CD pipeline (Cloud Build)
│   ├── setup-vm.sh                 # VM provisioning script
│   └── bagel.service               # systemd unit file
├── supabase/
│   └── migrations/
│       └── 002_bagel_v2.sql        # Adds triage columns + thread_replies table
└── docs/
    └── plans/
        ├── 2026-03-02-bagel-agent-design.md        # Full architecture design doc
        └── 2026-03-02-bagel-implementation-plan.md # 18-task implementation plan
```

---

## Environment Variables

All secrets are stored in Google Secret Manager on the VM. Locally, use a `.env` file (gitignored). See `.env.example` for the full template.

| Variable | Description |
|----------|-------------|
| `ANTHROPIC_API_KEY` | Claude API access |
| `SLACK_BOT_TOKEN` | Bagel Slack app bot token (`xoxb-...`) |
| `SLACK_APP_TOKEN` | **NEW — not yet set** Socket Mode token (`xapp-1-...`) |
| `ASANA_PAT` | Asana Personal Access Token |
| `SUPABASE_URL` | `https://ejaxcfnnavjsajdepfkw.supabase.co` |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase service role key |
| `GOOGLE_CALENDAR_CREDENTIALS` | Service account JSON (base64) |
| `SLACK_CHANNEL_ID` | `D0AD2PW9GAX` (Tod's DM with Bagel bot) |
| `ASANA_WORKSPACE_GID` | Whitestone Asana workspace |
| `ASANA_PROJECT_GID` | `1212738213310157` (Task Triage) |
| `ASANA_BACKLOG_SECTION_GID` | `1213139850291370` |
| `GRANOLA_SOURCE_UUID` | `6d5dd263-00df-49f9-a9ea-5319cbe204d4` |
| `TOD_SLACK_USER_ID` | `U07GQ171UTZ` |
| `TOD_ASANA_EMAIL` | `tod.ellington@whitestonebranding.com` |
| `TIMEZONE` | `America/New_York` |

---

## Tech Stack

| Component | Technology |
|-----------|------------|
| Runtime | Node.js 20 / TypeScript (ESM, NodeNext) |
| AI reasoning | `@anthropic-ai/claude-agent-sdk` — `claude-sonnet-4-6` |
| State | Supabase (Postgres) — project `ejaxcfnnavjsajdepfkw` |
| Slack | `@slack/web-api` + `@slack/socket-mode` |
| Asana | Asana REST API (Personal Access Token) |
| Calendar | Google Calendar API (service account — no OAuth) |
| Meetings source | Granola MCP via Claude CLI bridge |
| Scheduler | `node-cron` + `luxon` (timezone-aware) |
| Deploy | GCP Compute Engine `bagel-vm` (e2-small, `us-east1-b`) |
| Process manager | systemd (`bagel.service`) |
| CI/CD | Google Cloud Build (`infra/cloudbuild.yaml`) |

**Cost: ~$15/mo** (Compute Engine ~$13/mo + API usage ~$0.50-$0.80/day)

---

## Local Development

```bash
npm install
cp .env.example .env
# Fill in .env values (credentials are in config-values.md, not committed to repo)
npm run build
npm start
```

## VM Deployment (updating existing)

```bash
npm run build
tar czf /tmp/bagel-update.tar.gz dist/ package.json package-lock.json
gcloud compute scp --zone=us-east1-b /tmp/bagel-update.tar.gz bagel-vm:/tmp/
gcloud compute ssh bagel-vm --zone=us-east1-b --command="cd /opt/bagel && sudo -u bagel tar xzf /tmp/bagel-update.tar.gz && sudo -u bagel npm ci --omit=dev && sudo systemctl restart bagel && sleep 3 && sudo systemctl status bagel --no-pager"
```

> Always use the tarball pattern — direct directory copies cause a `dist/dist/index.js` nesting bug.

## View VM Logs

```bash
gcloud compute ssh bagel-vm --zone=us-east1-b --command="sudo journalctl -u bagel -n 50 --no-pager"
```

---

## Services & IDs

| Service | ID | Status |
|---------|----|--------|
| Supabase project | `ejaxcfnnavjsajdepfkw` | Active |
| Slack App "Bagel" | `A0ACT45NCGP` | Installed in Whitestone |
| Asana Task Triage | `1212738213310157` | Active |
| Asana Backlog section | `1213139850291370` | Active |
| GCP VM | `bagel-vm`, zone `us-east1-b` | Running |
| n8n Meeting Intake | `xE1wftiN4UYKsfzU` | Active — keep until switchover |
| n8n Slack Action Handler | `a8jEkq30GFAjOTNd` | Active — keep until switchover |
| Zapier Zap | `347428399` | LIVE — don't change until new agent is verified |

---

## Handoff Documents

Session handoffs are in `.claude/handoffs/` — read in order for project history:

| File | Summary |
|------|---------|
| `2026-02-07-...bagel-phase1-supabase-edge-functions.md` | Phase 1 (Supabase Edge Functions) — superseded, never implemented |
| `2026-03-02-...bagel-v2-agent-design-and-plan.md` | Design + 18-task plan complete, no code yet |
| `2026-03-06-...socket-mode-setup-pending.md` | **Current** — all code done, blocked on Slack app-level token |

---

## Implementation Plan

Full 18-task plan: [`docs/plans/2026-03-02-bagel-implementation-plan.md`](docs/plans/2026-03-02-bagel-implementation-plan.md)

Architecture and design rationale: [`docs/plans/2026-03-02-bagel-agent-design.md`](docs/plans/2026-03-02-bagel-agent-design.md)

All 18 tasks have been implemented. Socket Mode DM handler was added as a follow-on feature in 4 additional commits after the main implementation.

---

## Future Roadmap (not in V1)

- **Email source** — Gmail integration for actionable emails
- **Slack source** — Monitor channels for action items directed at you
- **Frontend dashboard** — Web UI for historical view and cross-source command center
- **Delegate intelligence** — Suggests delegation based on past patterns and team roles
- **Cross-source linking** — "This email is about the same topic from your meeting"
- **Weekly review** — Friday afternoon summary of tasks created, completed, and open

---

## Security Notes

- `.env` is gitignored — never commit it
- Actual credentials are in `/Users/todellington/docs/plans/config-values.md` (local only, not in repo)
- VM uses GCP Secret Manager for production secrets
- `config.ts` uses a `required()` helper that throws at startup if any env var is missing — intentional
