-- Obsidian Brain: allow 'delete' operation in write queue
-- Enables agent to move files (create-at-new-path + delete-at-old-path).

ALTER TABLE obsidian_queue DROP CONSTRAINT IF EXISTS obsidian_queue_operation_check;
ALTER TABLE obsidian_queue ADD CONSTRAINT obsidian_queue_operation_check
  CHECK (operation IN ('create', 'update', 'delete'));

-- delete ops don't carry content
ALTER TABLE obsidian_queue ALTER COLUMN content DROP NOT NULL;
