CREATE TABLE "job_run" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"job" text NOT NULL,
	"idempotency_key" text NOT NULL,
	"status" text NOT NULL,
	"attempt" integer DEFAULT 1 NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone,
	"lease_until" timestamp with time zone NOT NULL,
	"actor_label" text NOT NULL,
	"summary" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"error" text,
	CONSTRAINT "job_run_idempotency_key_unique" UNIQUE("idempotency_key"),
	CONSTRAINT "job_run_status_check" CHECK ("job_run"."status" in ('RUNNING', 'SUCCEEDED', 'FAILED', 'ABANDONED')),
	CONSTRAINT "job_run_attempt_check" CHECK ("job_run"."attempt" between 1 and 10),
	CONSTRAINT "job_run_finished_check" CHECK (("job_run"."status" = 'RUNNING') = ("job_run"."finished_at" is null))
);
--> statement-breakpoint
CREATE INDEX "job_run_job_idx" ON "job_run" USING btree ("job","started_at");--> statement-breakpoint

-- The job ledger is history: rows are never deleted, and a finished run is never reopened or rewritten (ADR-033).
-- The only legal moves are RUNNING → SUCCEEDED/FAILED/ABANDONED, and a retry of a FAILED or ABANDONED key.
CREATE OR REPLACE FUNCTION kachmo_job_run_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'kachmo: job runs are never deleted' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF NEW.id IS DISTINCT FROM OLD.id OR NEW.job IS DISTINCT FROM OLD.job OR NEW.idempotency_key IS DISTINCT FROM OLD.idempotency_key THEN
    RAISE EXCEPTION 'kachmo: a job run keeps its identity' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF OLD.status = 'SUCCEEDED' THEN
    RAISE EXCEPTION 'kachmo: work recorded as done is never re-run under the same key' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF OLD.status = 'RUNNING' AND NEW.status = 'RUNNING' AND NEW.attempt = OLD.attempt THEN
    RAISE EXCEPTION 'kachmo: this key is already running' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF NEW.status = 'RUNNING' AND NEW.attempt <= OLD.attempt THEN
    RAISE EXCEPTION 'kachmo: a retry must increment the attempt' USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER job_run_guard BEFORE UPDATE OR DELETE ON "job_run" FOR EACH ROW EXECUTE FUNCTION kachmo_job_run_guard();
--> statement-breakpoint
CREATE TRIGGER job_run_no_truncate BEFORE TRUNCATE ON "job_run" FOR EACH STATEMENT EXECUTE FUNCTION kachmo_reject_modification();
