-- Add delegate column to tickets table.
-- Stores the AI model identifier (e.g. 'claude_4_5_opus') when a ticket is
-- created by an agent, allowing us to distinguish agent-created from
-- user-created tickets.
ALTER TABLE tickets ADD COLUMN delegate text;

COMMENT ON COLUMN tickets.delegate IS
  'AI model identifier that created this ticket on behalf of the user (null when created directly by a user).';

-- Add tickets_created column to feed_posts.
-- Stores structured references to tickets spawned during the session, so the
-- feed can display them without re-querying.
ALTER TABLE feed_posts ADD COLUMN tickets_created jsonb NOT NULL DEFAULT '[]'::jsonb;

COMMENT ON COLUMN feed_posts.tickets_created IS
  'Array of {id, sequence, title} for tickets spawned by this session.';
