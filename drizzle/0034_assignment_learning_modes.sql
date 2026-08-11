ALTER TABLE assignments ADD COLUMN kind text NOT NULL DEFAULT 'homework';
--> statement-breakpoint
ALTER TABLE assignments ADD COLUMN content_json text;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS assignments_kind_status_updated_idx ON assignments(kind,status,updated_at DESC);
