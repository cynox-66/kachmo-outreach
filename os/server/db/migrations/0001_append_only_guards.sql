-- Kachmo Outbound OS: history-preservation guards, enforced by the database itself so that no application bug,
-- ORM call or ad-hoc query run through the app's connection can erase or rewrite history.

-- 1. Strictly append-only tables: no UPDATE, DELETE or TRUNCATE.
CREATE OR REPLACE FUNCTION kachmo_reject_modification() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'kachmo: % on "%" is not allowed (append-only history)', TG_OP, TG_TABLE_NAME
    USING ERRCODE = 'insufficient_privilege';
END;
$$;
--> statement-breakpoint
CREATE TRIGGER audit_event_append_only BEFORE UPDATE OR DELETE ON "audit_event" FOR EACH ROW EXECUTE FUNCTION kachmo_reject_modification();
--> statement-breakpoint
CREATE TRIGGER audit_event_no_truncate BEFORE TRUNCATE ON "audit_event" FOR EACH STATEMENT EXECUTE FUNCTION kachmo_reject_modification();
--> statement-breakpoint
CREATE TRIGGER lead_evaluation_append_only BEFORE UPDATE OR DELETE ON "lead_evaluation" FOR EACH ROW EXECUTE FUNCTION kachmo_reject_modification();
--> statement-breakpoint
CREATE TRIGGER lead_evaluation_no_truncate BEFORE TRUNCATE ON "lead_evaluation" FOR EACH STATEMENT EXECUTE FUNCTION kachmo_reject_modification();
--> statement-breakpoint
CREATE TRIGGER analytics_event_append_only BEFORE UPDATE OR DELETE ON "analytics_event" FOR EACH ROW EXECUTE FUNCTION kachmo_reject_modification();
--> statement-breakpoint
CREATE TRIGGER analytics_event_no_truncate BEFORE TRUNCATE ON "analytics_event" FOR EACH STATEMENT EXECUTE FUNCTION kachmo_reject_modification();
--> statement-breakpoint

-- 2. Never-deleted tables: rows may change through the service layer, but can never be removed (archive/deactivate instead).
CREATE TRIGGER lead_no_delete BEFORE DELETE ON "lead" FOR EACH ROW EXECUTE FUNCTION kachmo_reject_modification();
--> statement-breakpoint
CREATE TRIGGER lead_no_truncate BEFORE TRUNCATE ON "lead" FOR EACH STATEMENT EXECUTE FUNCTION kachmo_reject_modification();
--> statement-breakpoint
CREATE TRIGGER user_no_delete BEFORE DELETE ON "user" FOR EACH ROW EXECUTE FUNCTION kachmo_reject_modification();
--> statement-breakpoint
CREATE TRIGGER user_no_truncate BEFORE TRUNCATE ON "user" FOR EACH STATEMENT EXECUTE FUNCTION kachmo_reject_modification();
--> statement-breakpoint

-- 3. Suppression: never deleted; identifiers and reason immutable; a single attributed revocation is the only change.
CREATE OR REPLACE FUNCTION kachmo_suppression_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'kachmo: suppression entries are never deleted; revoke instead' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF NEW.id IS DISTINCT FROM OLD.id OR NEW.sequence IS DISTINCT FROM OLD.sequence
     OR NEW.lead_id IS DISTINCT FROM OLD.lead_id OR NEW.target_number IS DISTINCT FROM OLD.target_number
     OR NEW.company_name IS DISTINCT FROM OLD.company_name OR NEW.email IS DISTINCT FROM OLD.email
     OR NEW.phone IS DISTINCT FROM OLD.phone OR NEW.domain IS DISTINCT FROM OLD.domain
     OR NEW.reason IS DISTINCT FROM OLD.reason OR NEW.suppressed_at IS DISTINCT FROM OLD.suppressed_at
     OR NEW.source IS DISTINCT FROM OLD.source OR NEW.created_by_user_id IS DISTINCT FROM OLD.created_by_user_id
     OR NEW.inserted_at IS DISTINCT FROM OLD.inserted_at THEN
    RAISE EXCEPTION 'kachmo: suppression identifiers and reason are immutable' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF OLD.revoked_at IS NOT NULL THEN
    RAISE EXCEPTION 'kachmo: this suppression entry was already revoked' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF NEW.revoked_at IS NULL OR NEW.revoked_by_user_id IS NULL OR coalesce(btrim(NEW.revoke_reason), '') = '' THEN
    RAISE EXCEPTION 'kachmo: a revocation needs revoked_at, revoked_by_user_id and a reason' USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER suppression_entry_guard BEFORE UPDATE OR DELETE ON "suppression_entry" FOR EACH ROW EXECUTE FUNCTION kachmo_suppression_guard();
--> statement-breakpoint
CREATE TRIGGER suppression_entry_no_truncate BEFORE TRUNCATE ON "suppression_entry" FOR EACH STATEMENT EXECUTE FUNCTION kachmo_reject_modification();
--> statement-breakpoint

-- 4. Methodology versions: a version that has ever been activated keeps its content forever; it may only be retired.
CREATE OR REPLACE FUNCTION kachmo_methodology_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD.activated_at IS NOT NULL THEN
      RAISE EXCEPTION 'kachmo: methodology version % was active and can never be deleted', OLD.id USING ERRCODE = 'insufficient_privilege';
    END IF;
    RETURN OLD;
  END IF;
  IF OLD.activated_at IS NOT NULL THEN
    IF NEW.id IS DISTINCT FROM OLD.id OR NEW.title IS DISTINCT FROM OLD.title OR NEW.description IS DISTINCT FROM OLD.description
       OR NEW.config IS DISTINCT FROM OLD.config OR NEW.golden_baseline_sha256 IS DISTINCT FROM OLD.golden_baseline_sha256
       OR NEW.created_by_label IS DISTINCT FROM OLD.created_by_label OR NEW.created_at IS DISTINCT FROM OLD.created_at
       OR NEW.activated_at IS DISTINCT FROM OLD.activated_at THEN
      RAISE EXCEPTION 'kachmo: methodology version % is immutable; create a new version instead', OLD.id USING ERRCODE = 'insufficient_privilege';
    END IF;
    IF NOT (NEW.status = OLD.status OR (OLD.status = 'ACTIVE' AND NEW.status = 'RETIRED')) THEN
      RAISE EXCEPTION 'kachmo: methodology version % can only move from ACTIVE to RETIRED', OLD.id USING ERRCODE = 'insufficient_privilege';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER methodology_version_guard BEFORE UPDATE OR DELETE ON "methodology_version" FOR EACH ROW EXECUTE FUNCTION kachmo_methodology_guard();
