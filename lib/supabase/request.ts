import { createServerClient, type CookieOptions } from '@supabase/ssr';
import { NextResponse, type NextRequest } from 'next/server';

export function createRequestClient(request: NextRequest) {
  const cookies = new Map<string, { name: string; value: string; options: CookieOptions }>();
  const headers = new Headers();
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll: () => request.cookies.getAll(),
        setAll(updates, cacheHeaders) {
          updates.forEach((cookie) => {
            request.cookies.set(cookie.name, cookie.value);
            cookies.set(cookie.name, cookie);
          });
          Object.entries(cacheHeaders).forEach(([name, value]) => headers.set(name, value));
        },
      },
      global: {
        fetch: (input, init) => fetch(input, { ...init, cache: 'no-store' }),
      },
    },
  );

  function finish(response = NextResponse.next({ request })) {
    cookies.forEach(({ name, value, options }) => response.cookies.set(name, value, options));
    headers.forEach((value, name) => response.headers.set(name, value));
    response.headers.set('Cache-Control', 'private, no-store, max-age=0, must-revalidate');
    response.headers.set('Pragma', 'no-cache');
    response.headers.set('Expires', '0');
    return response;
  }

  return { supabase, finish };
}
