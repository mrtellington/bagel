-- Obsidian Brain: note cache and write queue

CREATE TABLE IF NOT EXISTS obsidian_notes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  file_path TEXT UNIQUE NOT NULL,
  title TEXT,
  source TEXT,
  captured_at DATE,
  tags TEXT[] DEFAULT '{}',
  status TEXT DEFAULT 'inbox',
  bagel_processed BOOLEAN DEFAULT false,
  body TEXT,
  frontmatter JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_obsidian_notes_status ON obsidian_notes(status);
CREATE INDEX IF NOT EXISTS idx_obsidian_notes_bagel_processed ON obsidian_notes(bagel_processed);
CREATE INDEX IF NOT EXISTS idx_obsidian_notes_tags ON obsidian_notes USING GIN(tags);

CREATE TABLE IF NOT EXISTS obsidian_queue (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  operation TEXT NOT NULL CHECK (operation IN ('create', 'update')),
  file_path TEXT NOT NULL,
  content TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now(),
  committed_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_obsidian_queue_uncommitted ON obsidian_queue(committed_at) WHERE committed_at IS NULL;
