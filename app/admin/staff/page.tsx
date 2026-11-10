import { notFound } from 'next/navigation';
import { requirePermission } from '@/lib/auth/admin-guards';
import { StaffPermissionError } from '@/lib/auth/staff-authorization';
import { getStaffPageAccess } from '@/lib/auth/staff-page-access';
import StaffClient from './staff-client';

export default async function AdminStaffPage() {
  const membership = await getStaffPageAccess();
  try {
    requirePermission(membership, 'staff.view');
  } catch (error) {
    if (error instanceof StaffPermissionError) notFound();
    throw error;
  }

  return (
    <section className="space-y-4 rounded-2xl border border-stone-200 bg-white p-6 shadow-sm">
      <h1 className="text-2xl font-semibold text-stone-900">Staff</h1>
      <p className="text-sm text-stone-600">Membros da equipe administrativa.</p>
      <StaffClient />
    </section>
  );
}
