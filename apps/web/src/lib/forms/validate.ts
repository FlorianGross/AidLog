/**
 * forms/validate.ts — client-side JSON-Schema validation (AJV).
 *
 * The server NEVER sees plaintext, so schema validation is purely a client
 * concern (ARCHITECTURE §6): we validate the form data against the
 * SchemaDefinition's `jsonSchema` BEFORE encryption. Invalid data never gets
 * encrypted/queued.
 */
import Ajv2020, { type ErrorObject, type ValidateFunction } from 'ajv/dist/2020';
import addFormats from 'ajv-formats';
import type { SchemaDefinition } from '@aidlog/contracts';

const ajv = new Ajv2020({ allErrors: true, strict: false });
addFormats(ajv);

// Compiled validators are cached by schemaId+version so re-renders are cheap.
const cache = new Map<string, ValidateFunction>();

function validatorFor(schema: SchemaDefinition): ValidateFunction {
  const key = `${schema.schemaId}@${schema.version}`;
  let fn = cache.get(key);
  if (!fn) {
    fn = ajv.compile(schema.jsonSchema as object);
    cache.set(key, fn);
  }
  return fn;
}

export interface FieldError {
  /** dot/bracket path into the data, '' for the root. */
  path: string;
  message: string;
}

export interface ValidationResult {
  valid: boolean;
  errors: FieldError[];
  /** errors keyed by top-level property name, for inline display. */
  byField: Record<string, string[]>;
}

export function validate(schema: SchemaDefinition, data: unknown): ValidationResult {
  const fn = validatorFor(schema);
  const valid = fn(data) as boolean;
  const errors: FieldError[] = (fn.errors ?? []).map(toFieldError);
  const byField: Record<string, string[]> = {};
  for (const e of errors) {
    const top = topLevelKey(e.path);
    (byField[top] ??= []).push(e.message);
  }
  return { valid, errors, byField };
}

function toFieldError(e: ErrorObject): FieldError {
  const path = e.instancePath.replace(/^\//, '').replace(/\//g, '.');
  // For `required` errors, surface the missing property name as the path.
  if (e.keyword === 'required' && typeof e.params?.['missingProperty'] === 'string') {
    const mp = e.params['missingProperty'];
    return { path: path ? `${path}.${mp}` : mp, message: 'This field is required.' };
  }
  return { path, message: e.message ?? 'Invalid value.' };
}

function topLevelKey(path: string): string {
  if (!path) return '';
  const dot = path.indexOf('.');
  return dot === -1 ? path : path.slice(0, dot);
}
