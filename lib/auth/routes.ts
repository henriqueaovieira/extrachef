export type AccountRole = 'restaurant' | 'worker';

const protectedPrefixes = [
  '/restaurant', '/worker', '/chat', '/checkin', '/checkout', '/payment',
  '/reviews', '/notifications', '/settings', '/profile',
];

function hasPrefix(pathname: string, prefix: string) {
  return pathname === prefix || pathname.startsWith(`${prefix}/`);
}

export function isProtectedPath(pathname: string) {
  return protectedPrefixes.some((prefix) => hasPrefix(pathname, prefix));
}

export function isAccountRole(value: unknown): value is AccountRole {
  return value === 'restaurant' || value === 'worker';
}

export function dashboardFor(role: AccountRole) {
  return `/${role}/dashboard`;
}

export function canAccessPath(pathname: string, role: AccountRole) {
  return !hasPrefix(pathname, role === 'worker' ? '/restaurant' : '/worker');
}

export function sanitizeRedirect(value: string | null | undefined, role: AccountRole) {
  const fallback = dashboardFor(role);
  if (!value || !value.startsWith('/') || value.startsWith('//')
    || /[\\\u0000-\u0020\u007f]/.test(value)) return fallback;

  try {
    const url = new URL(value, 'https://extrachef.invalid');
    if (url.origin !== 'https://extrachef.invalid'
      || url.pathname.includes('%') || !isProtectedPath(url.pathname)) return fallback;
    if (!canAccessPath(url.pathname, role)) return `${fallback}?reason=role_forbidden`;
    return `${url.pathname}${url.search}${url.hash}`;
  } catch {
    return fallback;
  }
}

export function loginHref(redirect: string, reason?: 'session_expired') {
  const params = new URLSearchParams({ redirect });
  if (reason) params.set('reason', reason);
  return `/login?${params}`;
}

export const authMessages: Record<string, string> = {
  session_expired: 'Sua sessão expirou. Faça login novamente.',
  role_forbidden: 'Esta área não está disponível para seu perfil.',
  profile_unavailable: 'Não foi possível carregar seu perfil. Faça login para tentar novamente.',
  confirmation_failed: 'Não foi possível concluir a confirmação do cadastro. Abra o link novamente ou faça login.',
  confirmation_expired: 'O link de confirmação de cadastro expirou. Cadastre-se novamente com o mesmo e-mail para receber um novo link.',
  confirmation_invalid: 'Este link de confirmação de cadastro é inválido ou já foi usado. Se sua conta já foi confirmada, basta entrar.',
  recovery_failed: 'Não foi possível validar o link de recuperação de senha. Tente novamente ou solicite um novo link.',
  recovery_expired: 'O link de recuperação de senha expirou. Solicite um novo link para redefinir sua senha.',
  recovery_invalid: 'Este link de recuperação de senha é inválido ou já foi usado. Solicite um novo link e abra-o neste navegador.',
  signed_out: 'Você saiu da sua conta.',
  password_updated: 'Senha redefinida. Entre com sua nova senha.',
};
