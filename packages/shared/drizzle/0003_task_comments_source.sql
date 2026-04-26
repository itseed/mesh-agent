ALTER TABLE "task_comments" ADD COLUMN IF NOT EXISTS "source" text DEFAULT 'user' NOT NULL;
