import {
  getStaffPermissionsForRole,
  hasStaffPermission,
  type StaffPermission,
} from '@/lib/auth/staff-permissions';
import {
  parseStaffMembership,
  type StaffMembership,
} from '@/lib/auth/staff-access';

export class StaffPermissionError extends Error {
  readonly code = 'STAFF_PERMISSION_DENIED';
  readonly status = 403;

  constructor(permission: StaffPermission) {
    super(`Staff permission denied: ${permission}`);
    this.name = 'StaffPermissionError';
  }
}

export function getStaffPermissions(
  membership: StaffMembership | null | undefined,
): readonly StaffPermission[] {
  const parsedMembership = parseStaffMembership(membership);
  if (!parsedMembership || parsedMembership.status !== 'active') return [];

  return getStaffPermissionsForRole(parsedMembership.role);
}

export function hasPermission(
  membership: StaffMembership | null | undefined,
  permission: StaffPermission,
): boolean {
  const parsedMembership = parseStaffMembership(membership);
  return parsedMembership?.status === 'active'
    && hasStaffPermission(parsedMembership.role, permission);
}

export function requirePermission(
  membership: StaffMembership | null | undefined,
  permission: StaffPermission,
): void {
  if (!hasPermission(membership, permission)) {
    throw new StaffPermissionError(permission);
  }
}
