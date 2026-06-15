// Fully client-rendered SPA: the server is a blind sync store and must never
// run our crypto. Disable SSR everywhere and prerender the static shell.
export const ssr = false;
export const prerender = true;
export const trailingSlash = 'always';
