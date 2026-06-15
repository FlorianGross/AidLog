// The Einsatztagebuch (event journal) view is per-deployment and only reachable
// after unlock; like the editor it cannot be crawled/prerendered. The SPA
// `fallback: index.html` (adapter-static) serves it at runtime and the client
// renders it.
export const prerender = false;
