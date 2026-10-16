export function decodeVapidKey(value: string) {
  const padding = '='.repeat((4 - value.length % 4) % 4);
  return Uint8Array.from(atob((value + padding).replace(/-/g, '+').replace(/_/g, '/')), (character) => character.charCodeAt(0));
}

export function rememberPushChoice(userId: string, enabled: boolean) {
  localStorage.setItem(`extrachef:push:${userId}`, enabled ? 'enabled' : 'disabled');
}

export async function reconcileDeviceSubscription(userId: string, publicKey: string) {
  if (!('serviceWorker' in navigator) || !('PushManager' in window) || !('Notification' in window)) return null;
  const choice = localStorage.getItem(`extrachef:push:${userId}`);
  if (choice === 'disabled' || Notification.permission !== 'granted') return null;
  const registration = await navigator.serviceWorker.getRegistration('/');
  if (!registration?.active) return null;
  let subscription = await registration.pushManager.getSubscription();
  if (!subscription && choice === 'enabled') {
    subscription = await registration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: decodeVapidKey(publicKey),
    });
  }
  return subscription;
}