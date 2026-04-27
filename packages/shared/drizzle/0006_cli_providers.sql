ALTER TABLE "projects" ADD COLUMN IF NOT EXISTS "workspace_path" text;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "cli_providers" (
	"id" text PRIMARY KEY NOT NULL,
	"provider" text NOT NULL,
	"enabled" boolean NOT NULL DEFAULT false,
	"is_default" boolean NOT NULL DEFAULT false,
	"created_at" timestamp NOT NULL DEFAULT now(),
	"updated_at" timestamp NOT NULL DEFAULT now(),
	CONSTRAINT "cli_providers_provider_unique" UNIQUE("provider")
);
--> statement-breakpoint
ALTER TABLE "agent_sessions" ADD COLUMN IF NOT EXISTS "cli_provider" text;
