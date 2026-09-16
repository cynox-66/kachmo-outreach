CREATE TABLE "research_brief" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"prompt_id" text NOT NULL,
	"contract_version" text NOT NULL,
	"taxonomy_version" text NOT NULL,
	"archetype_id" text NOT NULL,
	"vertical" text,
	"geographies" jsonb NOT NULL,
	"target_count" integer NOT NULL,
	"spec" jsonb NOT NULL,
	"rendered_brief" text NOT NULL,
	"status" text DEFAULT 'OPEN' NOT NULL,
	"created_by_user_id" text,
	"created_by_label" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"closed_at" timestamp with time zone,
	CONSTRAINT "research_brief_prompt_id_unique" UNIQUE("prompt_id"),
	CONSTRAINT "research_brief_status_check" CHECK ("research_brief"."status" in ('OPEN', 'FULFILLED', 'ABANDONED')),
	CONSTRAINT "research_brief_target_count_check" CHECK ("research_brief"."target_count" between 1 and 50)
);
--> statement-breakpoint
CREATE TABLE "research_candidate" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"candidate_id" text NOT NULL,
	"report_id" uuid NOT NULL,
	"status" text DEFAULT 'EXTRACTED' NOT NULL,
	"company_name" text,
	"website_domain" text,
	"archetype_id" text,
	"location_country" text,
	"claims" jsonb NOT NULL,
	"assessment" jsonb,
	"reviewed_by_user_id" text,
	"reviewed_by_label" text,
	"reviewed_at" timestamp with time zone,
	"review_note" text,
	"resolved_lead_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "research_candidate_report_candidate_key" UNIQUE("report_id","candidate_id"),
	CONSTRAINT "research_candidate_status_check" CHECK ("research_candidate"."status" in ('EXTRACTED', 'NORMALIZED', 'DUPLICATE_SUSPECTED', 'EVIDENCE_CHECKED', 'QUALIFIED', 'AWAITING_REVIEW', 'ACCEPTED', 'REJECTED', 'DEFERRED', 'MERGED', 'SENT_BACK_FOR_RESEARCH', 'FLAGGED_CONTRADICTION', 'INCOMPLETE', 'SUPPRESSED')),
	CONSTRAINT "research_candidate_review_consistency_check" CHECK (("research_candidate"."reviewed_by_label" is null) = ("research_candidate"."reviewed_at" is null)),
	CONSTRAINT "research_candidate_resolution_check" CHECK ("research_candidate"."resolved_lead_id" is null or "research_candidate"."reviewed_by_label" is not null)
);
--> statement-breakpoint
CREATE TABLE "research_report" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"source_report_id" text NOT NULL,
	"brief_id" uuid,
	"provider" text NOT NULL,
	"operator_label" text NOT NULL,
	"uploaded_by_user_id" text,
	"original_filename" text NOT NULL,
	"byte_size" integer NOT NULL,
	"format" text NOT NULL,
	"content_sha256" text NOT NULL,
	"raw_content" text NOT NULL,
	"stage" text DEFAULT 'RECEIVED' NOT NULL,
	"extraction_status" text DEFAULT 'NOT_STARTED' NOT NULL,
	"problems" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"ingested_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "research_report_source_report_id_unique" UNIQUE("source_report_id"),
	CONSTRAINT "research_report_format_check" CHECK ("research_report"."format" in ('markdown', 'text', 'json', 'csv')),
	CONSTRAINT "research_report_stage_check" CHECK ("research_report"."stage" in ('RECEIVED', 'PARSED', 'EXTRACTED', 'NORMALIZED', 'DEDUPLICATED', 'EVIDENCE_CHECKED', 'QUALIFIED', 'AWAITING_REVIEW', 'REVIEWED', 'REJECTED')),
	CONSTRAINT "research_report_extraction_status_check" CHECK ("research_report"."extraction_status" in ('NOT_STARTED', 'OK', 'PARTIAL', 'FAILED')),
	CONSTRAINT "research_report_size_check" CHECK ("research_report"."byte_size" > 0 and "research_report"."byte_size" <= 5242880),
	CONSTRAINT "research_report_hash_check" CHECK ("research_report"."content_sha256" ~ '^[0-9a-f]{64}$')
);
--> statement-breakpoint
ALTER TABLE "research_candidate" ADD CONSTRAINT "research_candidate_report_id_research_report_id_fk" FOREIGN KEY ("report_id") REFERENCES "public"."research_report"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "research_candidate" ADD CONSTRAINT "research_candidate_resolved_lead_id_lead_lead_id_fk" FOREIGN KEY ("resolved_lead_id") REFERENCES "public"."lead"("lead_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "research_report" ADD CONSTRAINT "research_report_brief_id_research_brief_id_fk" FOREIGN KEY ("brief_id") REFERENCES "public"."research_brief"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "research_brief_archetype_idx" ON "research_brief" USING btree ("archetype_id");--> statement-breakpoint
CREATE INDEX "research_candidate_status_idx" ON "research_candidate" USING btree ("status");--> statement-breakpoint
CREATE INDEX "research_candidate_domain_idx" ON "research_candidate" USING btree ("website_domain");--> statement-breakpoint
CREATE INDEX "research_report_stage_idx" ON "research_report" USING btree ("stage");--> statement-breakpoint
CREATE INDEX "research_report_brief_idx" ON "research_report" USING btree ("brief_id");