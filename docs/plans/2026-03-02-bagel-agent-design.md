# Bagel Agent — Design Document

> **Goal:** Automatically extract action items from Granola AI meetings, post them to Slack for triage, create Asana tasks based on your decisions, and nudge you on unaddressed items — with a scalable architecture for future sources (email, Slack messages).

> **Vision:** Bagel evolves into an executive assistant / chief of staff that ensures nothing falls through the cracks across all your communication channels.

---

## Architecture Overview

```
GCP COMPUTE ENGINE (e2-small)
┌─────────────────────────────────────────────────────┐
│                                                      │
│  GRANOLA MCP BRIDGE              BAGEL AGENT SERVICE │
│  ┌──────────────────┐           ┌──────────────────┐ │
│  │ Claude Code CLI   │  writes   │ Node.js / TS     │ │
│  │ (authed + cron)   │──────────→│ Claude Agent SDK │ │
│  │                   │ Supabase  │                  │ │
│  │ Granola MCP:      │           │ Direct APIs:     │ │
│  │ • list_meetings   │           │ • Slack (bot)    │ │
│  │ • get_meetings    │           │ • Asana (PAT)    │ │
│  │ • get_transcript  │           │ • Calendar (SA)  │ │
│  │                   │           │ • Supabase       │ │
│  │ Every 5 min       │           │ • Anthropic      │ │
│  │ M-F 9a-6p ET      │           │                  │ │
│  └──────────────────┘           └──────────────────┘ │
│                                                      │
│  systemd · Cloud Logging · Secret Manager            │
└─────────────────────────────────────────────────────┘
         │              │              │
    ┌────▼────┐    ┌───▼────┐    ┌───▼────┐
    │Supabase │    │ Slack  │    │ Asana  │
    │(state)  │    │(Bagel) │    │(tasks) │
    └─────────┘    └────────┘    └────────┘
```

### Two components on one VM

1. **Granola MCP Bridge** — A cron job that invokes `claude` CLI every 5 min to poll Granola for new meetings via MCP tools and write them to Supabase. Required because Granola's API is Enterprise-only; the MCP connector (authenticated through Claude account) is the only data access path.

2. **Bagel Agent Service** — A Node.js/TypeScript service that runs continuously. Uses Claude Agent SDK for AI reasoning and direct APIs for Slack, Asana, Google Calendar, and Supabase. Handles the full pipeline: extraction, posting, triage monitoring, task creation, and nudges.

---

## Data Flow

### Lifecycle of a meeting

```
1. DETECT — Granola bridge polls MCP, inserts new meetings into Supabase
2. INGEST — Bagel service detects new row in Supabase (summary + transcript + participants)
3. EXTRACT — Claude Agent analyzes meeting content, extracts action items with:
   - Due dates (inferred from context)
   - Priority (high/medium/low from meeting signals)
   - Suggested triage (own/delegate/park with reasoning)
   - External participant flags
   - Existing Asana task matches
4. POST — Agent formats and posts to Bagel Slack DM (D0AD2PW9GAX)
5. TRIAGE — Agent monitors thread for your replies, interprets natural language, acts
6. NUDGE — Agent checks for unaddressed items and sends reminders between meetings
```

### Scheduler loops

| Loop | Interval | Purpose |
|------|----------|---------|
| Poll Supabase | 5 min | Detect new meetings from bridge |
| Poll Slack threads | 2 min | Check for triage replies |
| Nudge check | 30 min | Remind about unaddressed items |
| Morning briefing | 8:55 AM ET | Daily summary + open items |
| End-of-day digest | 5:45 PM ET | Triage summary + carry-forward |

All loops respect business hours: **Monday–Friday, 9:00 AM – 6:00 PM ET**.

Exception: If you reply to a Slack thread outside hours, the agent processes it at the next 9 AM window.

---

## Slack UX

### Meeting post format

```
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
BCSI + Whitestone
Feb 27 · 45 min · 5 attendees
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Topics: print integration, business card program,
Liftoff setup, sales education, BCSI partnership

── Action Items ──────────────────────

1. ⬜ 🔴 Remind Cristian Monday about SOW development
   due: Mon Mar 3 · priority: high
   → suggesting: own

2. ⬜ 🟡 Register for PrintForce portal
   due: Tue Mar 4 · priority: medium
   → suggesting: delegate to Karie

3. ⬜ 🔴 Get client specs from Ryan (paper, sides, effects)
   due: Mon Mar 3 · priority: high
   (client expecting info Mon/Tue)
   → suggesting: delegate to Karie

4. ⬜ 🟡 Get art requirements and Liftoff process docs
   due: Fri Mar 7 · priority: medium
   ⚠️ Emily Myers is external (PrintForce) — needs
   an internal owner to follow up
   → suggesting: delegate to Karie (to follow up w/ Emily)

5. ⬜ 🟡 Coordinate sample packet distribution with Kylie
   due: Fri Mar 7 · priority: medium
   → suggesting: delegate to Karie

6. ⬜ 🟡 Schedule lunch & learn for sales team
   due: Fri Mar 14 · priority: medium
   → suggesting: own

7. ⬜ 🟢 Target April 1 launch for first client
   due: Wed Apr 1 · priority: low (milestone)
   🔗 Possible match: "BCSI Print Integration"
   in Whitestone Enterprise — merge or new?
   → suggesting: own

Reply in thread to triage ↓
```

### Triage reply format

The agent uses Claude to interpret natural language replies. All of these work:

| What you type | What happens |
|---|---|
| `own 1,3` | Assigns items 1,3 to you in Asana |
| `delegate 2 to karie` | Creates task assigned to Karie |
| `park 4` | Moves item to Backlog / Parked section |
| `own all` | Takes everything |
| `park the vendor stuff, own the rest` | Agent reasons about which items match |
| `give karie everything except 1` | Natural language, agent figures it out |
| `1 me, 2-4 karie, 5 park` | Shorthand works |
| `merge 7 with existing` | Adds meeting context as comment on matched Asana task |
| `delegate 4 to karie — follow up with emily` | Task assigned to Karie, description notes Emily follow-up |
| `own 1, due tomorrow` | Overrides suggested due date |
| `bump 3 to high` | Overrides suggested priority |

### Post-triage confirmation

After triaging, the agent replies in-thread confirming what was created and updates the original message with ✅ markers. Flags edge cases like external participants not in the Asana workspace.

### Due date logic

- **Explicit:** "by Friday" → calculates actual date
- **Relative:** "next week" → Monday of next week
- **Implicit:** "client expecting info Mon/Tue" → Monday, with context note
- **Milestone:** "April 1 launch" → flags as low priority milestone
- **Calendar-aware:** checks your schedule before suggesting deadlines you own

### Priority levels

- 🔴 **High** — explicit deadlines, client-facing, someone is waiting
- 🟡 **Medium** — committed to, no hard deadline
- 🟢 **Low** — milestones, nice-to-haves, longer horizon

### External participant handling

When an action item's responsible party is not in your Asana workspace:
- Flags with ⚠️ in the Slack message
- Suggests delegating to an internal person to own the follow-up
- Asana task description includes the external person's name and email for reference

### Existing task matching

Before creating a new Asana task, the agent searches Task Triage and recent projects:
- **High confidence match** → flags with 🔗 and specific task name
- **Multiple matches** → shows options
- **No match** → creates new task, no flag
- **Merge** → adds meeting context as a comment on the existing task

---

## Nudge system

### Timing

| Trigger | When | Format |
|---------|------|--------|
| First nudge | 1 hour after post, if items pending | Gentle: "6 items still open from your BCSI meeting" |
| Escalated nudge | 4 hours after post | Stronger: "9 items might slip. Got 30 seconds?" |
| End-of-day digest | 5:45 PM ET | Full summary of triaged + open items |
| Morning briefing | 8:55 AM ET | Open items + today's meeting schedule + triage gaps |

### Calendar awareness

- Agent checks if you're currently in a meeting → delays nudge
- Finds gaps between meetings → nudges during those windows
- "You've got 15 min before your 3:30 Prod Squad — quick triage on your Kim touchbase?"

---

## Google Calendar Integration

### Authentication

Service account (recommended):
- Create GCP service account
- Share your calendar with the service account email
- No OAuth dance, no token refresh, works permanently

### Agent tool capabilities

```
calendar.getTodayEvents()     — full schedule for today
calendar.getCurrentEvent()    — what's happening now (suppress nudges)
calendar.getNextGap(minutes)  — next free slot ≥ N min (smart nudges)
calendar.isInMeeting()        — boolean for nudge suppression
```

---

## Source Plugin Architecture

Designed for future extensibility. Adding a new source (email, Slack messages) requires implementing one interface:

```typescript
interface Source {
  name: string;               // 'granola', 'email', 'slack'
  pollInterval: number;        // minutes between polls

  poll(): Promise<RawItem[]>;
  getContent(id: string): Promise<SourceContent>;
}

interface SourceContent {
  id: string;
  source: string;
  title: string;
  date: Date;
  participants: Participant[];
  body: string;
  transcript?: string;
  metadata: Record<string, any>;
}
```

Everything downstream — Claude extraction, Slack posting, Asana creation — is source-agnostic.

---

## Tech Stack

| Component | Technology | Rationale |
|---|---|---|
| Runtime | Node.js 20 / TypeScript | Strong ecosystem, Agent SDK is TS-native |
| AI reasoning | Claude Agent SDK (Anthropic) | Agentic tool use, natural language understanding |
| State | Supabase (Postgres) | Already set up, tables exist from prior pipeline |
| Slack | Slack Web API (direct, bot token) | Full control, no MCP dependency |
| Asana | Asana REST API (direct, PAT) | Full control, search + create + update |
| Calendar | Google Calendar API (service account) | Native GCP, no OAuth maintenance |
| Meetings | Granola MCP via Claude CLI bridge | Only access path (API is Enterprise-only) |
| Scheduler | node-cron | Lightweight, in-process, timezone-aware with luxon |
| Deploy | GCP Compute Engine (e2-small) | Always-on, ~$13/mo, GCP-native |
| Secrets | Google Secret Manager | No plaintext credentials on disk |
| Logs | Google Cloud Logging | Centralized, alerting, free tier |
| CI/CD | Google Cloud Build | Auto-deploy from GitHub push |

### Dependencies

```
@anthropic-ai/agent-sdk       — Claude Agent SDK
@anthropic-ai/sdk             — Anthropic API (direct calls)
@supabase/supabase-js         — Supabase client
googleapis                    — Google Calendar API
@slack/web-api                — Slack Web API client
node-cron                     — Scheduler
luxon                         — Timezone-aware dates (ET)
```

---

## Database Schema

Reuses existing Supabase tables (`meetings`, `action_items`, `sources`) with additions:

```sql
-- Meetings: add calendar + Slack tracking
ALTER TABLE meetings ADD COLUMN IF NOT EXISTS calendar_event_id TEXT;

-- Action items: add triage fields
ALTER TABLE action_items ADD COLUMN IF NOT EXISTS suggested_due_date DATE;
ALTER TABLE action_items ADD COLUMN IF NOT EXISTS final_due_date DATE;
ALTER TABLE action_items ADD COLUMN IF NOT EXISTS priority TEXT DEFAULT 'medium';
ALTER TABLE action_items ADD COLUMN IF NOT EXISTS suggested_action TEXT;
ALTER TABLE action_items ADD COLUMN IF NOT EXISTS final_action TEXT;
ALTER TABLE action_items ADD COLUMN IF NOT EXISTS delegate_to TEXT;
ALTER TABLE action_items ADD COLUMN IF NOT EXISTS merged_with_task TEXT;
ALTER TABLE action_items ADD COLUMN IF NOT EXISTS nudge_count INTEGER DEFAULT 0;
ALTER TABLE action_items ADD COLUMN IF NOT EXISTS last_nudge_at TIMESTAMPTZ;

-- Thread reply dedup
CREATE TABLE IF NOT EXISTS thread_replies (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  meeting_id UUID REFERENCES meetings(id),
  slack_thread_ts TEXT NOT NULL,
  slack_reply_ts TEXT NOT NULL,
  processed BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE UNIQUE INDEX idx_thread_replies_dedup
  ON thread_replies(slack_thread_ts, slack_reply_ts);
```

---

## Project Structure

```
~/bagel/
├── src/
│   ├── index.ts                    # Entry point — starts schedulers
│   ├── scheduler.ts                # Business hours gate + cron loops
│   ├── agent/
│   │   ├── agent.ts                # Claude Agent SDK setup + system prompt
│   │   └── tools/
│   │       ├── slack.ts            # Slack Web API
│   │       ├── asana.ts            # Asana REST API
│   │       ├── calendar.ts         # Google Calendar API
│   │       └── supabase.ts         # Supabase client
│   ├── sources/
│   │   ├── source.ts               # Source plugin interface
│   │   └── granola.ts              # Reads meetings from Supabase
│   ├── jobs/
│   │   ├── poll-meetings.ts        # Detect new meetings → invoke agent
│   │   ├── poll-threads.ts         # Check Slack replies → invoke agent
│   │   ├── nudge.ts                # Check unaddressed items
│   │   ├── morning-briefing.ts     # 8:55 AM ET
│   │   └── eod-digest.ts           # 5:45 PM ET
│   └── config.ts                   # Secret Manager + constants
├── bridge/
│   ├── granola-sync.sh             # Claude CLI script for MCP polling
│   └── install-bridge-cron.sh      # Sets up crontab on the VM
├── infra/
│   ├── cloudbuild.yaml             # CI/CD pipeline
│   ├── setup-vm.sh                 # VM provisioning script
│   └── bagel.service               # systemd unit file
├── supabase/
│   └── migrations/
│       └── 002_bagel_v2.sql
├── package.json
├── tsconfig.json
├── Dockerfile
└── docs/
    └── plans/
        └── 2026-03-02-bagel-agent-design.md
```

---

## GCP Infrastructure

| Service | Purpose | Cost |
|---|---|---|
| Compute Engine (e2-small) | Runs bridge + agent service | ~$13/mo |
| Secret Manager | API keys, tokens, credentials | Free tier |
| Cloud Logging | Centralized logs + alerting | Free tier |
| Cloud Build | CI/CD from GitHub | Free tier (120 min/day) |
| Google Calendar API | Schedule awareness | Free |

**Total: ~$15/mo**

---

## Environment Variables

Stored in Google Secret Manager:

```
ANTHROPIC_API_KEY              # Claude API access
SLACK_BOT_TOKEN                # Bagel Slack app (xoxb-...)
ASANA_PAT                      # Asana Personal Access Token
SUPABASE_URL                   # https://ejaxcfnnavjsajdepfkw.supabase.co
SUPABASE_SERVICE_ROLE_KEY      # Supabase service role
GOOGLE_CALENDAR_SA_KEY         # Service account JSON (base64)
```

### Config constants

```
SLACK_CHANNEL_ID               = D0AD2PW9GAX (Bagel DM)
ASANA_PROJECT_GID              = 1212738213310157 (Task Triage)
ASANA_BACKLOG_SECTION_GID      = 1213139850291370
GRANOLA_SOURCE_UUID            = 6d5dd263-00df-49f9-a9ea-5319cbe204d4
TIMEZONE                       = America/New_York
BUSINESS_HOURS_START           = 09:00
BUSINESS_HOURS_END             = 18:00
TOD_SLACK_USER_ID              = U07GQ171UTZ
TOD_ASANA_EMAIL                = tod.ellington@whitestonebranding.com
```

---

## Existing Services (from prior pipeline)

These are already configured and can be reused:

| Service | ID | Status |
|---|---|---|
| Supabase project | `ejaxcfnnavjsajdepfkw` | Active, tables exist |
| Slack App "Bagel" | `A0ACT45NCGP` | Installed in Whitestone |
| Asana Task Triage | `1212738213310157` | Active |
| Asana Backlog section | `1213139850291370` | Active |

### Services to decommission after Bagel v2 is live

| Service | ID | Action |
|---|---|---|
| n8n Meeting Intake | `xE1wftiN4UYKsfzU` | Deactivate workflow |
| n8n Slack Action Handler | `a8jEkq30GFAjOTNd` | Deactivate workflow |
| Zapier Zap | `347428399` | Pause/delete |
| Slack Interactivity URL | Points to n8n | Update or remove |

---

## Key Design Decisions

| Decision | Choice | Rationale |
|---|---|---|
| Granola access | MCP bridge via Claude CLI | API is Enterprise-only; MCP is only access path |
| AI reasoning | Claude Agent SDK | Natural language triage, smart suggestions, extensible |
| Triage UX | Slack thread replies | Zero friction — you're already in Slack between meetings |
| Task creation timing | On triage, not upfront | Avoids cluttering Asana with tasks you might park |
| Calendar integration | Google service account | No OAuth maintenance, permanent auth |
| Deployment | GCP Compute Engine | Always-on, GCP-native, user is GCP admin |
| State DB | Supabase (keep existing) | Already set up, working, zero migration cost |
| Business hours | M-F 9 AM – 6 PM ET | All schedulers pause outside this window |

---

## Future Roadmap (not in V1)

- **Email source** — Gmail integration for actionable emails
- **Slack source** — Monitor specific channels for action items directed at you
- **Frontend dashboard** — Web UI for historical view, analytics, cross-source command center
- **Delegate intelligence** — Agent suggests delegation based on past patterns and team roles
- **Cross-source linking** — "This email from Karie is about the same thing you discussed in your meeting"
- **Weekly review** — Friday afternoon summary of all tasks created, completed, and still open
