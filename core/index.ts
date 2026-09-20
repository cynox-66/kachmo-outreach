/**
 * Kachmo core — the single qualification / scoring / provenance / suppression brain.
 * Pure TypeScript: no filesystem, network, environment or process access (enforced by core/tsconfig.json, which
 * has no Node types, and by the boundary test). Persistence and I/O live in adapters (scripts/, os/).
 */
export * from './leads/schema.js';
export * from './leads/validation.js';
export * from './leads/invariants.js';
export * from './leads/dedupe.js';
export * from './leads/csv.js';
export * from './leads/opportunity.js';
export * from './contact/provenance.js';
export * from './suppression/match.js';
export * from './qualification/completeness.js';
export * from './qualification/gates.js';
export * from './scoring/score.js';
export * from './research/tasks.js';
export * from './research/evidence.js';
export * from './research/report.js';
export * from './research/candidate.js';
export * from './research/extraction.js';
export * from './research/prompt.js';
export * from './research/inventory.js';
export * from './queues/calls.js';
export * from './queues/whatsapp.js';
export * from './queues/work-rules.js';
export * from './queues/today.js';
export * from './email-ledger/tracker.js';
export * from './email-ledger/queue-check.js';
export * from './email-ledger/send-guard.js';
export * from './email-ledger/ledger-update.js';
export * from './geo/timezone.js';
export * from './util/text.js';
export * from './config/taxonomy.js';
export * from './state/decision.js';
export * from './state/call.js';
export * from './state/whatsapp.js';
export * from './state/pipeline.js';
export * from './state/research-record.js';
export * from './state/suppression-propagation.js';
export * from './reports/war-room.js';
export * from './reports/weekly.js';
export * from './reconciliation/ownership.js';
export * from './reconciliation/drift.js';
export * from './reconciliation/publish.js';
