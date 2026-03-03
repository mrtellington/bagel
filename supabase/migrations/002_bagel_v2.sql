-- Bagel v2 schema additions

-- Meetings: add calendar tracking
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

-- Thread reply dedup table
CREATE TABLE IF NOT EXISTS thread_replies (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  meeting_id UUID REFERENCES meetings(id),
  slack_thread_ts TEXT NOT NULL,
  slack_reply_ts TEXT NOT NULL,
  processed BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_thread_replies_dedup
  ON thread_replies(slack_thread_ts, slack_reply_ts);
