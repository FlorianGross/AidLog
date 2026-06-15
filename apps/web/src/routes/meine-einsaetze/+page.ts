// "Meine Einsätze" is reachable only after unlock and is fully client-side: it
// syncs the caller's own records (delivered via the persistent 'author' sealed
// wrapper), then merges the server list with local meta + on-device decryption.
// No prerender; served by the SPA fallback like other authenticated app routes.
export const prerender = false;
