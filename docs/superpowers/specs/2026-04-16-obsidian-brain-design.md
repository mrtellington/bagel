# Bagel Obsidian Brain — Design Spec

**Date:** 2026-04-16  
**Status:** Approved  
**Scope:** Phase 1 — vault sync, article capture, proactive triage, reactive queries

---

## Overview

Connect Bagel's GCP VM agent to an Obsidian vault via a Git-backed bridge. The vault becomes Bagel's long-term knowledge brain: articles you clip or share land in an inbox, Bagel surfaces them in Slack for triage, and your knowledge base becomes searchable from any Slack DM. Fully bidirectional — Bagel reads from and writes to the vault.

---

## Vault Structure

Local path: `/Users/todellington/Documents/Obsidian`  
GitHub repo: `mrtellington/bagel-brain` (private)

```
Obsidian/
├── 00-inbox/       ← all new captures land here (Web Clipper + Bagel + Granola)
├── 10-articles/    ← processed articles
├── 20-meetings/    ← meeting notes from Granola
├── 30-projects/    ← project notes
├── 40-people/      ← contact notes (linked from meetings + action items)
├── 50-reference/   ← evergreen reference material
├── templates/      ← Bagel-managed note templates
└── .obsidian/      ← Obsidian config (tracked in git)
```

### Standard Frontmatter

Every note Bagel creates or processes uses this structure:

```yaml
---
title: "Note Title"
source: "https://..."        # URL if captured from web; omit for manual notes
captured: 2026-04-16
tags: []
status: inbox                # inbox | processed
bagel-processed: false       # true after Bagel has reviewed and filed
---
```

Dataview can query any field. Bagel parses frontmatter to understand note state.

---

## Sync Architecture

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

**Sync flow:**
1. `obsidian-git` auto-pushes vault to GitHub every 5 minutes
2. `poll-vault` cron job on VM pulls from GitHub every 5 minutes
3. Bagel writes new notes by committing directly to the GitHub repo
4. `obsidian-git` pulls those commits into Obsidian on its next sync cycle

**Supabase role:** Cache and write queue only. `obsidian_notes` holds parsed vault content for fast search. `obsidian_queue` holds pending write operations. If Supabase is wiped, `poll-vault` rebuilds the cache from the repo. No data lives exclusively in Supabase.

---

## New Bagel Components

### `src/sources/obsidian.ts`
Vault reader. Responsibilities:
- `git pull` the repo to VM's local clone
- Walk the vault directory, parse markdown + frontmatter
- Detect files in `00-inbox/` with `bagel-processed: false`
- Return structured `ObsidianNote` objects

### `src/agent/tools/obsidian.ts`
Four agent tools registered in `agent.ts`:

| Tool | Description |
|------|-------------|
| `vault_search` | Full-text + tag search across `obsidian_notes` Supabase cache |
| `vault_create_note` | Write a new note to `obsidian_queue`, commit to GitHub |
| `vault_update_note` | Update frontmatter or body of existing note, commit to GitHub |
| `vault_list_recent` | Return N most recently captured notes |

### `src/jobs/poll-vault.ts`
Cron job, runs every 5 minutes (same cadence as `poll-meetings`). Steps:
1. Pull latest vault from GitHub
2. Sync changed files to `obsidian_notes` Supabase table
3. Find `00-inbox/` files where `bagel-processed: false`
4. For each new file: invoke agent to analyze + compose Slack message
5. Post triage message to Bagel DM (D0AD2PW9GAX), mark `bagel-processed: true`
6. Flush `obsidian_queue` — commit any pending writes to GitHub

### Supabase Tables

**`obsidian_notes`** (cache)
```sql
id          uuid primary key
file_path   text unique        -- relative vault path, e.g. "00-inbox/2026-04-16-article.md"
title       text
source      text
captured_at date
tags        text[]
status      text
body        text               -- full markdown content
frontmatter jsonb              -- all frontmatter fields
updated_at  timestamptz
```

**`obsidian_queue`** (write queue)
```sql
id           uuid primary key
operation    text              -- 'create' | 'update'
file_path    text
content      text              -- full markdown to write
created_at   timestamptz
committed_at timestamptz       -- null until committed to GitHub
```

---

## Proactive Flow (Web Clipper → Slack)

```
1. You clip article in browser
2. Web Clipper saves to 00-inbox/ with frontmatter
3. obsidian-git pushes to GitHub (~5 min)
4. poll-vault detects new file, bagel-processed: false
5. Agent reads note, generates summary + suggested tags + related vault notes
6. Bagel DMs you in Slack:
   "You saved '[Title]' from [domain].
    Summary: [2-3 sentences]
    Suggested tags: [x, y, z]
    Related to: [link to existing note if any]
    → File to 10-articles, or ask me questions to draw out your thinking?"
7. You reply in thread → Bagel files/tags/updates → commits → obsidian-git pulls in
```

---

## Reactive Flow (Slack DM → Vault)

**Article capture:**
```
You: "save this https://..."
Bagel: fetches URL, extracts content, creates note in 00-inbox/, commits to GitHub
Bagel: responds with summary + tags + "Filed to your vault ✓"
obsidian-git: pulls note into Obsidian on next sync
```

**Knowledge query:**
```
You: "what do I know about AI agents?"
Bagel: searches obsidian_notes via vault_search tool
Bagel: returns matching notes with titles, dates, brief excerpts
Bagel: surfaces cross-note connections and any related open Asana tasks
```

---

## Error Handling

**Git conflict** — Bagel writes exclusively to `00-inbox/` with timestamped filenames (`YYYY-MM-DD-HHMM-slug.md`). User edits happen in other folders after Bagel has filed notes. Collision surface is near zero. If a conflict occurs, `obsidian-git` surfaces it in Obsidian for manual resolution; Bagel skips conflicted files on next poll.

**GitHub unreachable / push fails** — `obsidian-git` retries automatically. `poll-vault` logs the error, skips the cycle, sends no Slack noise. Write queue entries remain in `obsidian_queue` and retry on next successful cycle.

**Article fetch fails** (paywalled, JS-rendered, bad URL) — Bagel responds: "I couldn't fully fetch that page — saved what I could (title + meta). Want me to create a stub note and you add your own summary?"

---

## Obsidian Plugins

| Plugin | Purpose | Required |
|--------|---------|---------|
| `obsidian-git` | Vault ↔ GitHub sync, auto-push every 5 min | Required |
| `Dataview` | Query vault as a database — enables future dashboards | Strongly recommended |
| `Templater` | Note templates Bagel uses for consistent structure | Strongly recommended |
| `Obsidian Web Clipper` | Browser extension for article capture | Already planned |

---

## Scalability Notes

- **Vault is source of truth.** Supabase is cache only. Adding a new source (Gmail, Slack) = new templates + inbox routing rules, no schema changes.
- **Tool registry is additive.** New vault tools plug into `agent.ts` without touching existing tools.
- **Folder structure is stable.** PARA-inspired folders cover the full range of content types; new categories get new numbered folders without reorganizing existing ones.
- **obsidian-git → Obsidian Sync transition:** When Obsidian Sync is activated, the local vault path stays the same. `obsidian-git` continues to work alongside Sync for the VM bridge. No changes needed to Bagel.

---

## Out of Scope (Phase 2)

- Gmail → Obsidian pipeline
- Slack channel scanning → Obsidian
- AI-powered auto-linking (Smart Connections plugin integration)
- Obsidian graph visualization in Slack
- Daily knowledge digest from vault
