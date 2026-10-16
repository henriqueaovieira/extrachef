import { createClient } from '@supabase/supabase-js';
import { authenticatedApiUser } from '@/lib/auth/api-user';
import { createAdminClient } from '@/lib/supabase/admin';

export async function POST(request: Request) {
  const account = await authenticatedApiUser(request);
  if (!account?.user.email) return Response.json({ error: 'Autenticação necessária.' }, { status: 401 });
  const body = await request.json().catch(() => null);
  if (body?.confirmation !== 'EXCLUIR' || typeof body.password !== 'string' || body.password.length > 256) {
    return Response.json({ error: 'Digite EXCLUIR e sua senha atual.' }, { status: 400 });
  }
  const verifier = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const { data: verified, error: passwordError } = await verifier.auth.signInWithPassword({
    email: account.user.email, password: body.password,
  });
  if (passwordError || verified.user?.id !== account.user.id) {
    return Response.json({ error: 'Senha incorreta ou tentativa bloqueada. Tente novamente mais tarde.' }, { status: 403 });
  }
  await verifier.auth.signOut({ scope: 'local' });
  let admin: ReturnType<typeof createAdminClient>;
  try { admin = createAdminClient(); }
  catch { return Response.json({ error: 'Serviço de exclusão não configurado.' }, { status: 503 }); }

  const { error: blocked } = await account.client.rpc('can_request_account_deletion');
  if (blocked) return Response.json({ error: 'Finalize ou resolva as diárias ativas antes de excluir sua conta.' }, { status: 409 });

  try {
    for (const bucket of ['worker-private', 'restaurant-assets']) {
      const paths: string[] = [];
      const collect = async (prefix: string) => {
        for (let offset = 0; ; offset += 100) {
          const { data, error } = await admin.storage.from(bucket).list(prefix, { limit: 100, offset });
          if (error) throw error;
          for (const entry of data) {
            const path = `${prefix}/${entry.name}`;
            if (entry.id) paths.push(path);
            else await collect(path);
          }
          if (data.length < 100) break;
        }
      };
      await collect(account.user.id);
      for (let index = 0; index < paths.length; index += 100) {
        const { error } = await admin.storage.from(bucket).remove(paths.slice(index, index + 100));
        if (error) throw error;
      }
    }
    const { error } = await admin.rpc('anonymize_account', { p_user_id: account.user.id });
    if (error) throw error;
    await admin.auth.admin.signOut(account.token, 'global');
    const { error: authDeleteError } = await admin.auth.admin.deleteUser(account.user.id, true);
    if (authDeleteError) throw authDeleteError;
    return Response.json({ deleted: true }, { headers: { 'Cache-Control': 'no-store' } });
  } catch {
    return Response.json({ error: 'A exclusão não foi concluída. Pode haver etapas parciais; entre em contato com o suporte antes de tentar novamente.' }, { status: 500 });
  }
}