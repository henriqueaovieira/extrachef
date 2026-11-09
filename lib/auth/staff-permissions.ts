import type { StaffRole } from '@/lib/auth/staff-access';

export const STAFF_PERMISSION_CATALOG = {
  'staff.view': 'List staff memberships.',
  'staff.manage': 'Create, change, and revoke staff memberships.',
  'verification.view': 'View the minimized professional verification queue.',
  'verification.review': 'Work on a verification review without deciding its outcome.',
  'verification.approve': 'Approve a professional verification.',
  'verification.reject': 'Reject a professional verification.',
  'audit.view': 'View the minimized audit trail.',
  'audit.export': 'Export allowlisted audit data.',
  'user.view': 'View minimized user information.',
  'user.flag': 'Record an investigative flag without changing account status.',
  'system.settings': 'Access approved system settings.',
  'system.bootstrap': 'Use the controlled system bootstrap procedure.',
} as const;

export type StaffPermission = keyof typeof STAFF_PERMISSION_CATALOG;

export const STAFF_ROLE_PERMISSION_MATRIX = {
  admin: [
    'staff.view',
    'staff.manage',
    'verification.view',
    'verification.review',
    'verification.approve',
    'verification.reject',
    'audit.view',
    'audit.export',
    'user.view',
    'user.flag',
    'system.settings',
    'system.bootstrap',
  ],
  reviewer: [
    'verification.view',
    'verification.review',
    'verification.approve',
    'verification.reject',
    'user.view',
    'user.flag',
  ],
  support: [
    'verification.view',
    'user.view',
  ],
} as const satisfies Record<StaffRole, readonly StaffPermission[]>;

export function getStaffPermissionsForRole(role: StaffRole): readonly StaffPermission[] {
  return STAFF_ROLE_PERMISSION_MATRIX[role];
}

export function hasStaffPermission(role: StaffRole, permission: StaffPermission): boolean {
  const permissions: readonly StaffPermission[] = STAFF_ROLE_PERMISSION_MATRIX[role];
  return permissions.includes(permission);
}
