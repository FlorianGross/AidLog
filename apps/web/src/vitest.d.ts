/// <reference types="@testing-library/jest-dom" />
// Makes the jest-dom matchers (toBeInTheDocument, etc.) visible to svelte-check
// and vitest's `expect` across all *.test.ts files.
import 'vitest';
import type { TestingLibraryMatchers } from '@testing-library/jest-dom/matchers';

declare module 'vitest' {
  interface Assertion<T = unknown> extends TestingLibraryMatchers<unknown, T> {}
  interface AsymmetricMatchersContaining extends TestingLibraryMatchers<unknown, unknown> {}
}
