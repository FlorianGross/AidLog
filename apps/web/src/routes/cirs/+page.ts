// The CIRS submit form is reachable only after unlock and is fully client-side
// (it encrypts on-device before sending). No prerender; served by the SPA
// fallback like other authenticated app routes.
export const prerender = false;
