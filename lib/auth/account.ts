import type { SupabaseClient } from '@supabase/supabase-js';
import { isAccountRole, type AccountRole } from './routes';

export async function getAccountRole(
  supabase: SupabaseClient,
  userId: string,
  provisionIfMissing = false,
): Promise<AccountRole> {
  const readRole = () => supabase.from('users').select('role').eq('id', userId).maybeSingle();
  let result = await readRole();
  if (result.error) throw new Error('Não foi possível carregar seu perfil. Tente novamente.');

  if (!result.data && provisionIfMissing) {
    const { error } = await supabase.rpc('ensure_account_profile');
    if (error) throw new Error('Não foi possível concluir seu cadastro. Verifique seus dados ou contate o suporte.');
    result = await readRole();
    if (result.error) throw new Error('Não foi possível carregar seu perfil. Tente novamente.');
  }

  if (!isAccountRole(result.data?.role)) {
    throw new Error('Seu cadastro não possui um perfil válido. Entre em contato com o suporte.');
  }
  return result.data.role;
}
