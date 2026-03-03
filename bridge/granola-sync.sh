#!/bin/bash
# Granola MCP Bridge — polls Granola via Claude Code MCP and syncs to Supabase
# Runs via cron every 5 min during business hours

set -euo pipefail

SUPABASE_URL="${SUPABASE_URL:-https://ejaxcfnnavjsajdepfkw.supabase.co}"
SUPABASE_KEY="${SUPABASE_SERVICE_ROLE_KEY}"
SOURCE_UUID="6d5dd263-00df-49f9-a9ea-5319cbe204d4"
LOG_FILE="${HOME}/.bagel/bridge.log"

mkdir -p "$(dirname "$LOG_FILE")"

log() {
  echo "[$(date -u +%Y-%m-%dT%H:%M:%SZ)] $*" >> "$LOG_FILE"
}

log "Bridge run starting"

# Use Claude Code to poll Granola MCP and output JSON
RESULT=$(claude -p "Use the Granola MCP tools to:
1. Call list_meetings with time_range 'this_week'
2. For each meeting, output a JSON array with objects containing: id, title, date, participants (array of {name, email})

Return ONLY valid JSON — no markdown, no explanation. Format:
[{\"id\": \"uuid\", \"title\": \"...\", \"date\": \"...\", \"participants\": [{\"name\": \"...\", \"email\": \"...\"}]}]

If no meetings, return []" \
  --output-format json \
  --max-turns 3 \
  2>>"$LOG_FILE" || true)

if [ -z "$RESULT" ] || [ "$RESULT" = "[]" ]; then
  log "No meetings found or empty result"
  exit 0
fi

log "Got meetings from Granola, checking against Supabase"

# For each meeting, check if it exists in Supabase, if not get details and insert
claude -p "You have these meetings from Granola: $RESULT

For each meeting:
1. Check Supabase if it already exists: query the meetings table where external_id equals the meeting id
2. If it does NOT exist, get the full meeting details and transcript from Granola MCP using get_meetings and get_meeting_transcript
3. Insert into Supabase meetings table with:
   - source_id: '$SOURCE_UUID'
   - external_id: the Granola meeting id
   - title: meeting title
   - event_datetime: meeting date
   - attendees: participant array as JSONB
   - enhanced_notes: the AI summary from get_meetings
   - transcript: the full transcript from get_meeting_transcript
   - processed: false

Use the Bash tool to make curl calls to Supabase REST API:
  URL: $SUPABASE_URL/rest/v1/meetings
  Headers: apikey: $SUPABASE_KEY, Authorization: Bearer $SUPABASE_KEY

Report how many new meetings were synced." \
  --max-turns 15 \
  --allowedTools "mcp__claude_ai_Granola__list_meetings,mcp__claude_ai_Granola__get_meetings,mcp__claude_ai_Granola__get_meeting_transcript,Bash" \
  2>>"$LOG_FILE" | tail -5 >> "$LOG_FILE"

log "Bridge run complete"
