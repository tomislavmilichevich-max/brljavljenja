export type SwState = 'unsupported' | 'dev-disabled' | 'registering' | 'registered' | 'error';

/** Registrira service worker samo u produkcijskom buildu (u devu bi smetao HMR-u). */
export async function registerServiceWorker(
  isProd: boolean = import.meta.env.PROD,
  nav: Pick<Navigator, 'serviceWorker'> | { serviceWorker?: undefined } = navigator,
): Promise<SwState> {
  if (!nav.serviceWorker) return 'unsupported';
  if (!isProd) return 'dev-disabled';
  try {
    await nav.serviceWorker.register('/sw.js', { scope: '/' });
    return 'registered';
  } catch {
    return 'error';
  }
}
