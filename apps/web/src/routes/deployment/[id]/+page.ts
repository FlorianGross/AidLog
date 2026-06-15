// This route is per-deployment and only reachable after unlock; it cannot be
// crawled/prerendered. The SPA `fallback: index.html` (adapter-static) serves
// it at runtime and the client renders it.
export const prerender = false;
