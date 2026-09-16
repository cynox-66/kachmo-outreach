import 'server-only';
import { desc, eq, sql } from 'drizzle-orm';
import * as schema from '../db/schema/index';
import { getServer } from '../auth/instance';
import { ROLES, ROLE_PERMISSIONS, PERMISSIONS, permissionsFor, canAssignRole, type Role } from '../authz/permissions';
import type { Actor } from '../authz/authorize';

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
