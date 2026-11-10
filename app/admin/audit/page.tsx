import { notFound } from 'next/navigation';
import { requirePermission } from '@/lib/auth/admin-guards';
import { StaffPermissionError } from '@/lib/auth/staff-authorization';
import { getStaffPageAccess } from '@/lib/auth/staff-page-access';
import AuditClient from './audit-client';

export default async function AdminAuditPage() {
  const membership = await getStaffPageAccess();
  try {
    requirePermission(membership, 'audit.view');
  } catch (error) {
    if (error instanceof StaffPermissionError) notFound();
    throw error;
  }

  return (
    <section className="space-y-4 rounded-2xl border border-stone-200 bg-white p-6 shadow-sm">
      <h1 className="text-2xl font-semibold text-stone-900">Trilha administrativa</h1>
      <p className="text-sm text-stone-600">
        Eventos registrados, do mais recente para o mais antigo. Datas exibidas em UTC.
      </p>
      <AuditClient />
    </section>
  );
}
