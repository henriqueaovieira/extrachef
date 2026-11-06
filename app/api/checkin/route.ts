import { authenticatedApiUser } from '@/lib/auth/api-user';

const jobIdPattern = /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i;

export async function POST(request: Request) {
  const account = await authenticatedApiUser(request);
  if (!account) return Response.json({ error: 'Autenticação necessária.' }, { status: 401 });

  const body = await request.json().catch(() => null);
  if (!body || typeof body !== 'object' || typeof body.jobId !== 'string' || !jobIdPattern.test(body.jobId)) {
    return Response.json({ error: 'Operação inválida.' }, { status: 400 });
  }

  const { data, error } = await account.client.rpc('issue_operational_code', {
    p_job_id: body.jobId,
    p_stage: 'checkin',
    p_latitude: typeof body.latitude === 'number' ? body.latitude : null,
    p_longitude: typeof body.longitude === 'number' ? body.longitude : null,
    p_accuracy: typeof body.accuracy === 'number' ? body.accuracy : null,
    p_speed: typeof body.speed === 'number' ? body.speed : null,
    p_is_mock: typeof body.isMock === 'boolean' ? body.isMock : null,
  });
  if (error) {
    const status = error.message.includes('Muitas tentativas detectadas') ? 429
      : error.code === '42501' ? 403 : 400;
    return Response.json({ error: error.message }, { status, headers: { 'Cache-Control': 'no-store' } });
  }
  if (typeof data?.error === 'string') {
    const status = data.error.includes('Muitas tentativas detectadas') ? 429 : 400;
    return Response.json({ error: data.error }, { status, headers: { 'Cache-Control': 'no-store' } });
  }
  return Response.json(data, { headers: { 'Cache-Control': 'no-store' } });
}
