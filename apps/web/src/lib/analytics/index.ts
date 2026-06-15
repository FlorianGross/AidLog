/**
 * lib/analytics — CLIENT-SIDE org analytics (KPIs, injury heatmap, anonymised
 * export). Computed by an admin/lead who unlocks the org key locally; nothing
 * decrypted is persisted and only AGGREGATES are exported (see types.ts).
 */
export * from './types';
export { aggregate, type DecryptedEntry, HEAT_COLS, HEAT_ROWS } from './aggregate';
export { runAnalytics, type RunArgs, type RunResult, type RunProgress } from './run';
export { toJson, toCsv, downloadFile, ANONYMISATION_NOTICE, type LabelFn } from './export';
export { schemaLabels } from './labels';
