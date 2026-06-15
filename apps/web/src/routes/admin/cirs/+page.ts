// The CIRS review/triage view is admin-only, reachable after unlock, and decrypts
// reports locally with the org key at runtime. No prerender; served by the SPA
// fallback like other authenticated app routes.
export const prerender = false;
