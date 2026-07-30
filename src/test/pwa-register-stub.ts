// Stands in for `virtual:pwa-register/react` under vitest.
//
// That specifier is a virtual module created by vite-plugin-pwa, which lives in
// vite.config.ts. vitest.config.ts is a separate config and does not load the
// plugin, so without this alias every test that reaches App.tsx fails to resolve
// the import (see the `resolve.alias` entry in vitest.config.ts).
//
// Returns the shape useRegisterSW actually returns, with needRefresh permanently
// false — there is no service worker in jsdom, so the update prompt should never
// fire during tests.

export function useRegisterSW(_options?: {
  onRegisterError?: (error: unknown) => void;
  onRegistered?: (registration: ServiceWorkerRegistration | undefined) => void;
}) {
  return {
    needRefresh: [false, () => {}] as [boolean, (value: boolean) => void],
    offlineReady: [false, () => {}] as [boolean, (value: boolean) => void],
    updateServiceWorker: async (_reloadPage?: boolean) => {},
  };
}
