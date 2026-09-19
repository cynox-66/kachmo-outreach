CREATE TABLE "user_engine_actor" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"engine_actor" text NOT NULL,
	"bound_by_label" text NOT NULL,
	"bound_at" timestamp with time zone DEFAULT now() NOT NULL,
	"revoked_at" timestamp with time zone,
	"revoked_by_label" text,
	CONSTRAINT "user_engine_actor_value_check" CHECK ("user_engine_actor"."engine_actor" in ('DEV', 'AADI')),
	CONSTRAINT "user_engine_actor_revocation_check" CHECK (("user_engine_actor"."revoked_at" is null) = ("user_engine_actor"."revoked_by_label" is null))
);
--> statement-breakpoint
CREATE TABLE "evidence_retrieval" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"run_id" text NOT NULL,
	"requested_url" text NOT NULL,
	"final_url" text,
	"redirect_chain" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"http_status" integer,
	"outcome" text NOT NULL,
	"content_type" text,
	"byte_size" integer,
	"content_sha256" text,
	"text_content" text,
	"error" text,
	"user_agent" text NOT NULL,
	"fetched_by_label" text NOT NULL,
	"fetched_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "evidence_retrieval_outcome_check" CHECK ("evidence_retrieval"."outcome" in ('OK', 'DNS_FAILED', 'TIMEOUT', 'HTTP_4XX', 'HTTP_5XX', 'BLOCKED_PRIVATE_ADDRESS', 'TOO_LARGE', 'UNSUPPORTED_TYPE', 'ROBOTS_DISALLOWED', 'TLS_ERROR', 'INVALID_URL', 'TOO_MANY_REDIRECTS', 'NETWORK_ERROR')),
	CONSTRAINT "evidence_retrieval_hash_check" CHECK ("evidence_retrieval"."content_sha256" is null or "evidence_retrieval"."content_sha256" ~ '^[0-9a-f]{64}$'),
	CONSTRAINT "evidence_retrieval_ok_content_check" CHECK (("evidence_retrieval"."outcome" = 'OK') = ("evidence_retrieval"."content_sha256" is not null and "evidence_retrieval"."text_content" is not null)),
	CONSTRAINT "evidence_retrieval_text_size_check" CHECK ("evidence_retrieval"."text_content" is null or length("evidence_retrieval"."text_content") <= 262144)
);
--> statement-breakpoint
CREATE TABLE "lead_revision" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"lead_id" uuid NOT NULL,
	"version" integer NOT NULL,
	"record" jsonb NOT NULL,
	"record_sha256" text NOT NULL,
	"superseded_by" text NOT NULL,
	"written_by_user_id" text,
	"written_by_label" text NOT NULL,
	"written_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "lead_revision_lead_version_key" UNIQUE("lead_id","version"),
	CONSTRAINT "lead_revision_version_positive_check" CHECK ("lead_revision"."version" >= 1)
);
--> statement-breakpoint
ALTER TABLE "lead_evidence" ADD COLUMN "retrieval_id" uuid;--> statement-breakpoint
ALTER TABLE "lead_evidence" ADD COLUMN "supporting_excerpt" text;--> statement-breakpoint
ALTER TABLE "lead_evidence" ADD COLUMN "validator" text DEFAULT 'NONE' NOT NULL;--> statement-breakpoint
ALTER TABLE "lead_evidence" ADD COLUMN "candidate_id" uuid;--> statement-breakpoint
ALTER TABLE "lead_evidence" ADD COLUMN "recorded_by_label" text;--> statement-breakpoint
ALTER TABLE "lead_evidence" ADD COLUMN "reviewed_by_label" text;--> statement-breakpoint
ALTER TABLE "lead_evidence" ADD COLUMN "review_note" text;--> statement-breakpoint
ALTER TABLE "user_engine_actor" ADD CONSTRAINT "user_engine_actor_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lead_revision" ADD CONSTRAINT "lead_revision_lead_id_lead_lead_id_fk" FOREIGN KEY ("lead_id") REFERENCES "public"."lead"("lead_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "user_engine_actor_active_idx" ON "user_engine_actor" USING btree ("user_id") WHERE "user_engine_actor"."revoked_at" is null;--> statement-breakpoint
CREATE INDEX "evidence_retrieval_url_idx" ON "evidence_retrieval" USING btree ("requested_url");--> statement-breakpoint
CREATE INDEX "evidence_retrieval_run_idx" ON "evidence_retrieval" USING btree ("run_id");--> statement-breakpoint
ALTER TABLE "lead_evidence" ADD CONSTRAINT "lead_evidence_retrieval_id_evidence_retrieval_id_fk" FOREIGN KEY ("retrieval_id") REFERENCES "public"."evidence_retrieval"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lead_evidence" ADD CONSTRAINT "lead_evidence_candidate_id_research_candidate_id_fk" FOREIGN KEY ("candidate_id") REFERENCES "public"."research_candidate"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lead_evidence" ADD CONSTRAINT "lead_evidence_validator_check" CHECK ("lead_evidence"."validator" in ('NONE', 'SYNTAX_CHECK', 'FETCHER', 'LLM_EXTRACTION', 'HUMAN'));--> statement-breakpoint
ALTER TABLE "lead_evidence" ADD CONSTRAINT "lead_evidence_excerpt_length_check" CHECK ("lead_evidence"."supporting_excerpt" is null or length("lead_evidence"."supporting_excerpt") <= 2000);--> statement-breakpoint
ALTER TABLE "lead_evidence" ADD CONSTRAINT "lead_evidence_excerpt_retrieval_check" CHECK ("lead_evidence"."supporting_excerpt" is null or "lead_evidence"."retrieval_id" is not null);--> statement-breakpoint
ALTER TABLE "lead_evidence" ADD CONSTRAINT "lead_evidence_checked_excerpt_check" CHECK ("lead_evidence"."review_status" <> 'CHECKED' or "lead_evidence"."supporting_excerpt" is not null);--> statement-breakpoint

-- ── Phase B history guards, enforced by the database (hand-written, like 0001). ──────────────────────────────

-- lead_revision and evidence_retrieval are strictly append-only: history is never rewritten.
CREATE TRIGGER lead_revision_append_only BEFORE UPDATE OR DELETE ON "lead_revision" FOR EACH ROW EXECUTE FUNCTION kachmo_reject_modification();
--> statement-breakpoint
CREATE TRIGGER lead_revision_no_truncate BEFORE TRUNCATE ON "lead_revision" FOR EACH STATEMENT EXECUTE FUNCTION kachmo_reject_modification();
--> statement-breakpoint
CREATE TRIGGER evidence_retrieval_append_only BEFORE UPDATE OR DELETE ON "evidence_retrieval" FOR EACH ROW EXECUTE FUNCTION kachmo_reject_modification();
--> statement-breakpoint
CREATE TRIGGER evidence_retrieval_no_truncate BEFORE TRUNCATE ON "evidence_retrieval" FOR EACH STATEMENT EXECUTE FUNCTION kachmo_reject_modification();
--> statement-breakpoint

-- user_engine_actor: never deleted; the only change a binding may undergo is a single attributed revocation.
CREATE OR REPLACE FUNCTION kachmo_engine_actor_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'kachmo: engine-actor bindings are never deleted; revoke instead' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF NEW.id IS DISTINCT FROM OLD.id OR NEW.user_id IS DISTINCT FROM OLD.user_id OR NEW.engine_actor IS DISTINCT FROM OLD.engine_actor
     OR NEW.bound_by_label IS DISTINCT FROM OLD.bound_by_label OR NEW.bound_at IS DISTINCT FROM OLD.bound_at THEN
    RAISE EXCEPTION 'kachmo: an engine-actor binding is immutable; revoke it and bind again' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF OLD.revoked_at IS NOT NULL THEN
    RAISE EXCEPTION 'kachmo: this engine-actor binding was already revoked' USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER user_engine_actor_guard BEFORE UPDATE OR DELETE ON "user_engine_actor" FOR EACH ROW EXECUTE FUNCTION kachmo_engine_actor_guard();
--> statement-breakpoint
CREATE TRIGGER user_engine_actor_no_truncate BEFORE TRUNCATE ON "user_engine_actor" FOR EACH STATEMENT EXECUTE FUNCTION kachmo_reject_modification();
--> statement-breakpoint

-- lead_evidence: never deleted. What a claim said and where it came from never change. Until a human reviews it,
-- the fetcher may attach a retrieval; once reviewed, the row is final — a new judgement is a new row.
CREATE OR REPLACE FUNCTION kachmo_lead_evidence_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'kachmo: evidence is never deleted' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF OLD.review_status <> 'UNREVIEWED' THEN
    RAISE EXCEPTION 'kachmo: reviewed evidence is final; record a new evidence row instead' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF NEW.id IS DISTINCT FROM OLD.id OR NEW.lead_id IS DISTINCT FROM OLD.lead_id OR NEW.field IS DISTINCT FROM OLD.field
     OR NEW.claim_value IS DISTINCT FROM OLD.claim_value OR NEW.source_url IS DISTINCT FROM OLD.source_url
     OR NEW.source_type IS DISTINCT FROM OLD.source_type OR NEW.observed_at IS DISTINCT FROM OLD.observed_at
     OR NEW.origin IS DISTINCT FROM OLD.origin OR NEW.contradicts_evidence_id IS DISTINCT FROM OLD.contradicts_evidence_id
     OR NEW.recorded_by_user_id IS DISTINCT FROM OLD.recorded_by_user_id OR NEW.recorded_by_label IS DISTINCT FROM OLD.recorded_by_label
     OR NEW.recorded_at IS DISTINCT FROM OLD.recorded_at OR NEW.candidate_id IS DISTINCT FROM OLD.candidate_id THEN
    RAISE EXCEPTION 'kachmo: a claim and its source are immutable' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF OLD.retrieval_id IS NOT NULL AND NEW.retrieval_id IS DISTINCT FROM OLD.retrieval_id THEN
    RAISE EXCEPTION 'kachmo: evidence already checked against a retrieval keeps it' USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER lead_evidence_guard BEFORE UPDATE OR DELETE ON "lead_evidence" FOR EACH ROW EXECUTE FUNCTION kachmo_lead_evidence_guard();
--> statement-breakpoint
CREATE TRIGGER lead_evidence_no_truncate BEFORE TRUNCATE ON "lead_evidence" FOR EACH STATEMENT EXECUTE FUNCTION kachmo_reject_modification();
