ALTER TABLE "notifications" ADD COLUMN "pushed_at" timestamp with time zone;--> statement-breakpoint
CREATE INDEX "notifications_push_idx" ON "notifications" USING btree ("pushed_at","created_at");