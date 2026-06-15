import '@testing-library/jest-dom/vitest';

// `idb` + crypto-core run fine under jsdom, but jsdom lacks structuredClone in
// some versions and a global crypto.randomUUID — polyfill minimally for tests.
if (typeof globalThis.crypto === 'undefined') {
  // Node 20+ exposes webcrypto; expose it as the global `crypto` for browser-y code.
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { webcrypto } = await import('node:crypto');
  Object.defineProperty(globalThis, 'crypto', { value: webcrypto, configurable: true });
}
