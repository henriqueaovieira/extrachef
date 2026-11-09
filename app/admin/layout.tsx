import Link from 'next/link';
import type { ReactNode } from 'react';
import { getStaffPermissions, hasPermission } from '@/lib/auth/staff-authorization';
import type { StaffPermission } from '@/lib/auth/staff-permissions';
import { getStaffPageAccess } from '@/lib/auth/staff-page-access';

const adminNavigation: {
  label: string;
  href: string;
  permission: StaffPermission | null;
}[] = [
  { label: 'Dashboard', href: '/admin', permission: null },
  { label: 'Staff', href: '/admin/staff', permission: 'staff.view' },
  { label: 'Users', href: '/admin/users', permission: 'user.view' },
  { label: 'Verification', href: '/admin/verifications', permission: 'verification.view' },
  { label: 'Audit', href: '/admin/audit', permission: 'audit.view' },
  { label: 'Settings', href: '/admin/settings', permission: 'system.settings' },
];

export default async function AdminLayout({ children }: { children: ReactNode }) {
  const membership = await getStaffPageAccess();
  const permissions = getStaffPermissions(membership);
  const visibleNavigation = adminNavigation.filter(({ permission }) => (
    permission === null
      ? permissions.length > 0
      : permissions.includes(permission) && hasPermission(membership, permission)
  ));

  return (
    <main className="mx-auto min-h-screen w-full max-w-5xl space-y-6 p-6">
      <nav aria-label="Navegação administrativa" className="border-b border-stone-200 pb-4">
        <ul className="flex flex-wrap gap-2">
          {visibleNavigation.map(({ label, href }) => (
            <li key={href}>
              <Link
                href={href}
                className="inline-flex rounded-lg px-3 py-2 text-sm font-medium text-stone-700 hover:bg-stone-100 hover:text-stone-950"
              >
                {label}
              </Link>
            </li>
          ))}
        </ul>
      </nav>
      {children}
    </main>
  );
}
