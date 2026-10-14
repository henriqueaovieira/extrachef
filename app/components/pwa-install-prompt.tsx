'use client';

import { useEffect, useState } from 'react';

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed'; platform: string }>;
}

export default function PwaInstallPrompt() {
  const [installEvent, setInstallEvent] = useState<BeforeInstallPromptEvent | null>(null);
  const [isIosSafari, setIsIosSafari] = useState(false);
  const [showIosHelp, setShowIosHelp] = useState(false);
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    let isMounted = true;

    const handleBeforeInstallPrompt = (event: Event) => {
      event.preventDefault();
      if (isMounted) setInstallEvent(event as BeforeInstallPromptEvent);
    };

    const handleAppInstalled = () => {
      if (isMounted) {
        setInstallEvent(null);
        setIsIosSafari(false);
      }
    };

    const iosDetectionFrame = window.requestAnimationFrame(() => {
      const userAgent = window.navigator.userAgent;
      const isIos = /iPad|iPhone|iPod/.test(userAgent)
        || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
      const isStandalone = window.matchMedia('(display-mode: standalone)').matches
        || (window.navigator as Navigator & { standalone?: boolean }).standalone === true;

      if (isMounted) setIsIosSafari(isIos && !isStandalone);
    });

    if (process.env.NODE_ENV === 'production' && 'serviceWorker' in navigator) {
      void navigator.serviceWorker.register('/sw.js', { scope: '/' }).catch(() => undefined);
    }

    window.addEventListener('beforeinstallprompt', handleBeforeInstallPrompt);
    window.addEventListener('appinstalled', handleAppInstalled);

    return () => {
      isMounted = false;
      window.cancelAnimationFrame(iosDetectionFrame);
      window.removeEventListener('beforeinstallprompt', handleBeforeInstallPrompt);
      window.removeEventListener('appinstalled', handleAppInstalled);
    };
  }, []);

  const installApp = async () => {
    if (!installEvent) return;
    await installEvent.prompt();
    const choice = await installEvent.userChoice;
    if (choice.outcome === 'accepted') setInstallEvent(null);
  };

  if (dismissed || (!installEvent && !isIosSafari)) return null;

  return (
    <aside
      aria-label="Instalar ExtraChef"
      className="fixed inset-x-3 bottom-[calc(5.25rem+env(safe-area-inset-bottom))] z-50 mx-auto flex max-w-sm items-center gap-3 rounded-xl border border-gray-200 bg-white p-3 shadow-lg md:inset-x-auto md:bottom-4 md:right-4"
    >
      <span aria-hidden="true" className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-orange-100 text-lg font-bold text-orange-800">E</span>
      <div className="min-w-0 flex-1">
        <p className="text-sm font-semibold text-gray-900">ExtraChef no seu dispositivo</p>
        {showIosHelp ? (
          <p className="mt-1 text-xs leading-5 text-gray-600">No iPhone ou iPad, abra Compartilhar no navegador e toque em “Adicionar à Tela de Início”.</p>
        ) : (
          <p className="text-xs text-gray-500">Acesso rápido pela tela inicial.</p>
        )}
      </div>
      {installEvent ? (
        <button
          type="button"
          onClick={() => void installApp()}
          className="min-h-11 shrink-0 rounded-lg bg-orange-700 px-3 text-sm font-semibold text-white transition hover:bg-orange-800"
        >
          Instalar
        </button>
      ) : (
        <button
          type="button"
          onClick={() => setShowIosHelp((current) => !current)}
          className="min-h-11 shrink-0 rounded-lg border border-gray-300 px-3 text-sm font-semibold text-gray-800"
        >
          Como
        </button>
      )}
      <button
        type="button"
        aria-label="Dispensar instalação"
        onClick={() => setDismissed(true)}
        className="flex size-11 shrink-0 items-center justify-center rounded-lg text-lg text-gray-500 hover:bg-gray-100"
      >
        ×
      </button>
    </aside>
  );
}