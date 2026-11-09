import { getStaffPageAccess } from '@/lib/auth/staff-page-access';

export default async function AdminPage() {
  const access = await getStaffPageAccess();

  return (
    <section className="space-y-4 rounded-2xl border border-stone-200 bg-white p-6 shadow-sm">
      <h1 className="text-2xl font-semibold text-stone-900">Admin Area</h1>
      <dl className="grid gap-3 text-sm sm:grid-cols-2">
        <div>
          <dt className="text-stone-500">Role atual</dt>
          <dd className="font-medium text-stone-900">{access.role}</dd>
        </div>
        <div>
          <dt className="text-stone-500">Status atual</dt>
          <dd className="font-medium text-stone-900">{access.status}</dd>
        </div>
      </dl>
    </section>
  );
}
