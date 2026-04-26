ALTER TABLE "projects" ADD COLUMN IF NOT EXISTS "base_branch" text NOT NULL DEFAULT 'main';
ALTER TABLE "agent_sessions" ADD COLUMN IF NOT EXISTS "output_log" text;
