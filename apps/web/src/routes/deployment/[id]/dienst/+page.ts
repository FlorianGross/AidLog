// Per-deployment Anwesenheit/Dienst (roster): only reachable after unlock, so it
// cannot be crawled/prerendered. The SPA fallback serves it at runtime. Every
// per-deployment route needs this or the static build fails.
export const prerender = false;
