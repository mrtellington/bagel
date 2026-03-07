# Bagel

> Automated executive assistant that extracts action items from meetings, routes them to Slack for triage, and creates Asana tasks — so nothing falls through the cracks.

---

## What It Does

Bagel watches your Granola AI meeting notes, extracts action items using Claude, and posts them to your Slack DM for quick triage. You reply in-thread with natural language ("own 1,3 — delegate 2 to karie — park 4"), and Bagel creates the Asana tasks, assigns them, and confirms. It also nudges you on unaddressed items and sends a morning briefing + end-of-day digest.

You can also DM the Bagel bot directly to ask questions like: "What did I commit to in my meeting with Ryan last week?"

**Vision:** Evolves into a chief-of-staff agent across all communication channels (email, Slack messages, calendar) — not just meetings.

---

## Architecture

```
GCP COMPUTE ENGINE (VM, e2-small)
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
    |(state)  |    |(bot)   |    |(tasks) |
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
4. POST    -- Agent formats and posts to Slack DM channel
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

All loops respect business hours (configurable via env vars, default Monday-Friday 9 AM - 6 PM ET).

---

## Slack UX

### Action item post format

```
=====================================
Meeting Title
Feb 27 . 45 min . 5 attendees
=====================================

Topics: integration, business card program, setup

-- Action Items ----------------------

1. [ ] [HIGH] Follow up on SOW development
   due: Mon Mar 3 . priority: high
   -> suggesting: own

2. [ ] [MED]  Register for portal
   due: Tue Mar 4 . priority: medium
   -> suggesting: delegate to team member

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
│       ├── morning-briefing.ts     # Morning daily job
│       └── eod-digest.ts          # Evening daily job
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

All secrets should be stored securely (e.g., GCP Secret Manager for production). Locally, use a `.env` file (gitignored). See `.env.example` for the full template.

| Variable | Description |
|----------|-------------|
| `ANTHROPIC_API_KEY` | Claude API access |
| `SLACK_BOT_TOKEN` | Slack app bot token (`xoxb-...`) |
| `SLACK_APP_TOKEN` | Socket Mode token (`xapp-1-...`) |
| `ASANA_PAT` | Asana Personal Access Token |
| `SUPABASE_URL` | Supabase project URL |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase service role key |
| `GOOGLE_CALENDAR_SA_KEY_BASE64` | Service account JSON (base64) |
| `SLACK_CHANNEL_ID` | DM channel with the bot |
| `ASANA_WORKSPACE_GID` | Asana workspace ID |
| `ASANA_PROJECT_GID` | Task Triage project ID |
| `ASANA_BACKLOG_SECTION_GID` | Backlog section ID |
| `GRANOLA_SOURCE_UUID` | Granola source identifier |
| `OWNER_SLACK_USER_ID` | Slack user ID for the owner |
| `OWNER_ASANA_EMAIL` | Owner's Asana email |
| `OWNER_NAME` | Display name (used in prompts) |
| `OWNER_TITLE` | Title/role (optional) |
| `ORG_NAME` | Organization name (optional) |
| `TIMEZONE` | Default: `America/New_York` |

---

## Tech Stack

| Component | Technology |
|-----------|------------|
| Runtime | Node.js 20 / TypeScript (ESM, NodeNext) |
| AI reasoning | `@anthropic-ai/claude-agent-sdk` — `claude-sonnet-4-6` |
| State | Supabase (Postgres) |
| Slack | `@slack/web-api` + `@slack/socket-mode` |
| Asana | Asana REST API (Personal Access Token) |
| Calendar | Google Calendar API (service account — no OAuth) |
| Meetings source | Granola MCP via Claude CLI bridge |
| Scheduler | `node-cron` + `luxon` (timezone-aware) |
| Deploy | GCP Compute Engine (e2-small) |
| Process manager | systemd |
| CI/CD | Google Cloud Build |

---

## Local Development

```bash
npm install
cp .env.example .env
# Fill in .env values with your own credentials
npm run build
npm start
```

## VM Deployment (updating existing)

```bash
npm run build
tar czf /tmp/bagel-update.tar.gz dist/ package.json package-lock.json
gcloud compute scp --zone=<your-zone> /tmp/bagel-update.tar.gz <your-vm>:/tmp/
gcloud compute ssh <your-vm> --zone=<your-zone> --command="cd /opt/bagel && sudo -u bagel tar xzf /tmp/bagel-update.tar.gz && sudo -u bagel npm ci --omit=dev && sudo systemctl restart bagel && sleep 3 && sudo systemctl status bagel --no-pager"
```

> Always use the tarball pattern — direct directory copies cause a `dist/dist/index.js` nesting bug.

## View VM Logs

```bash
gcloud compute ssh <your-vm> --zone=<your-zone> --command="sudo journalctl -u bagel -n 50 --no-pager"
```

---

## Implementation Plan

Full 18-task plan: [`docs/plans/2026-03-02-bagel-implementation-plan.md`](docs/plans/2026-03-02-bagel-implementation-plan.md)

Architecture and design rationale: [`docs/plans/2026-03-02-bagel-agent-design.md`](docs/plans/2026-03-02-bagel-agent-design.md)

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
- All credentials must be provided via environment variables — no defaults
- VM deployment should use a secrets manager (e.g., GCP Secret Manager)
- `config.ts` uses a `required()` helper that throws at startup if any env var is missing
- User input in Slack messages is delimited and sanitized before being passed to AI prompts
