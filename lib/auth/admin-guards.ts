import {
  requirePermission as requireStaffPermission,
  getStaffPermissions,
} from '@/lib/auth/staff-authorization';
import type { StaffPermission } from '@/lib/auth/staff-permissions';
import {
  parseStaffMembership,
  type StaffMembership,
  type StaffRole,
} from '@/lib/auth/staff-access';

export class StaffRoleError extends Error {
  readonly code = 'STAFF_ROLE_REQUIRED';
  readonly status = 403;
  readonly requiredRole: StaffRole;

  constructor(requiredRole: StaffRole) {
    super(`Staff role required: ${requiredRole}`);
    this.name = 'StaffRoleError';
    this.requiredRole = requiredRole;
  }
}

export class StaffMembershipError extends Error {
  readonly code = 'ACTIVE_STAFF_REQUIRED';
  readonly status = 403;

  constructor() {
    super('An active staff membership is required.');
    this.name = 'StaffMembershipError';
  }
}

function requireRole(
  membership: StaffMembership | null | undefined,
  requiredRole: StaffRole,
): void {
  const parsedMembership = parseStaffMembership(membership);
  if (!parsedMembership
    || parsedMembership.status !== 'active'
    || getStaffPermissions(parsedMembership).length === 0
    || parsedMembership.role !== requiredRole) {
    throw new StaffRoleError(requiredRole);
  }
}

export function requireActiveStaff(membership: StaffMembership | null | undefined): void {
  const parsedMembership = parseStaffMembership(membership);
  if (!parsedMembership
    || parsedMembership.status !== 'active'
    || getStaffPermissions(parsedMembership).length === 0) {
    throw new StaffMembershipError();
  }
}

export function requireAdmin(membership: StaffMembership | null | undefined): void {
  requireRole(membership, 'admin');
}

export function requireReviewer(membership: StaffMembership | null | undefined): void {
  requireRole(membership, 'reviewer');
}

export function requireSupport(membership: StaffMembership | null | undefined): void {
  requireRole(membership, 'support');
}

export function requirePermission(
  membership: StaffMembership | null | undefined,
  permission: StaffPermission,
): void {
  requireStaffPermission(membership, permission);
}
