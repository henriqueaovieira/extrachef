import 'server-only';

import { createServerClient } from '@supabase/ssr';
import { cache } from 'react';
import { cookies } from 'next/headers';
import { notFound, redirect } from 'next/navigation';
import {
  requireActiveStaff,
  StaffMembershipError,
} from '@/lib/auth/admin-guards';
import {
  parseStaffMembership,
  type StaffMembership,
} from '@/lib/auth/staff-access';
import { loginHref } from '@/lib/auth/routes';

export class StaffPageAccessError extends Error {
  readonly code: 'auth_unavailable' | 'membership_unavailable';

  constructor(code: StaffPageAccessError['code']) {
    super('Administrative access could not be validated.');
    this.name = 'StaffPageAccessError';
    this.code = code;
  }
}

export const getStaffPageAccess = cache(async (): Promise<StaffMembership> => {
  const cookieStore = await cookies();
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll: () => cookieStore.getAll(),
        setAll(cookiesToSet) {
          try {
            cookiesToSet.forEach(({ name, value, options }) => {
              cookieStore.set(name, value, options);
            });
          } catch (error) {
            console.error('staff_page_cookie_refresh_unavailable', {
              type: error instanceof Error ? error.name : 'UnknownError',
            });
          }
        },
      },
      global: {
        fetch: (input, init) => fetch(input, { ...init, cache: 'no-store' }),
      },
    },
  );

  let auth: Awaited<ReturnType<typeof supabase.auth.getUser>>;
  try {
    auth = await supabase.auth.getUser();
  } catch (error) {
    console.error('staff_page_auth_failed', {
      type: error instanceof Error ? error.name : 'UnknownError',
    });
    throw new StaffPageAccessError('auth_unavailable');
  }

  if (auth.error && (!auth.error.status || auth.error.status >= 500)) {
    console.error('staff_page_auth_unavailable', { code: auth.error.code });
    throw new StaffPageAccessError('auth_unavailable');
  }
  if (auth.error || !auth.data.user) redirect(loginHref('/admin'));

  let result: Awaited<ReturnType<typeof supabase.rpc>>;
  try {
    result = await supabase.rpc('get_staff_membership');
  } catch (error) {
    console.error('staff_page_membership_failed', {
      type: error instanceof Error ? error.name : 'UnknownError',
    });
    throw new StaffPageAccessError('membership_unavailable');
  }
  if (result.error) {
    console.error('staff_page_membership_unavailable', { code: result.error.code });
    throw new StaffPageAccessError('membership_unavailable');
  }

  const membership = parseStaffMembership(result.data);
  if (!membership) notFound();

  try {
    requireActiveStaff(membership);
  } catch (error) {
    if (error instanceof StaffMembershipError) notFound();
    throw error;
  }

  return membership;
});
