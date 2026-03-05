'use client';

import { useEffect, useState } from 'react';

export function InstallPrompt() {
  const [isIOS, setIsIOS] = useState(false);
  const [isStandalone, setIsStandalone] = useState(false);
  const [deferredPrompt, setDeferredPrompt] = useState<any>(null);
  const [isElectron, setIsElectron] = useState(false);

  useEffect(() => {
    // Don't show PWA prompt in Electron
    setIsElectron(!!window.electronAPI);
    if (window.electronAPI) return;

    setIsIOS(/iPad|iPhone|iPod/.test(navigator.userAgent) && !(window as any).MSStream);
    setIsStandalone(window.matchMedia('(display-mode: standalone)').matches);

    const handler = (e: Event) => {
      e.preventDefault();
      setDeferredPrompt(e);
    };
    window.addEventListener('beforeinstallprompt', handler);
    return () => window.removeEventListener('beforeinstallprompt', handler);
  }, []);

  if (isStandalone || isElectron) return null;

  const handleInstall = async () => {
    if (deferredPrompt) {
      deferredPrompt.prompt();
      await deferredPrompt.userChoice;
      setDeferredPrompt(null);
    }
  };

  return (
    <div>
      {deferredPrompt && <button onClick={handleInstall}>Install App</button>}
      {isIOS && <p>To install: tap the Share button ⎋ then "Add to Home Screen" ➕</p>}
    </div>
  );
}
