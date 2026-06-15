// SvelteKit ambient types. Keep the App namespace minimal for the scaffold.
declare global {
  namespace App {
    // interface Error {}
    // interface Locals {}
    // interface PageData {}
    // interface Platform {}
  }
}

// @vite-pwa/sveltekit virtual module typings.
declare module 'virtual:pwa-info' {
  export const pwaInfo: { webManifest: { linkTag: string } } | undefined;
}
declare module 'virtual:pwa-register' {
  export function registerSW(options?: {
    immediate?: boolean;
    onNeedRefresh?: () => void;
    onOfflineReady?: () => void;
  }): (reloadPage?: boolean) => Promise<void>;
}

export {};
