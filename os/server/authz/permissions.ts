/**
 * Kachmo Outbound OS permission model. Pure (no I/O), deny-by-default.
 *
 * Roles come from the `user_role` table on every request — never from the client. A permission not listed for any of
 * the actor's roles is denied. New capabilities add a permission here first; UI visibility is only a convenience and
 * never a security control.
 */
export const PERMISSIONS = [
  'lead.view',
  'lead.view_contacts',
  'lead.create',
  'lead.edit',
  'lead.approve',
  'lead.reject',
  'lead.merge',
  'lead.export',
  'research.create',
  'research.upload',
  'research.approve',
  'evidence.review',
  'outreach.call',
  'outreach.whatsapp',
  'outreach.email',
  'email.view_ledger',
  'pipeline.update',
  'suppression.view',
  'suppression.create',
  'suppression.revoke',
  'analytics.view',
  'audit.view',
  'users.manage',
  'settings.manage',
  'methodology.manage',
  'api_clients.manage',
] as const;
export type Permission = (typeof PERMISSIONS)[number];

export const ROLES = ['OWNER', 'ADMIN', 'RESEARCHER', 'OUTREACH', 'INTERN', 'VIEWER'] as const;
export type Role = (typeof ROLES)[number];

const ALL: readonly Permission[] = PERMISSIONS;

/**
 * Default grants (Phase 0 assessment §5.5).
 * - `outreach.email` means viewing and preparing email work; it never sends — sending stays with Titan.
 * - Interns and viewers never see raw contact values, never approve, export, suppress or contact anyone.
 * - Lifting a suppression is OWNER-only.
 */
export const ROLE_PERMISSIONS: Readonly<Record<Role, readonly Permission[]>> = {
  OWNER: ALL,
  ADMIN: ALL.filter(p => !['methodology.manage', 'suppression.revoke', 'api_clients.manage'].includes(p)),
  // evidence.review (Phase B): confirming a retrieved page states a claim. It never changes a lead or a gate.
  RESEARCHER: ['lead.view', 'lead.view_contacts', 'lead.create', 'lead.edit', 'research.create', 'research.upload', 'evidence.review', 'suppression.view', 'analytics.view'],
  OUTREACH: ['lead.view', 'lead.view_contacts', 'outreach.call', 'outreach.whatsapp', 'outreach.email', 'email.view_ledger', 'pipeline.update', 'suppression.view', 'suppression.create', 'analytics.view'],
  INTERN: ['lead.view', 'research.create', 'research.upload'],
  VIEWER: ['lead.view', 'analytics.view'],
};

export function isRole(value: unknown): value is Role {
  return typeof value === 'string' && (ROLES as readonly string[]).includes(value);
}

/** Union of the permissions granted by the given roles. Unknown role strings grant nothing. */
export function permissionsFor(roles: readonly string[]): ReadonlySet<Permission> {
  const out = new Set<Permission>();
  for (const r of roles) if (isRole(r)) for (const p of ROLE_PERMISSIONS[r]) out.add(p);
  return out;
}

export function hasPermission(roles: readonly string[], permission: Permission): boolean {
  return permissionsFor(roles).has(permission);
}

/** Only an OWNER may grant or remove OWNER; ADMIN may manage every other role. */
export function canAssignRole(actorRoles: readonly string[], role: Role): boolean {
  if (!hasPermission(actorRoles, 'users.manage')) return false;
  return role === 'OWNER' ? actorRoles.includes('OWNER') : true;
}
