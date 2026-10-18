import type { SupabaseClient } from '@supabase/supabase-js';

export const PASSWORD_RESET_PATH = '/settings/password';
export const MIN_PASSWORD_LENGTH = 6;
export const RECOVERY_SENT_MESSAGE = 'Se existir uma conta com este e-mail, enviaremos um link para redefinir sua senha. Abra o link neste navegador.';

type RecoveryClient = Pick<SupabaseClient['auth'], 'resetPasswordForEmail'>;
type UpdateClient = Pick<SupabaseClient['auth'], 'updateUser' | 'signOut'>;

// The e-mail link goes through the existing /auth/callback, which exchanges the code and opens the reset page.
export function recoveryRedirectUrl(origin: string) {
  const callback = new URL('/auth/callback', origin);
  callback.searchParams.set('redirect', PASSWORD_RESET_PATH);
  callback.searchParams.set('flow', 'recovery');
  return callback.toString();
}

export type AuthCallbackFlow = 'signup' | 'recovery';

export function authCallbackFlow(params: URLSearchParams): AuthCallbackFlow {
  return params.get('flow') === 'recovery' || params.get('redirect') === PASSWORD_RESET_PATH ? 'recovery' : 'signup';
}

const expiredCodes = new Set(['otp_expired', 'flow_state_expired']);

// Supabase reports expiry either through an error code or only in the description.
export function authCallbackFailureReason(flow: AuthCallbackFlow, errorCode?: string | null, description?: string | null) {
  const expired = expiredCodes.has(errorCode ?? '') || /expired|expirad/i.test(description ?? '');
  return `${flow === 'recovery' ? 'recovery' : 'confirmation'}_${expired ? 'expired' : 'invalid'}`;
}

export function isRecoveryReason(reason: string | null | undefined) {
  return Boolean(reason?.startsWith('recovery_'));
}

export function validateNewPassword(password: string, confirmation: string) {
  if (password.length < MIN_PASSWORD_LENGTH) return `A senha deve ter pelo menos ${MIN_PASSWORD_LENGTH} caracteres.`;
  if (password !== confirmation) return 'As senhas não coincidem.';
  return '';
}

export async function requestPasswordRecovery(auth: RecoveryClient, email: string, origin: string) {
  const address = email.trim();
  if (!address) throw new Error('Informe o e-mail da sua conta.');
  const { error } = await auth.resetPasswordForEmail(address, { redirectTo: recoveryRedirectUrl(origin) });
  if (error) throw new Error(error.message);
  return RECOVERY_SENT_MESSAGE;
}

export async function updatePasswordAndSignOut(auth: UpdateClient, password: string, confirmation: string) {
  const invalid = validateNewPassword(password, confirmation);
  if (invalid) throw new Error(invalid);
  const { error } = await auth.updateUser({ password });
  if (error) throw new Error(error.message);
  await auth.signOut();
  return '/login?reason=password_updated';
}
