import { connection, NextResponse } from 'next/server';

export async function GET() {
  await connection();
  const headers = { 'Cache-Control': 'no-store', 'X-Robots-Tag': 'noindex' };
  if (process.env.PUSH_DIAGNOSTICS_ENABLED !== 'true') {
    return NextResponse.json({ error: 'Not found.' }, { status: 404, headers });
  }

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  return NextResponse.json({
    hasSupabaseUrl: Boolean(url),
    hasServiceRoleKey: Boolean(key),
    supabaseUrlLength: url?.length ?? 0,
    serviceRoleLength: key?.length ?? 0,
  }, { headers: { ...headers, 'X-Push-Diagnostics-Version': 'admin-env-v2' } });
}
