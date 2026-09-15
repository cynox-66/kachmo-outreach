CREATE TABLE "account" (
	"id" text PRIMARY KEY NOT NULL,
	"account_id" text NOT NULL,
	"provider_id" text NOT NULL,
	"user_id" text NOT NULL,
	"access_token" text,
	"refresh_token" text,
	"id_token" text,
	"access_token_expires_at" timestamp,
	"refresh_token_expires_at" timestamp,
	"scope" text,
	"password" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp NOT NULL
);
--> statement-breakpoint
CREATE TABLE "session" (
	"id" text PRIMARY KEY NOT NULL,
	"expires_at" timestamp NOT NULL,
	"token" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp NOT NULL,
	"ip_address" text,
	"user_agent" text,
	"user_id" text NOT NULL,
	CONSTRAINT "session_token_unique" UNIQUE("token")
);
--> statement-breakpoint
CREATE TABLE "user" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"email" text NOT NULL,
	"email_verified" boolean DEFAULT false NOT NULL,
	"image" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"deactivated_at" timestamp with time zone,
	CONSTRAINT "user_email_unique" UNIQUE("email")
);
--> statement-breakpoint
CREATE TABLE "user_role" (
	"user_id" text NOT NULL,
	"role" text NOT NULL,
	"granted_at" timestamp with time zone DEFAULT now() NOT NULL,
	"granted_by_user_id" text,
	CONSTRAINT "user_role_user_id_role_pk" PRIMARY KEY("user_id","role"),
	CONSTRAINT "user_role_role_check" CHECK ("user_role"."role" in ('OWNER', 'ADMIN', 'RESEARCHER', 'OUTREACH', 'INTERN', 'VIEWER'))
);
--> statement-breakpoint
CREATE TABLE "verification" (
	"id" text PRIMARY KEY NOT NULL,
	"identifier" text NOT NULL,
	"value" text NOT NULL,
	"expires_at" timestamp NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "methodology_version" (
	"id" text PRIMARY KEY NOT NULL,
	"status" text NOT NULL,
	"title" text NOT NULL,
	"description" text NOT NULL,
	"config" jsonb NOT NULL,
	"golden_baseline_sha256" text,
	"created_by_label" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"activated_at" timestamp with time zone,
	"retired_at" timestamp with time zone,
	CONSTRAINT "methodology_version_status_check" CHECK ("methodology_version"."status" in ('DRAFT', 'ACTIVE', 'RETIRED')),
	CONSTRAINT "methodology_version_id_format_check" CHECK ("methodology_version"."id" ~ '^[0-9]+\.[0-9]+$')
);
--> statement-breakpoint
CREATE TABLE "lead" (
	"lead_id" uuid PRIMARY KEY NOT NULL,
	"target_number" text NOT NULL,
	"company_name" text NOT NULL,
	"website_url" text NOT NULL,
	"archetype_id" text NOT NULL,
	"location_country" text NOT NULL,
	"research_state" text NOT NULL,
	"lead_priority" text,
	"priority_confidence" text,
	"research_completeness_score" integer NOT NULL,
	"kachmo_score" integer,
	"phone_status" text NOT NULL,
	"email_status" text NOT NULL,
	"do_not_contact" boolean DEFAULT false NOT NULL,
	"owner" text,
	"next_action_date" text,
	"record" jsonb NOT NULL,
	"record_sha256" text NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"record_created_at" text NOT NULL,
	"record_updated_at" text NOT NULL,
	"archived_at" timestamp with time zone,
	"inserted_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "lead_target_number_unique" UNIQUE("target_number"),
	CONSTRAINT "lead_record_identity_check" CHECK (("lead"."record" ->> 'lead_id') = "lead"."lead_id"::text and ("lead"."record" ->> 'target_number') = "lead"."target_number"),
	CONSTRAINT "lead_research_state_check" CHECK ("lead"."research_state" in ('DISCOVERED', 'QUALIFICATION_PENDING', 'RESEARCH_REQUIRED', 'ENRICHED', 'QUALIFIED', 'DISQUALIFIED', 'OUTREACH_READY')),
	CONSTRAINT "lead_phone_status_check" CHECK ("lead"."phone_status" in ('UNKNOWN', 'INFERRED', 'UNVERIFIED', 'PUBLICLY_LISTED', 'VERIFIED', 'INVALID')),
	CONSTRAINT "lead_email_status_check" CHECK ("lead"."email_status" in ('UNKNOWN', 'INFERRED', 'UNVERIFIED', 'PUBLICLY_LISTED', 'VERIFIED', 'INVALID')),
	CONSTRAINT "lead_priority_check" CHECK ("lead"."lead_priority" is null or "lead"."lead_priority" in ('A+', 'A', 'B', 'C', 'DISQUALIFIED')),
	CONSTRAINT "lead_priority_confidence_check" CHECK ("lead"."priority_confidence" is null or "lead"."priority_confidence" in ('CONFIRMED', 'PROVISIONAL')),
	CONSTRAINT "lead_completeness_range_check" CHECK ("lead"."research_completeness_score" between 0 and 100),
	CONSTRAINT "lead_kachmo_score_range_check" CHECK ("lead"."kachmo_score" is null or "lead"."kachmo_score" between 0 and 100),
	CONSTRAINT "lead_dnc_disqualified_check" CHECK (not "lead"."do_not_contact" or "lead"."research_state" = 'DISQUALIFIED'),
	CONSTRAINT "lead_version_positive_check" CHECK ("lead"."version" >= 1)
);
--> statement-breakpoint
CREATE TABLE "lead_evaluation" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"lead_id" uuid NOT NULL,
	"methodology_version_id" text NOT NULL,
	"engine_ref" text NOT NULL,
	"input_sha256" text NOT NULL,
	"gates" jsonb NOT NULL,
	"missing_intelligence" jsonb NOT NULL,
	"reasons" jsonb NOT NULL,
	"research_state" text NOT NULL,
	"research_completeness_score" integer NOT NULL,
	"scores" jsonb NOT NULL,
	"lead_priority" text,
	"priority_confidence" text,
	"actor_label" text NOT NULL,
	"actor_user_id" text,
	"computed_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "lead_evidence" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"lead_id" uuid NOT NULL,
	"field" text NOT NULL,
	"claim_value" text,
	"source_url" text,
	"source_type" text NOT NULL,
	"observed_at" text,
	"origin" text NOT NULL,
	"review_status" text DEFAULT 'UNREVIEWED' NOT NULL,
	"reviewed_by_user_id" text,
	"reviewed_at" timestamp with time zone,
	"contradicts_evidence_id" uuid,
	"recorded_by_user_id" text,
	"recorded_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "lead_evidence_origin_check" CHECK ("lead_evidence"."origin" in ('LEGACY_RECORD', 'HUMAN_RECORD', 'EXTERNAL_RESEARCH', 'IDE_AGENT', 'CALL')),
	CONSTRAINT "lead_evidence_review_status_check" CHECK ("lead_evidence"."review_status" in ('UNREVIEWED', 'CHECKED', 'REJECTED')),
	CONSTRAINT "lead_evidence_review_consistency_check" CHECK (("lead_evidence"."review_status" = 'UNREVIEWED') = ("lead_evidence"."reviewed_at" is null))
);
--> statement-breakpoint
CREATE TABLE "analytics_event" (
	"event_id" text PRIMARY KEY NOT NULL,
	"sequence" integer NOT NULL,
	"lead_id" text,
	"target_number" text,
	"company_name" text,
	"event_type" text NOT NULL,
	"channel" text NOT NULL,
	"actor" text NOT NULL,
	"occurred_at" text NOT NULL,
	"payload" jsonb NOT NULL,
	"inserted_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "analytics_event_sequence_unique" UNIQUE("sequence")
);
--> statement-breakpoint
CREATE TABLE "audit_event" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL,
	"actor_user_id" text,
	"actor_label" text NOT NULL,
	"action" text NOT NULL,
	"target_type" text NOT NULL,
	"target_id" text,
	"request_id" text,
	"ip_hash" text,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"before" jsonb,
	"after" jsonb,
	CONSTRAINT "audit_event_action_format_check" CHECK ("audit_event"."action" ~ '^[a-z][a-z_]*(\.[a-z][a-z_]*)+$')
);
--> statement-breakpoint
CREATE TABLE "suppression_entry" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"sequence" integer NOT NULL,
	"lead_id" text,
	"target_number" text,
	"company_name" text,
	"email" text,
	"phone" text,
	"domain" text,
	"reason" text NOT NULL,
	"suppressed_at" text NOT NULL,
	"source" text NOT NULL,
	"created_by_user_id" text,
	"inserted_at" timestamp with time zone DEFAULT now() NOT NULL,
	"revoked_at" timestamp with time zone,
	"revoked_by_user_id" text,
	"revoke_reason" text,
	CONSTRAINT "suppression_entry_sequence_unique" UNIQUE("sequence"),
	CONSTRAINT "suppression_entry_identifier_check" CHECK (coalesce(btrim("suppression_entry"."lead_id"), '') <> '' or coalesce(btrim("suppression_entry"."target_number"), '') <> '' or coalesce(btrim("suppression_entry"."email"), '') <> '' or coalesce(btrim("suppression_entry"."phone"), '') <> '' or coalesce(btrim("suppression_entry"."domain"), '') <> ''),
	CONSTRAINT "suppression_entry_revocation_check" CHECK (("suppression_entry"."revoked_at" is null) = ("suppression_entry"."revoke_reason" is null))
);
--> statement-breakpoint
ALTER TABLE "account" ADD CONSTRAINT "account_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "session" ADD CONSTRAINT "session_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_role" ADD CONSTRAINT "user_role_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lead_evaluation" ADD CONSTRAINT "lead_evaluation_lead_id_lead_lead_id_fk" FOREIGN KEY ("lead_id") REFERENCES "public"."lead"("lead_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lead_evaluation" ADD CONSTRAINT "lead_evaluation_methodology_version_id_methodology_version_id_fk" FOREIGN KEY ("methodology_version_id") REFERENCES "public"."methodology_version"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lead_evidence" ADD CONSTRAINT "lead_evidence_lead_id_lead_lead_id_fk" FOREIGN KEY ("lead_id") REFERENCES "public"."lead"("lead_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "account_user_id_idx" ON "account" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "session_user_id_idx" ON "session" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "verification_identifier_idx" ON "verification" USING btree ("identifier");--> statement-breakpoint
CREATE UNIQUE INDEX "methodology_version_single_active_idx" ON "methodology_version" USING btree ("status") WHERE "methodology_version"."status" = 'ACTIVE';--> statement-breakpoint
CREATE INDEX "lead_archetype_idx" ON "lead" USING btree ("archetype_id");--> statement-breakpoint
CREATE INDEX "lead_research_state_idx" ON "lead" USING btree ("research_state");--> statement-breakpoint
CREATE INDEX "lead_priority_idx" ON "lead" USING btree ("lead_priority");--> statement-breakpoint
CREATE INDEX "lead_evaluation_lead_idx" ON "lead_evaluation" USING btree ("lead_id","computed_at");--> statement-breakpoint
CREATE INDEX "lead_evidence_lead_field_idx" ON "lead_evidence" USING btree ("lead_id","field");--> statement-breakpoint
CREATE INDEX "analytics_event_lead_idx" ON "analytics_event" USING btree ("lead_id");--> statement-breakpoint
CREATE INDEX "analytics_event_type_idx" ON "analytics_event" USING btree ("event_type");--> statement-breakpoint
CREATE INDEX "audit_event_occurred_idx" ON "audit_event" USING btree ("occurred_at");--> statement-breakpoint
CREATE INDEX "audit_event_target_idx" ON "audit_event" USING btree ("target_type","target_id");--> statement-breakpoint
CREATE INDEX "audit_event_actor_idx" ON "audit_event" USING btree ("actor_user_id");--> statement-breakpoint
CREATE INDEX "suppression_entry_target_idx" ON "suppression_entry" USING btree ("target_number");--> statement-breakpoint
CREATE INDEX "suppression_entry_email_idx" ON "suppression_entry" USING btree ("email");--> statement-breakpoint
CREATE INDEX "suppression_entry_domain_idx" ON "suppression_entry" USING btree ("domain");