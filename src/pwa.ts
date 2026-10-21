export function registerPwa() {
  const nativeRuntime = (window as Window & { Capacitor?: { isNativePlatform?: () => boolean } }).Capacitor;
  if (nativeRuntime?.isNativePlatform?.()) return;
  if (!import.meta.env.PROD || !('serviceWorker' in navigator)) return;
  window.addEventListener('load', () => {
    void navigator.serviceWorker.register('/sw.js').catch(() => undefined);
  }, { once: true });
}
