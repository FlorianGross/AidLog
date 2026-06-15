/**
 * Public surface of the protocol-categories feature.
 *
 * The reactive store re-exports the store-bound (no-list) versions of
 * `categoriesForRole` / `categoryById` / `schemaForCategory`; the remaining pure
 * helpers are re-exported explicitly to avoid name clashes with those wrappers.
 */
export {
  isDocSchema,
  roleSatisfies,
  sortCategories,
  categoriesForRole as categoriesForRolePure,
  categoryById as categoryByIdPure,
  schemaForCategory as schemaForCategoryPure,
} from './helpers';
export * from './store';

/**
 * Reserved payload key under which a record carries its deployment's category id.
 * Embedding it in the ENCRYPTED record payload (alongside the field values) makes
 * the category travel end-to-end with every record — a reader who can decrypt the
 * record learns which category schema produced it, independent of the local
 * `DeploymentMeta`. It is NOT a `DocField` (no schema renders it), so it never
 * appears as an editable form field. Old records simply omit it.
 */
export const CATEGORY_ID_KEY = '__categoryId__';
