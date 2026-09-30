CREATE TYPE "public"."area_type" AS ENUM('zone', 'building');--> statement-breakpoint
CREATE TYPE "public"."auth_source" AS ENUM('local', 'school');--> statement-breakpoint
CREATE TYPE "public"."component_kind" AS ENUM('score', 'deduct');--> statement-breakpoint
CREATE TYPE "public"."component_source" AS ENUM('committee', 'area_teacher');--> statement-breakpoint
CREATE TYPE "public"."component_unit" AS ENUM('class', 'area');--> statement-breakpoint
CREATE TYPE "public"."duty" AS ENUM('committee', 'area_teacher', 'approver');--> statement-breakpoint
CREATE TYPE "public"."evaluation_status" AS ENUM('submitted', 'returned', 'approved', 'void');--> statement-breakpoint
CREATE TYPE "public"."evidence_kind" AS ENUM('site', 'signature');--> statement-breakpoint
CREATE TYPE "public"."request_status" AS ENUM('waiting', 'approved', 'rejected', 'cancelled', 'expired');--> statement-breakpoint
CREATE TYPE "public"."request_type" AS ENUM('late_entry', 'edit_score', 'edit_photos', 'edit_comment', 'move_target', 'delete');--> statement-breakpoint
CREATE TYPE "public"."role" AS ENUM('super_admin', 'admin', 'executive', 'teacher');--> statement-breakpoint
CREATE TYPE "public"."round_status" AS ENUM('scheduled', 'open', 'closed', 'finalized');--> statement-breakpoint
CREATE TYPE "public"."score_format" AS ENUM('integer', 'decimal');--> statement-breakpoint
CREATE TYPE "public"."score_mode" AS ENUM('group', 'individual');--> statement-breakpoint
CREATE TYPE "public"."student_status" AS ENUM('active', 'inactive', 'review');--> statement-breakpoint
CREATE TYPE "public"."sync_source" AS ENUM('general', 'vocational');--> statement-breakpoint
CREATE TYPE "public"."sync_status" AS ENUM('success', 'aborted', 'failed');--> statement-breakpoint
CREATE TYPE "public"."target_type" AS ENUM('class', 'area');--> statement-breakpoint
CREATE TYPE "public"."term_status" AS ENUM('draft', 'active', 'closed');--> statement-breakpoint
CREATE TYPE "public"."track" AS ENUM('general', 'religious', 'vocational');--> statement-breakpoint
CREATE TABLE "api_keys" (
	"id" uuid PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"key_hash" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_used_at" timestamp with time zone,
	"revoked_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "app_settings" (
	"key" text PRIMARY KEY NOT NULL,
	"value" jsonb NOT NULL,
	"updated_by" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "appointment_orders" (
	"id" uuid PRIMARY KEY NOT NULL,
	"term_id" uuid NOT NULL,
	"title" text NOT NULL,
	"file_path" text NOT NULL,
	"sort_order" smallint DEFAULT 0 NOT NULL,
	"uploaded_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "areas" (
	"id" uuid PRIMARY KEY NOT NULL,
	"type" "area_type" NOT NULL,
	"code" text NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"is_active" boolean DEFAULT true NOT NULL,
	"sort_order" smallint DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "audit_logs" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"at" timestamp with time zone DEFAULT now() NOT NULL,
	"actor_id" uuid,
	"action" text NOT NULL,
	"entity" text NOT NULL,
	"entity_id" text NOT NULL,
	"before" jsonb,
	"after" jsonb,
	"ip" text
);
--> statement-breakpoint
CREATE TABLE "class_aliases" (
	"id" uuid PRIMARY KEY NOT NULL,
	"class_id" uuid NOT NULL,
	"alias" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "class_room_links" (
	"id" uuid PRIMARY KEY NOT NULL,
	"class_id" uuid NOT NULL,
	"physical_room_id" uuid NOT NULL,
	"effective_from" date NOT NULL,
	"effective_to" date,
	"created_by" uuid
);
--> statement-breakpoint
CREATE TABLE "class_skip_rules" (
	"id" uuid PRIMARY KEY NOT NULL,
	"prefix" text NOT NULL,
	"note" text
);
--> statement-breakpoint
CREATE TABLE "classes" (
	"id" uuid PRIMARY KEY NOT NULL,
	"track" "track" NOT NULL,
	"grade_code" text NOT NULL,
	"grade_label" text NOT NULL,
	"rank_group" text NOT NULL,
	"room_no" smallint NOT NULL,
	"name" text NOT NULL,
	"display_name" text NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL
);
--> statement-breakpoint
CREATE TABLE "duties" (
	"id" uuid PRIMARY KEY NOT NULL,
	"term_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"duty" "duty" NOT NULL,
	"target_type" "target_type",
	"target_class_id" uuid,
	"target_area_id" uuid,
	"is_freelance" boolean DEFAULT false NOT NULL,
	"valid_until" timestamp with time zone,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "duties_target_shape" CHECK (
    ("duties"."target_type" IS NULL AND "duties"."target_class_id" IS NULL AND "duties"."target_area_id" IS NULL) OR
    ("duties"."target_type" = 'class' AND "duties"."target_class_id" IS NOT NULL AND "duties"."target_area_id" IS NULL) OR
    ("duties"."target_type" = 'area'  AND "duties"."target_area_id" IS NOT NULL AND "duties"."target_class_id" IS NULL))
);
--> statement-breakpoint
CREATE TABLE "evaluation_student_scores" (
	"evaluation_id" uuid NOT NULL,
	"student_id" uuid NOT NULL,
	"score" numeric(6, 3) NOT NULL,
	CONSTRAINT "evaluation_student_scores_evaluation_id_student_id_pk" PRIMARY KEY("evaluation_id","student_id")
);
--> statement-breakpoint
CREATE TABLE "evaluations" (
	"id" uuid PRIMARY KEY NOT NULL,
	"round_id" uuid NOT NULL,
	"component_id" uuid NOT NULL,
	"target_type" "target_type" NOT NULL,
	"target_class_id" uuid,
	"target_area_id" uuid,
	"owner_id" uuid NOT NULL,
	"score" numeric(6, 3),
	"comment" text,
	"room_number_at_eval" text,
	"status" "evaluation_status" DEFAULT 'submitted' NOT NULL,
	"first_submitted_at" timestamp with time zone NOT NULL,
	"self_edit_until" timestamp with time zone NOT NULL,
	"last_edited_at" timestamp with time zone NOT NULL,
	"returned_at" timestamp with time zone,
	"returned_reason" text,
	"approved_at" timestamp with time zone,
	"approved_by" uuid,
	"version" integer DEFAULT 1 NOT NULL,
	"pdf_status" text DEFAULT 'none' NOT NULL,
	"pdf_error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "evaluations_target_shape" CHECK (
    ("evaluations"."target_type" = 'class' AND "evaluations"."target_class_id" IS NOT NULL AND "evaluations"."target_area_id" IS NULL) OR
    ("evaluations"."target_type" = 'area'  AND "evaluations"."target_area_id" IS NOT NULL AND "evaluations"."target_class_id" IS NULL))
);
--> statement-breakpoint
CREATE TABLE "evidence" (
	"id" uuid PRIMARY KEY NOT NULL,
	"evaluation_id" uuid,
	"uploaded_by" uuid NOT NULL,
	"kind" "evidence_kind" NOT NULL,
	"file_path" text NOT NULL,
	"sha256" text NOT NULL,
	"width" integer NOT NULL,
	"height" integer NOT NULL,
	"bytes" integer NOT NULL,
	"captured_at" timestamp with time zone NOT NULL,
	"sort_order" smallint DEFAULT 0 NOT NULL,
	"removed_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "guide_pages" (
	"id" uuid PRIMARY KEY NOT NULL,
	"slug" text NOT NULL,
	"title" text NOT NULL,
	"body_md" text NOT NULL,
	"audience" text DEFAULT 'public' NOT NULL,
	"sort_order" smallint DEFAULT 0 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "notifications" (
	"id" uuid PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"type" text NOT NULL,
	"title" text NOT NULL,
	"body" text NOT NULL,
	"link" text,
	"read_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "pdf_documents" (
	"id" uuid PRIMARY KEY NOT NULL,
	"evaluation_id" uuid NOT NULL,
	"evaluation_version" integer NOT NULL,
	"doc_number" text NOT NULL,
	"version" integer NOT NULL,
	"is_draft" boolean NOT NULL,
	"file_path" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"superseded_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "physical_rooms" (
	"id" uuid PRIMARY KEY NOT NULL,
	"building_id" uuid NOT NULL,
	"room_number" text NOT NULL,
	"floor" smallint,
	"qr_token" text NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL
);
--> statement-breakpoint
CREATE TABLE "push_subscriptions" (
	"id" uuid PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"endpoint" text NOT NULL,
	"p256dh" text NOT NULL,
	"auth" text NOT NULL,
	"user_agent" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_success_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "requests" (
	"id" uuid PRIMARY KEY NOT NULL,
	"type" "request_type" NOT NULL,
	"status" "request_status" DEFAULT 'waiting' NOT NULL,
	"requester_id" uuid NOT NULL,
	"round_id" uuid NOT NULL,
	"component_id" uuid,
	"evaluation_id" uuid,
	"target_type" "target_type",
	"target_class_id" uuid,
	"target_area_id" uuid,
	"reason" text NOT NULL,
	"payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"decided_by" uuid,
	"decided_at" timestamp with time zone,
	"decision_note" text,
	"grant_until" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "roster_snapshots" (
	"round_id" uuid NOT NULL,
	"student_id" uuid NOT NULL,
	"class_id" uuid NOT NULL,
	CONSTRAINT "roster_snapshots_round_id_student_id_pk" PRIMARY KEY("round_id","student_id")
);
--> statement-breakpoint
CREATE TABLE "round_area_results" (
	"round_id" uuid NOT NULL,
	"area_id" uuid NOT NULL,
	"score" numeric(6, 3) NOT NULL,
	"rank" smallint NOT NULL,
	"frozen" boolean DEFAULT false NOT NULL,
	"computed_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "round_area_results_round_id_area_id_pk" PRIMARY KEY("round_id","area_id")
);
--> statement-breakpoint
CREATE TABLE "round_class_areas" (
	"round_id" uuid NOT NULL,
	"class_id" uuid NOT NULL,
	"area_id" uuid NOT NULL,
	"physical_room_id" uuid,
	CONSTRAINT "round_class_areas_round_id_class_id_pk" PRIMARY KEY("round_id","class_id")
);
--> statement-breakpoint
CREATE TABLE "round_class_results" (
	"round_id" uuid NOT NULL,
	"class_id" uuid NOT NULL,
	"area_id" uuid,
	"class_score" numeric(6, 3) NOT NULL,
	"area_score" numeric(6, 3) NOT NULL,
	"deduction" numeric(6, 3) NOT NULL,
	"total" numeric(6, 3) NOT NULL,
	"rank_in_group" smallint NOT NULL,
	"frozen" boolean DEFAULT false NOT NULL,
	"computed_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "round_class_results_round_id_class_id_pk" PRIMARY KEY("round_id","class_id")
);
--> statement-breakpoint
CREATE TABLE "round_component_max" (
	"round_id" uuid NOT NULL,
	"component_id" uuid NOT NULL,
	"max_value" numeric(6, 3) NOT NULL,
	CONSTRAINT "round_component_max_round_id_component_id_pk" PRIMARY KEY("round_id","component_id")
);
--> statement-breakpoint
CREATE TABLE "round_student_results" (
	"round_id" uuid NOT NULL,
	"student_id" uuid NOT NULL,
	"class_id" uuid NOT NULL,
	"total" numeric(6, 3) NOT NULL,
	CONSTRAINT "round_student_results_round_id_student_id_pk" PRIMARY KEY("round_id","student_id")
);
--> statement-breakpoint
CREATE TABLE "rounds" (
	"id" uuid PRIMARY KEY NOT NULL,
	"term_id" uuid NOT NULL,
	"round_no" smallint NOT NULL,
	"opens_at" timestamp with time zone NOT NULL,
	"closes_at" timestamp with time zone NOT NULL,
	"status" "round_status" DEFAULT 'scheduled' NOT NULL,
	"finalized_at" timestamp with time zone,
	"finalized_by" uuid,
	CONSTRAINT "rounds_dates" CHECK ("rounds"."closes_at" > "rounds"."opens_at")
);
--> statement-breakpoint
CREATE TABLE "score_components" (
	"id" uuid PRIMARY KEY NOT NULL,
	"term_id" uuid NOT NULL,
	"key" text NOT NULL,
	"label" text NOT NULL,
	"unit" "component_unit" NOT NULL,
	"source" "component_source" DEFAULT 'committee' NOT NULL,
	"kind" "component_kind" DEFAULT 'score' NOT NULL,
	"max_value" numeric(6, 3) NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"requires_signature" boolean DEFAULT true NOT NULL,
	"sort_order" smallint DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sessions" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"ip" text,
	"user_agent" text
);
--> statement-breakpoint
CREATE TABLE "students" (
	"id" uuid PRIMARY KEY NOT NULL,
	"student_code" text NOT NULL,
	"full_name" text NOT NULL,
	"general_class_id" uuid,
	"religious_class_id" uuid,
	"home_class_id" uuid,
	"status" "student_status" DEFAULT 'active' NOT NULL,
	"review_reason" text,
	"first_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"delete_after" date NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sync_runs" (
	"id" uuid PRIMARY KEY NOT NULL,
	"source" "sync_source" NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone,
	"status" "sync_status",
	"counts" jsonb,
	"changes" jsonb,
	"error" text,
	"triggered_by" uuid
);
--> statement-breakpoint
CREATE TABLE "term_class_zones" (
	"term_id" uuid NOT NULL,
	"class_id" uuid NOT NULL,
	"area_id" uuid NOT NULL,
	CONSTRAINT "term_class_zones_term_id_class_id_pk" PRIMARY KEY("term_id","class_id")
);
--> statement-breakpoint
CREATE TABLE "term_classes" (
	"term_id" uuid NOT NULL,
	"class_id" uuid NOT NULL,
	CONSTRAINT "term_classes_term_id_class_id_pk" PRIMARY KEY("term_id","class_id")
);
--> statement-breakpoint
CREATE TABLE "terms" (
	"id" uuid PRIMARY KEY NOT NULL,
	"academic_year" smallint NOT NULL,
	"term_no" smallint NOT NULL,
	"status" "term_status" DEFAULT 'draft' NOT NULL,
	"area_type" "area_type" NOT NULL,
	"room_mode" "score_mode" DEFAULT 'group' NOT NULL,
	"area_mode" "score_mode" DEFAULT 'group' NOT NULL,
	"score_format" "score_format" DEFAULT 'decimal' NOT NULL,
	"score_step" numeric(6, 3) DEFAULT '0.500' NOT NULL,
	"final_max" numeric(6, 3) NOT NULL,
	"self_edit_hours" smallint DEFAULT 24 NOT NULL,
	"late_entry_default_hours" smallint DEFAULT 24 NOT NULL,
	"photo_min" smallint DEFAULT 3 NOT NULL,
	"photo_max" smallint DEFAULT 5 NOT NULL,
	"comment_max" smallint DEFAULT 300 NOT NULL,
	"student_level_enabled" boolean DEFAULT false NOT NULL,
	"reminder_hours" jsonb DEFAULT '[72,24]'::jsonb NOT NULL,
	"public_rankings_visible" boolean DEFAULT true NOT NULL,
	"public_show_live_scores" boolean DEFAULT true NOT NULL,
	"copied_from_term_id" uuid,
	"config_locked_at" timestamp with time zone,
	"closed_at" timestamp with time zone,
	"purge_after" date,
	"purged_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "terms_photo_range" CHECK ("terms"."photo_min" >= 0 AND "terms"."photo_max" >= "terms"."photo_min" AND "terms"."photo_max" <= 10),
	CONSTRAINT "terms_step_positive" CHECK ("terms"."score_step" > 0)
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY NOT NULL,
	"username" text NOT NULL,
	"display_name" text NOT NULL,
	"role" "role" NOT NULL,
	"auth_source" "auth_source" DEFAULT 'local' NOT NULL,
	"external_id" text,
	"password_hash" text,
	"must_change_password" boolean DEFAULT false NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"last_login_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "zone_places" (
	"id" uuid PRIMARY KEY NOT NULL,
	"zone_id" uuid NOT NULL,
	"building_id" uuid,
	"label" text NOT NULL,
	"sort_order" smallint DEFAULT 0 NOT NULL
);
--> statement-breakpoint
ALTER TABLE "app_settings" ADD CONSTRAINT "app_settings_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "appointment_orders" ADD CONSTRAINT "appointment_orders_term_id_terms_id_fk" FOREIGN KEY ("term_id") REFERENCES "public"."terms"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "appointment_orders" ADD CONSTRAINT "appointment_orders_uploaded_by_users_id_fk" FOREIGN KEY ("uploaded_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "class_aliases" ADD CONSTRAINT "class_aliases_class_id_classes_id_fk" FOREIGN KEY ("class_id") REFERENCES "public"."classes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "class_room_links" ADD CONSTRAINT "class_room_links_class_id_classes_id_fk" FOREIGN KEY ("class_id") REFERENCES "public"."classes"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "class_room_links" ADD CONSTRAINT "class_room_links_physical_room_id_physical_rooms_id_fk" FOREIGN KEY ("physical_room_id") REFERENCES "public"."physical_rooms"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "class_room_links" ADD CONSTRAINT "class_room_links_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "duties" ADD CONSTRAINT "duties_term_id_terms_id_fk" FOREIGN KEY ("term_id") REFERENCES "public"."terms"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "duties" ADD CONSTRAINT "duties_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "duties" ADD CONSTRAINT "duties_target_class_id_classes_id_fk" FOREIGN KEY ("target_class_id") REFERENCES "public"."classes"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "duties" ADD CONSTRAINT "duties_target_area_id_areas_id_fk" FOREIGN KEY ("target_area_id") REFERENCES "public"."areas"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "duties" ADD CONSTRAINT "duties_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "evaluation_student_scores" ADD CONSTRAINT "evaluation_student_scores_evaluation_id_evaluations_id_fk" FOREIGN KEY ("evaluation_id") REFERENCES "public"."evaluations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "evaluation_student_scores" ADD CONSTRAINT "evaluation_student_scores_student_id_students_id_fk" FOREIGN KEY ("student_id") REFERENCES "public"."students"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "evaluations" ADD CONSTRAINT "evaluations_round_id_rounds_id_fk" FOREIGN KEY ("round_id") REFERENCES "public"."rounds"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "evaluations" ADD CONSTRAINT "evaluations_component_id_score_components_id_fk" FOREIGN KEY ("component_id") REFERENCES "public"."score_components"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "evaluations" ADD CONSTRAINT "evaluations_target_class_id_classes_id_fk" FOREIGN KEY ("target_class_id") REFERENCES "public"."classes"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "evaluations" ADD CONSTRAINT "evaluations_target_area_id_areas_id_fk" FOREIGN KEY ("target_area_id") REFERENCES "public"."areas"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "evaluations" ADD CONSTRAINT "evaluations_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "evaluations" ADD CONSTRAINT "evaluations_approved_by_users_id_fk" FOREIGN KEY ("approved_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "evidence" ADD CONSTRAINT "evidence_evaluation_id_evaluations_id_fk" FOREIGN KEY ("evaluation_id") REFERENCES "public"."evaluations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "evidence" ADD CONSTRAINT "evidence_uploaded_by_users_id_fk" FOREIGN KEY ("uploaded_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pdf_documents" ADD CONSTRAINT "pdf_documents_evaluation_id_evaluations_id_fk" FOREIGN KEY ("evaluation_id") REFERENCES "public"."evaluations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "physical_rooms" ADD CONSTRAINT "physical_rooms_building_id_areas_id_fk" FOREIGN KEY ("building_id") REFERENCES "public"."areas"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "push_subscriptions" ADD CONSTRAINT "push_subscriptions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "requests" ADD CONSTRAINT "requests_requester_id_users_id_fk" FOREIGN KEY ("requester_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "requests" ADD CONSTRAINT "requests_round_id_rounds_id_fk" FOREIGN KEY ("round_id") REFERENCES "public"."rounds"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "requests" ADD CONSTRAINT "requests_component_id_score_components_id_fk" FOREIGN KEY ("component_id") REFERENCES "public"."score_components"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "requests" ADD CONSTRAINT "requests_evaluation_id_evaluations_id_fk" FOREIGN KEY ("evaluation_id") REFERENCES "public"."evaluations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "requests" ADD CONSTRAINT "requests_target_class_id_classes_id_fk" FOREIGN KEY ("target_class_id") REFERENCES "public"."classes"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "requests" ADD CONSTRAINT "requests_target_area_id_areas_id_fk" FOREIGN KEY ("target_area_id") REFERENCES "public"."areas"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "requests" ADD CONSTRAINT "requests_decided_by_users_id_fk" FOREIGN KEY ("decided_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "roster_snapshots" ADD CONSTRAINT "roster_snapshots_round_id_rounds_id_fk" FOREIGN KEY ("round_id") REFERENCES "public"."rounds"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "roster_snapshots" ADD CONSTRAINT "roster_snapshots_student_id_students_id_fk" FOREIGN KEY ("student_id") REFERENCES "public"."students"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "roster_snapshots" ADD CONSTRAINT "roster_snapshots_class_id_classes_id_fk" FOREIGN KEY ("class_id") REFERENCES "public"."classes"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "round_area_results" ADD CONSTRAINT "round_area_results_round_id_rounds_id_fk" FOREIGN KEY ("round_id") REFERENCES "public"."rounds"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "round_area_results" ADD CONSTRAINT "round_area_results_area_id_areas_id_fk" FOREIGN KEY ("area_id") REFERENCES "public"."areas"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "round_class_areas" ADD CONSTRAINT "round_class_areas_round_id_rounds_id_fk" FOREIGN KEY ("round_id") REFERENCES "public"."rounds"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "round_class_areas" ADD CONSTRAINT "round_class_areas_class_id_classes_id_fk" FOREIGN KEY ("class_id") REFERENCES "public"."classes"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "round_class_areas" ADD CONSTRAINT "round_class_areas_area_id_areas_id_fk" FOREIGN KEY ("area_id") REFERENCES "public"."areas"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "round_class_areas" ADD CONSTRAINT "round_class_areas_physical_room_id_physical_rooms_id_fk" FOREIGN KEY ("physical_room_id") REFERENCES "public"."physical_rooms"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "round_class_results" ADD CONSTRAINT "round_class_results_round_id_rounds_id_fk" FOREIGN KEY ("round_id") REFERENCES "public"."rounds"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "round_class_results" ADD CONSTRAINT "round_class_results_class_id_classes_id_fk" FOREIGN KEY ("class_id") REFERENCES "public"."classes"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "round_class_results" ADD CONSTRAINT "round_class_results_area_id_areas_id_fk" FOREIGN KEY ("area_id") REFERENCES "public"."areas"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "round_component_max" ADD CONSTRAINT "round_component_max_round_id_rounds_id_fk" FOREIGN KEY ("round_id") REFERENCES "public"."rounds"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "round_component_max" ADD CONSTRAINT "round_component_max_component_id_score_components_id_fk" FOREIGN KEY ("component_id") REFERENCES "public"."score_components"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "round_student_results" ADD CONSTRAINT "round_student_results_round_id_rounds_id_fk" FOREIGN KEY ("round_id") REFERENCES "public"."rounds"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "round_student_results" ADD CONSTRAINT "round_student_results_student_id_students_id_fk" FOREIGN KEY ("student_id") REFERENCES "public"."students"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "round_student_results" ADD CONSTRAINT "round_student_results_class_id_classes_id_fk" FOREIGN KEY ("class_id") REFERENCES "public"."classes"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rounds" ADD CONSTRAINT "rounds_term_id_terms_id_fk" FOREIGN KEY ("term_id") REFERENCES "public"."terms"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rounds" ADD CONSTRAINT "rounds_finalized_by_users_id_fk" FOREIGN KEY ("finalized_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "score_components" ADD CONSTRAINT "score_components_term_id_terms_id_fk" FOREIGN KEY ("term_id") REFERENCES "public"."terms"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "students" ADD CONSTRAINT "students_general_class_id_classes_id_fk" FOREIGN KEY ("general_class_id") REFERENCES "public"."classes"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "students" ADD CONSTRAINT "students_religious_class_id_classes_id_fk" FOREIGN KEY ("religious_class_id") REFERENCES "public"."classes"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "students" ADD CONSTRAINT "students_home_class_id_classes_id_fk" FOREIGN KEY ("home_class_id") REFERENCES "public"."classes"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sync_runs" ADD CONSTRAINT "sync_runs_triggered_by_users_id_fk" FOREIGN KEY ("triggered_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "term_class_zones" ADD CONSTRAINT "term_class_zones_term_id_terms_id_fk" FOREIGN KEY ("term_id") REFERENCES "public"."terms"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "term_class_zones" ADD CONSTRAINT "term_class_zones_class_id_classes_id_fk" FOREIGN KEY ("class_id") REFERENCES "public"."classes"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "term_class_zones" ADD CONSTRAINT "term_class_zones_area_id_areas_id_fk" FOREIGN KEY ("area_id") REFERENCES "public"."areas"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "term_classes" ADD CONSTRAINT "term_classes_term_id_terms_id_fk" FOREIGN KEY ("term_id") REFERENCES "public"."terms"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "term_classes" ADD CONSTRAINT "term_classes_class_id_classes_id_fk" FOREIGN KEY ("class_id") REFERENCES "public"."classes"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "zone_places" ADD CONSTRAINT "zone_places_zone_id_areas_id_fk" FOREIGN KEY ("zone_id") REFERENCES "public"."areas"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "zone_places" ADD CONSTRAINT "zone_places_building_id_areas_id_fk" FOREIGN KEY ("building_id") REFERENCES "public"."areas"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "areas_type_code_uq" ON "areas" USING btree ("type","code");--> statement-breakpoint
CREATE INDEX "audit_entity_idx" ON "audit_logs" USING btree ("entity","entity_id");--> statement-breakpoint
CREATE INDEX "audit_at_idx" ON "audit_logs" USING btree ("at");--> statement-breakpoint
CREATE UNIQUE INDEX "class_aliases_alias_uq" ON "class_aliases" USING btree ("alias");--> statement-breakpoint
CREATE UNIQUE INDEX "class_skip_rules_prefix_uq" ON "class_skip_rules" USING btree ("prefix");--> statement-breakpoint
CREATE UNIQUE INDEX "classes_track_grade_name_uq" ON "classes" USING btree ("track","grade_code","name");--> statement-breakpoint
CREATE INDEX "duties_user_term_idx" ON "duties" USING btree ("user_id","term_id");--> statement-breakpoint
CREATE INDEX "evaluations_round_idx" ON "evaluations" USING btree ("round_id","status");--> statement-breakpoint
CREATE INDEX "evaluations_owner_idx" ON "evaluations" USING btree ("owner_id");--> statement-breakpoint
CREATE INDEX "evidence_eval_idx" ON "evidence" USING btree ("evaluation_id");--> statement-breakpoint
CREATE UNIQUE INDEX "guide_slug_uq" ON "guide_pages" USING btree ("slug");--> statement-breakpoint
CREATE INDEX "notifications_user_idx" ON "notifications" USING btree ("user_id","read_at");--> statement-breakpoint
CREATE UNIQUE INDEX "pdf_eval_version_uq" ON "pdf_documents" USING btree ("evaluation_id","version");--> statement-breakpoint
CREATE UNIQUE INDEX "rooms_number_uq" ON "physical_rooms" USING btree ("room_number");--> statement-breakpoint
CREATE UNIQUE INDEX "rooms_qr_uq" ON "physical_rooms" USING btree ("qr_token");--> statement-breakpoint
CREATE UNIQUE INDEX "push_endpoint_uq" ON "push_subscriptions" USING btree ("endpoint");--> statement-breakpoint
CREATE INDEX "requests_status_idx" ON "requests" USING btree ("status","created_at");--> statement-breakpoint
CREATE INDEX "roster_round_class_idx" ON "roster_snapshots" USING btree ("round_id","class_id");--> statement-breakpoint
CREATE UNIQUE INDEX "rounds_term_no_uq" ON "rounds" USING btree ("term_id","round_no");--> statement-breakpoint
CREATE UNIQUE INDEX "components_term_key_uq" ON "score_components" USING btree ("term_id","key");--> statement-breakpoint
CREATE INDEX "sessions_user_idx" ON "sessions" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "students_code_uq" ON "students" USING btree ("student_code");--> statement-breakpoint
CREATE INDEX "students_home_idx" ON "students" USING btree ("home_class_id");--> statement-breakpoint
CREATE UNIQUE INDEX "terms_year_no_uq" ON "terms" USING btree ("academic_year","term_no");--> statement-breakpoint
CREATE UNIQUE INDEX "users_username_uq" ON "users" USING btree (lower("username"));--> statement-breakpoint
CREATE UNIQUE INDEX "users_external_uq" ON "users" USING btree ("auth_source","external_id");--> statement-breakpoint
CREATE INDEX "zone_places_zone_idx" ON "zone_places" USING btree ("zone_id");