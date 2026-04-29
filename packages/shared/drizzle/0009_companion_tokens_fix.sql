ALTER TABLE "companion_tokens" ADD CONSTRAINT "companion_tokens_token_hash_unique" UNIQUE("token_hash");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "companion_tokens_user_idx" ON "companion_tokens" USING btree ("user_id");
