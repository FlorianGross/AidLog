/**
 * forms/schema-fields.ts — turn a JSON-Schema (draft 2020-12) + uiSchema into a
 * flat, ordered list of renderable field descriptors for SchemaForm.svelte.
 *
 * Supported widgets are inferred from the JSON-Schema type/format, overridable
 * via `uiSchema['ui:widget']`. Nested `object` properties (e.g. `vitals`) are
 * flattened one level into a labelled group so adding a vital is just a schema
 * edit. This deliberately covers the common protocol shapes; richer constructs
 * (oneOf, arrays of objects) can be layered on without touching callers.
 */

export type Widget =
  | 'text'
  | 'number'
  | 'integer'
  | 'select'
  | 'date'
  | 'datetime'
  | 'boolean'
  | 'textarea'
  | 'image-capture';

export interface FieldDescriptor {
  /** dot path into the data object, e.g. "vitals.spo2". */
  path: string;
  /** the immediate property key. */
  key: string;
  title: string;
  description?: string;
  widget: Widget;
  required: boolean;
  enum?: string[];
  min?: number;
  max?: number;
  /** group label when the field belongs to a nested object, else undefined. */
  group?: string;
}

interface JsonSchemaNode {
  type?: string | string[];
  title?: string;
  description?: string;
  format?: string;
  enum?: unknown[];
  minimum?: number;
  maximum?: number;
  minLength?: number;
  maxLength?: number;
  properties?: Record<string, JsonSchemaNode>;
  required?: string[];
  contentMediaType?: string;
}

type UiSchema = Record<string, unknown>;

export function buildFields(
  jsonSchema: Record<string, unknown>,
  uiSchema?: UiSchema,
): FieldDescriptor[] {
  const root = jsonSchema as JsonSchemaNode;
  const props = root.properties ?? {};
  const required = new Set(root.required ?? []);
  const order = (uiSchema?.['ui:order'] as string[] | undefined) ?? Object.keys(props);

  const fields: FieldDescriptor[] = [];
  for (const key of order) {
    const node = props[key];
    if (!node) continue;
    const ui = uiSchema?.[key] as UiSchema | undefined;

    if (typeOf(node) === 'object' && node.properties) {
      // Flatten one level into a group.
      const sub = node.properties;
      const subRequired = new Set(node.required ?? []);
      for (const subKey of Object.keys(sub)) {
        const subNode = sub[subKey];
        if (!subNode) continue;
        fields.push(
          descriptor(
            `${key}.${subKey}`,
            subKey,
            subNode,
            subRequired.has(subKey),
            (ui?.[subKey] as UiSchema | undefined)?.['ui:widget'] as string | undefined,
            node.title ?? key,
          ),
        );
      }
      continue;
    }

    fields.push(
      descriptor(key, key, node, required.has(key), ui?.['ui:widget'] as string | undefined),
    );
  }
  return fields;
}

function descriptor(
  path: string,
  key: string,
  node: JsonSchemaNode,
  required: boolean,
  uiWidget: string | undefined,
  group?: string,
): FieldDescriptor {
  return {
    path,
    key,
    title: node.title ?? key,
    ...(node.description !== undefined ? { description: node.description } : {}),
    widget: pickWidget(node, uiWidget),
    required,
    ...(node.enum ? { enum: node.enum.map(String) } : {}),
    ...(node.minimum !== undefined ? { min: node.minimum } : {}),
    ...(node.maximum !== undefined ? { max: node.maximum } : {}),
    ...(group !== undefined ? { group } : {}),
  };
}

function pickWidget(node: JsonSchemaNode, uiWidget?: string): Widget {
  if (uiWidget && isWidget(uiWidget)) return uiWidget;
  const t = typeOf(node);
  if (node.enum) return 'select';
  if (t === 'boolean') return 'boolean';
  if (t === 'integer') return 'integer';
  if (t === 'number') return 'number';
  if (t === 'string') {
    if (node.format === 'date') return 'date';
    if (node.format === 'date-time') return 'datetime';
    if (node.contentMediaType?.startsWith('image/')) return 'image-capture';
    return 'text';
  }
  return 'text';
}

function isWidget(s: string): s is Widget {
  return [
    'text',
    'number',
    'integer',
    'select',
    'date',
    'datetime',
    'boolean',
    'textarea',
    'image-capture',
  ].includes(s);
}

function typeOf(node: JsonSchemaNode): string | undefined {
  return Array.isArray(node.type) ? node.type[0] : node.type;
}
