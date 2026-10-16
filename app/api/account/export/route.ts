import { authenticatedApiUser } from '@/lib/auth/api-user';

export async function GET(request: Request) {
  const account = await authenticatedApiUser(request);
  if (!account) return Response.json({ error: 'Autenticação necessária.' }, { status: 401 });
  const { data, error } = await account.client.rpc('export_own_account_data');
  if (error) return Response.json({ error: 'Não foi possível exportar os dados.' }, { status: 503 });
  return new Response(JSON.stringify(data, null, 2), {
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Content-Disposition': 'attachment; filename="extrachef-meus-dados.json"',
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
    },
  });
}