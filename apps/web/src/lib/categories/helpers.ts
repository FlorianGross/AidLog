/**
 * categories/helpers.ts — pure, framework-free helpers for PROTOCOL CATEGORIES.
 *
 * A protocol category (Sanitätsdienst / HvO / EGB …) bundles its OWN protocol
 * schema (a `DocSchema`, carried as opaque JSON in `ProtocolCategory.schema`)
 * with a permission deciding who may create a deployment under it. These helpers
 * are Svelte-free so they stay unit-testable; the reactive store in `./store.ts`
 * builds on them.
 */
import type { CategoryCreatePermission, ProtocolCategory, Role } from '@aidlog/contracts';
import { abcdeSchema } from '$lib/schemas/abcde';
import type { DocSchema } from '$lib/schemas/types';

/** True when `value` looks like a usable `DocSchema` (≥1 section). */
export function isDocSchema(value: unknown): value is DocSchema {
  return (
    !!value &&
    typeof value === 'object' &&
    typeof (value as DocSchema).schemaId === 'string' &&
    Array.isArray((value as DocSchema).sections)
  );
}

/**
 * Does `role` satisfy a category's `createPermission`?
 *   - 'all'   → everyone (helper, lead, admin)
 *   - 'lead'  → lead OR admin
 *   - 'admin' → admin only
 * A null/unknown role (locked) may create nothing.
 */
export function roleSatisfies(
  permission: CategoryCreatePermission,
  role: Role | null | undefined,
): boolean {
  if (!role) return false;
  switch (permission) {
    case 'all':
      return true;
    case 'lead':
      return role === 'lead' || role === 'admin';
    case 'admin':
      return role === 'admin';
  }
}

/** Sort categories for display: by `sortOrder`, then name (stable, locale-aware). */
export function sortCategories(categories: readonly ProtocolCategory[]): ProtocolCategory[] {
  return [...categories].sort(
    (a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name, 'de'),
  );
}

/**
 * The categories an `role` may create a deployment under: only ACTIVE ones whose
 * `createPermission` the role satisfies, in display order.
 */
export function categoriesForRole(
  categories: readonly ProtocolCategory[],
  role: Role | null | undefined,
): ProtocolCategory[] {
  return sortCategories(
    categories.filter((c) => c.active && roleSatisfies(c.createPermission, role)),
  );
}

/** Look up a category by id (undefined id / no match → undefined). */
export function categoryById(
  categories: readonly ProtocolCategory[],
  id: string | null | undefined,
): ProtocolCategory | undefined {
  if (!id) return undefined;
  return categories.find((c) => c.id === id);
}

/**
 * Resolve the `DocSchema` to use for a category, with a robust fallback chain:
 *   1. the category's own schema (when present and valid),
 *   2. the supplied org-active schema (when present and valid),
 *   3. the built-in ABCDE default.
 * Backward-compatible: an undefined category (old deployments) → org/ABCDE.
 */
export function schemaForCategory(
  category: ProtocolCategory | null | undefined,
  orgActive?: DocSchema | null,
): DocSchema {
  if (category && isDocSchema(category.schema)) return category.schema;
  if (orgActive && isDocSchema(orgActive)) return orgActive;
  return abcdeSchema;
}
