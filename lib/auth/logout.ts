import type { SupabaseClient } from '@supabase/supabase-js';

let loggingOut = false;

export function isLoggingOut() {
  return loggingOut;
}

export async function logoutCurrentDevice(supabase: SupabaseClient) {
  let cleanupFailed = false;
  try {
    if ('serviceWorker' in navigator) {
      const registration = await navigator.serviceWorker.getRegistration('/');
      const subscription = await registration?.pushManager?.getSubscription();
      if (subscription) {
        const unsubscribed = await subscription.unsubscribe();
        if (!unsubscribed) throw new Error('push_unsubscribe_failed');
        const { error } = await supabase.from('push_subscriptions').delete().eq('endpoint', subscription.endpoint);
        if (error) throw new Error('push_subscription_delete_failed');
      }
    }
  } catch (error) {
    cleanupFailed = true;
    console.error('logout_device_cleanup_failed', {
      type: error instanceof Error ? error.name : 'UnknownError',
    });
  }

  try {
    for (const storage of [localStorage, sessionStorage]) {
      Object.keys(storage).filter((key) => key.startsWith('extrachef:')).forEach((key) => storage.removeItem(key));
    }
    if ('caches' in window) {
      const keys = await caches.keys();
      await Promise.all(keys.filter((key) => key.startsWith('extrachef-private-')).map((key) => caches.delete(key)));
    }
  } catch (error) {
    cleanupFailed = true;
    console.error('logout_cache_cleanup_failed', {
      type: error instanceof Error ? error.name : 'UnknownError',
    });
  }

  loggingOut = true;
  try {
    const { error } = await supabase.auth.signOut({ scope: 'local' });
    if (error) throw error;
  } catch {
    loggingOut = false;
    throw new Error('Não foi possível encerrar sua sessão. Verifique a conexão e tente novamente.');
  }
  const params = new URLSearchParams({ reason: 'signed_out' });
  if (cleanupFailed) params.set('warning', 'device_cleanup_failed');
  window.location.replace(`/login?${params}`);
}
