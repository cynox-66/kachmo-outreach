# Historical send reconciliation — `webmail-sends-2026-09-12` (prepared 2026-09-18, NOT yet applied)

## Finding

A read-only IMAP investigation of the studios mailbox (folders opened with `EXAMINE`; envelopes plus one body peek;
nothing sent, flagged, moved or deleted) found 19 emails sent by hand from webmail on **2026-09-12, 14:32–14:33 UTC**.
`OUTREACH_TRACKER.md` — the ledger every send guard reads — recorded 18 of them as `DRAFTED`, which every guard
treats as never emailed. That is a duplicate-send risk.

| Target | Ledger now | After reconciliation | Sent-folder UID | Minute (UTC) |
|---|---|---|---|---|
| 018 021 080 083 078 079 073 | DRAFTED | **SENT**, channel WEBMAIL/MANUAL, not Titan | 16 17 18 19 20 21 23 | 14:32 |
| 074 052 061 049 030 033 035 020 022 016 017 | DRAFTED | **SENT**, channel WEBMAIL/MANUAL, not Titan | 24 25 26 28 29 30 31 32 33 34 35 | 14:33 |
| 042 (Dome) | DISQUALIFIED | **DISQUALIFIED (unchanged)** + separate external-manual-send note | 27 | 14:33 |

Each row was matched by exact recipient address to exactly one ledger row and one Postgres lead.

## Mechanism

`npm --prefix os run ledger:reconcile-historical-sends -- --actor="<name>"` (dry run) →
`... --apply --confirm=<digest>` (apply). Implemented in `os/server/sync/historical-sends.ts`.

- Tracker: the 18 status cells go `**DRAFTED**` → `**SENT**`; every row keeps its original notes, with an appended
  annotation: channel WEBMAIL/MANUAL, not dispatched by Titan, the evidence minute and UID, and the reconciler. Batch 3
  has no Sent Date / Follow-up columns, so none are invented. 042's status is untouched; its note records the
  external send, and that it was never approved or dispatched by Titan.
- Postgres: 19 append-only `audit_event` rows (`ledger.historical_send_reconciled` ×18,
  `ledger.external_send_recorded` ×1) carrying `channel: WEBMAIL_MANUAL`, `titan_dispatch: false`, `sent_at_utc`
  (minute precision) and the evidence UID. **Lead records are not modified.** Titan's ledger owns email send state in
  every phase (`os/server/repo/canonical.ts`), which is also why 106–110 read SCHEDULED in Postgres; that stays as designed.
- Never touches: suppression, `scheduled-queue.json`, the workflow, lead records, qualification, SMTP, IMAP.
- No Message-ID, Titan run id or seconds are recorded; none exist in the evidence.

Supporting fix: the audit redactor masked every ISO date as `[phone]`, which would have erased the send dates. Strict
ISO-8601 dates are now kept; phones (including ones next to dates) are still masked.

## Production dry run (2026-09-18, read-only)

`tracker: BEFORE (sha 21275e422e26) · audit events: ABSENT` → 18 DRAFTED → SENT · 1 DISQUALIFIED kept with
annotation · 19 audit events · 0 queue · 0 suppression · 0 lead record changes · 0 emails · 0 SMTP. The rendered
diff changes exactly 19 lines of `OUTREACH_TRACKER.md`. **Not applied.**

## Mailbox drafts (documentation only — cleanup is a human action)

- 10 drafts duplicate messages already sent: targets 001, 003, 006, 007, 008 (webmail, 2026-09-11) and 106–110 (Titan
  cron over SMTP, 2026-09-14).
- 5 drafts correspond to current queue entries 101–105, which are unchanged.
