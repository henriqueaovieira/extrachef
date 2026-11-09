import type { NextRequest } from 'next/server';
import { authorizeStaffApi } from '@/lib/auth/staff-api';

export async function GET(request: NextRequest) {
  const context = await authorizeStaffApi(request);
  if (!context.ok) return context.response;
  return context.reply({ role: context.role, status: 'active' }, 200);
}
