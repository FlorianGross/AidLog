import { createRequire } from 'node:module';
import { dirname, resolve as resolvePath } from 'node:path';
import { defineConfig } from 'vitest/config';

// The published ESM build of libsodium-wrappers-sumo@0.7.16 is broken: its
// `modules-sumo-esm/libsodium-wrappers.mjs` imports `./libsodium-sumo.mjs`,
// which is NOT shipped in the package (only the CommonJS build is complete).
// We therefore alias the bare import to the working CJS entry for tests. The
// production library code is unchanged and import-style-agnostic.
//
// The package's `exports` map forbids deep/`package.json` subpaths, so we
// resolve the allowed main entry ("." → CJS file) and use its directory.
const require = createRequire(import.meta.url);
// require.resolve of the bare specifier honours `exports` and lands on the CJS
// `modules-sumo/libsodium-wrappers.js` (the `require`/`default` condition).
const sumoCjs = resolvePath(require.resolve('libsodium-wrappers-sumo'));
void dirname; // kept for clarity; sumoCjs is already the concrete CJS file.

export default defineConfig({
  resolve: {
    alias: {
      'libsodium-wrappers-sumo': sumoCjs,
    },
  },
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      include: ['src/index.ts'],
    },
  },
});
