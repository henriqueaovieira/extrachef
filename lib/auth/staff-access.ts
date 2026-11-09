export type StaffRole = 'admin' | 'reviewer' | 'support';
export type StaffStatus = 'active' | 'disabled' | 'revoked';

export interface StaffMembership {
  role: StaffRole;
  status: StaffStatus;
}

export function parseStaffMembership(value: unknown): StaffMembership | null {
  const record = Array.isArray(value) ? value[0] : value;
  if (!record || typeof record !== 'object') return null;

  const role = Reflect.get(record, 'role');
  const status = Reflect.get(record, 'status');
  if ((role !== 'admin' && role !== 'reviewer' && role !== 'support')
    || (status !== 'active' && status !== 'disabled' && status !== 'revoked')) {
    return null;
  }
  return { role, status };
}

export function isStaffPath(pathname: string) {
  return pathname === '/admin' || pathname.startsWith('/admin/');
}
