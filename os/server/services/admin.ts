import 'server-only';
import { desc, eq, isNull, sql } from 'drizzle-orm';
import * as schema from '../db/schema/index';
import { getServer } from '../auth/instance';
import { ROLES, ROLE_PERMISSIONS, PERMISSIONS, permissionsFor, canAssignRole, type Role } from '../authz/permissions';
import type { Actor } from '../authz/authorize';
import { appWritesEnabled } from '../repo/phase';
import { engineRef } from '../leads/reevaluate';
import { evidenceLevelCounts } from '../evidence/store';
import { MAX_ATTEMPTS } from '../evidence/fetch-run';

/** Read surfaces for the administrative pages: users, roles, audit log and system status. */

export interface UserRow {
  id: string;
  name: string;
  email: string;
  roles: Role[];
  permissionCount: number;
  deactivatedAt: Date | null;
  createdAt: Date;
}

export async function listUsers(): Promise<UserRow[]> {
  const { db } = getServer();
  const users = await db
    .select({ id: schema.user.id, name: schema.user.name, email: schema.user.email, deactivatedAt: schema.user.deactivatedAt, createdAt: schema.user.createdAt })
    .from(schema.user)
    .orderBy(desc(schema.user.createdAt));
  const roleRows = await db.select({ userId: schema.userRole.userId, role: schema.userRole.role }).from(schema.userRole);
  const byUser = new Map<string, Role[]>();
  for (const r of roleRows) {
    if (!(ROLES as readonly string[]).includes(r.role)) continue;
    byUser.set(r.userId, [...(byUser.get(r.userId) ?? []), r.role as Role]);
  }
  return users.map(u => {
    const roles = byUser.get(u.id) ?? [];
    return { ...u, roles, permissionCount: permissionsFor(roles).size };
  });
}

/** The role/permission matrix, so an owner can see exactly what each role can do rather than guess. */
export function roleMatrix() {
  return {
    permissions: PERMISSIONS,
    roles: ROLES.map(role => ({
      role,
      permissions: ROLE_PERMISSIONS[role],
      count: ROLE_PERMISSIONS[role].length,
    })),
  };
}

/** Which roles this actor may grant. An actor can never grant themselves something they do not hold. */
export function assignableRoles(actor: Actor): Role[] {
  return ROLES.filter(r => canAssignRole(actor.roles, r));
}

export interface AuditRow {
  id: string;
  occurredAt: Date;
  actorLabel: string;
  actorUserId: string | null;
  action: string;
  targetType: string;
  targetId: string | null;
  metadata: unknown;
}

export async function listAudit(filters: { action?: string; targetType?: string; limit?: number } = {}): Promise<AuditRow[]> {
  const { db } = getServer();
  const limit = Math.min(filters.limit ?? 200, 500);
  const base = db
    .select({
      id: schema.auditEvent.id,
      occurredAt: schema.auditEvent.occurredAt,
      actorLabel: schema.auditEvent.actorLabel,
      actorUserId: schema.auditEvent.actorUserId,
      action: schema.auditEvent.action,
      targetType: schema.auditEvent.targetType,
      targetId: schema.auditEvent.targetId,
      metadata: schema.auditEvent.metadata,
    })
    .from(schema.auditEvent);
  const rows = filters.action
    ? await base.where(eq(schema.auditEvent.action, filters.action)).orderBy(desc(schema.auditEvent.occurredAt)).limit(limit)
    : await base.orderBy(desc(schema.auditEvent.occurredAt)).limit(limit);
  return rows;
}

export async function auditActions(): Promise<Array<{ action: string; count: number }>> {
  const { db } = getServer();
  return db
    .select({ action: schema.auditEvent.action, count: sql<number>`count(*)::int` })
    .from(schema.auditEvent)
    .groupBy(schema.auditEvent.action)
    .orderBy(desc(sql`count(*)`));
}

export interface SystemStatus {
  methodology: { id: string; title: string; status: string; activatedAt: Date | null } | null;
  counts: Record<string, number>;
}

export async function getSystemStatus(): Promise<SystemStatus> {
  const { db } = getServer();
  const [methodology] = await db
    .select({ id: schema.methodologyVersion.id, title: schema.methodologyVersion.title, status: schema.methodologyVersion.status, activatedAt: schema.methodologyVersion.activatedAt })
    .from(schema.methodologyVersion)
    .where(eq(schema.methodologyVersion.status, 'ACTIVE'));

  const counts: Record<string, number> = {};
  for (const [name, table] of [
    ['lead', schema.lead],
    ['suppression_entry', schema.suppressionEntry],
    ['analytics_event', schema.analyticsEvent],
    ['audit_event', schema.auditEvent],
    ['research_brief', schema.researchBrief],
    ['research_report', schema.researchReport],
    ['research_candidate', schema.researchCandidate],
    ['user', schema.user],
  ] as const) {
    const [r] = await db.select({ n: sql<number>`count(*)::int` }).from(table);
    counts[name] = Number(r.n);
  }
  return { methodology: methodology ?? null, counts };
}

// ── Phase B write-path health (counts of existing states only; no invented metrics) ──

export interface WritePathHealth {
  appWrites: boolean;
  engineRef: string;
  lastReevaluation: { at: Date; actor: string; written: number | null } | null;
  evaluations: number;
  revisions: number;
  evidenceByLevel: Record<string, number>;
  retrievalsByOutcome: Record<string, number>;
  /** URLs whose fetch failed three times and are left for a person. */
  needsHuman: number;
  /** Active users holding a lead-write permission but no engine-actor binding: they will be refused. */
  unboundWriters: string[];
}

export async function getWritePathHealth(): Promise<WritePathHealth> {
  const { db } = getServer();
  const count = async (table: typeof schema.leadEvaluation | typeof schema.leadRevision) => Number((await db.select({ n: sql<number>`count(*)::int` }).from(table))[0].n);

  const [last] = await db.select().from(schema.auditEvent).where(eq(schema.auditEvent.action, 'lead.reevaluation_run')).orderBy(desc(schema.auditEvent.occurredAt)).limit(1);
  const outcomes = await db.select({ outcome: schema.evidenceRetrieval.outcome, url: schema.evidenceRetrieval.requestedUrl }).from(schema.evidenceRetrieval);
  const retrievalsByOutcome: Record<string, number> = {};
  const failuresByUrl = new Map<string, number>();
  const okUrls = new Set<string>();
  for (const o of outcomes) {
    retrievalsByOutcome[o.outcome] = (retrievalsByOutcome[o.outcome] ?? 0) + 1;
    if (o.outcome === 'OK') okUrls.add(o.url);
    else failuresByUrl.set(o.url, (failuresByUrl.get(o.url) ?? 0) + 1);
  }
  const needsHuman = [...failuresByUrl.entries()].filter(([url, n]) => n >= MAX_ATTEMPTS && !okUrls.has(url)).length;

  const users = await db.select({ id: schema.user.id, name: schema.user.name, deactivatedAt: schema.user.deactivatedAt }).from(schema.user);
  const roles = await db.select().from(schema.userRole);
  const bound = new Set((await db.select({ userId: schema.userEngineActor.userId }).from(schema.userEngineActor).where(isNull(schema.userEngineActor.revokedAt))).map(b => b.userId));
  const WRITE = ['lead.edit', 'outreach.call', 'outreach.whatsapp', 'pipeline.update', 'suppression.create'] as const;
  const unboundWriters = users
    .filter(u => !u.deactivatedAt && !bound.has(u.id))
    .filter(u => {
      const p = permissionsFor(roles.filter(r => r.userId === u.id).map(r => r.role));
      return WRITE.some(w => p.has(w));
    })
    .map(u => u.name);

  return {
    appWrites: appWritesEnabled(),
    engineRef: engineRef(),
    lastReevaluation: last ? { at: last.occurredAt, actor: last.actorLabel, written: Number((last.metadata as Record<string, unknown>).written ?? 0) } : null,
    evaluations: await count(schema.leadEvaluation),
    revisions: await count(schema.leadRevision),
    evidenceByLevel: await evidenceLevelCounts(db),
    retrievalsByOutcome,
    needsHuman,
    unboundWriters,
  };
}
