// Per-deployment Veranstaltungs-Setup: only reachable after unlock, so it cannot
// be crawled/prerendered. The SPA fallback serves it at runtime.
export const prerender = false;
