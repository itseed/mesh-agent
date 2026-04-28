CREATE TABLE IF NOT EXISTS "project_context" (
	"project_id" text PRIMARY KEY NOT NULL,
	"brief" text DEFAULT '' NOT NULL,
	"auto_context" text DEFAULT '' NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "project_context_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "agent_outcomes" (
	"id" text PRIMARY KEY NOT NULL,
	"project_id" text NOT NULL,
	"role" text NOT NULL,
	"summary" text NOT NULL,
	"pr_url" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "agent_outcomes_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "agent_outcomes_project_created_idx" ON "agent_outcomes" USING btree ("project_id","created_at");
