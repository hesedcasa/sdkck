import {
  buildClientSchema,
  buildSchema,
  getIntrospectionQuery,
  type GraphQLArgument,
  type GraphQLField,
  type GraphQLInputType,
  GraphQLObjectType,
  type GraphQLOutputType,
  type GraphQLSchema,
  type IntrospectionQuery,
  isEnumType,
  isInputObjectType,
  isInterfaceType,
  isListType,
  isNonNullType,
  isObjectType,
  isScalarType,
  isUnionType,
} from 'graphql'
import {readFile} from 'node:fs/promises'

import type {StoredOperation} from './api-store.js'

// ─── Source detection ────────────────────────────────────────────────────────

/**
 * Returns true if the source path looks like a GraphQL SDL file by extension.
 * Used for autodetection when the user does not pass --graphql explicitly.
 */
export function hasGraphQLExtension(source: string): boolean {
  return /\.(graphql|gql|graphqls)$/i.test(source)
}

/**
 * Returns true when the parsed JSON looks like a GraphQL introspection result.
 * Accepts both the full response shape `{data: {__schema: ...}}` and a bare
 * `{__schema: ...}` payload.
 */
// ts-prune-ignore-next
export function isIntrospectionPayload(parsed: unknown): boolean {
  if (!parsed || typeof parsed !== 'object') return false
  const candidate = parsed as {__schema?: unknown; data?: {__schema?: unknown}}
  if (candidate.__schema && typeof candidate.__schema === 'object') return true
  return Boolean(candidate.data?.__schema && typeof candidate.data.__schema === 'object')
}

// ─── Schema loading ──────────────────────────────────────────────────────────

interface LoadOptions {
  /** Extra headers used when POSTing the introspection query to a live endpoint. */
  headers?: Record<string, string>
}

/**
 * Loads a GraphQL schema from an SDL file, an introspection JSON file, or a
 * live endpoint URL (via POSTed introspection query).
 */
export async function loadGraphQLSchema(source: string, opts: LoadOptions = {}): Promise<GraphQLSchema> {
  if (source.startsWith('http://') || source.startsWith('https://')) {
    if (hasGraphQLExtension(new URL(source).pathname)) {
      // eslint-disable-next-line n/no-unsupported-features/node-builtins
      const res = await fetch(source, {headers: opts.headers})
      if (!res.ok) throw new Error(`HTTP ${res.status} fetching GraphQL SDL from ${source}`)
      return parseSchemaSource(await res.text())
    }

    return fetchIntrospection(source, opts.headers)
  }

  const raw = await readFile(source, 'utf8')
  return parseSchemaSource(raw)
}

// ts-prune-ignore-next
export function parseSchemaSource(raw: string): GraphQLSchema {
  const trimmed = raw.trimStart()
  if (trimmed.startsWith('{')) {
    const parsed = JSON.parse(raw) as Partial<IntrospectionQuery> & {data?: IntrospectionQuery}
    const intro = (parsed.data ?? parsed) as IntrospectionQuery
    if (!intro.__schema) {
      throw new Error('JSON source is not a GraphQL introspection result (missing __schema).')
    }

    return buildClientSchema(intro)
  }

  return buildSchema(raw)
}

async function fetchIntrospection(endpoint: string, headers: Record<string, string> = {}): Promise<GraphQLSchema> {
  // eslint-disable-next-line n/no-unsupported-features/node-builtins
  const res = await fetch(endpoint, {
    body: JSON.stringify({query: getIntrospectionQuery()}),
    headers: {'Content-Type': 'application/json', ...headers},
    method: 'POST',
  })

  if (!res.ok) throw new Error(`HTTP ${res.status} fetching GraphQL introspection at ${endpoint}`)

  const body = (await res.json()) as {data?: IntrospectionQuery; errors?: unknown[]}
  if (!body.data?.__schema) {
    const msg = body.errors ? JSON.stringify(body.errors) : 'no __schema in response'
    throw new Error(`GraphQL introspection failed: ${msg}`)
  }

  return buildClientSchema(body.data)
}

// ─── Type helpers ────────────────────────────────────────────────────────────

function unwrapInput(type: GraphQLInputType): GraphQLInputType {
  if (isNonNullType(type)) return unwrapInput(type.ofType as GraphQLInputType)
  if (isListType(type)) return unwrapInput(type.ofType as GraphQLInputType)
  return type
}

function unwrapOutput(type: GraphQLOutputType): GraphQLOutputType {
  if (isNonNullType(type)) return unwrapOutput(type.ofType as GraphQLOutputType)
  if (isListType(type)) return unwrapOutput(type.ofType as GraphQLOutputType)
  return type
}

function formatTypeRef(type: GraphQLInputType | GraphQLOutputType): string {
  if (isNonNullType(type)) return `${formatTypeRef(type.ofType as GraphQLInputType | GraphQLOutputType)}!`
  if (isListType(type)) return `[${formatTypeRef(type.ofType as GraphQLInputType | GraphQLOutputType)}]`
  return type.name
}

function isListOrWrappedList(type: GraphQLInputType): boolean {
  if (isListType(type)) return true
  if (isNonNullType(type)) return isListOrWrappedList(type.ofType as GraphQLInputType)
  return false
}

/**
 * Maps a GraphQL argument's base type to the lightweight type string that
 * StoredOperation.bodyParams uses. The dynamic command layer relies on this to
 * decide how to coerce values read from argv.
 */
function mapArgumentType(type: GraphQLInputType): string {
  if (isListOrWrappedList(type)) return 'array'
  const base = unwrapInput(type)
  if (isInputObjectType(base)) return 'object'
  if (isScalarType(base)) {
    switch (base.name) {
      case 'Boolean': {
        return 'boolean'
      }

      case 'Float':
      case 'Int': {
        return 'number'
      }

      default: {
        return 'string'
      }
    }
  }

  return 'string'
}

// ─── Selection set generation ────────────────────────────────────────────────

const DEFAULT_SELECTION_DEPTH = 3

function pad(level: number): string {
  return '  '.repeat(level)
}

/**
 * Generates a default selection set for a GraphQL output type, recursing into
 * object types up to `maxDepth` levels. Fields that require arguments are
 * skipped — callers can re-run `api import` or edit the stored query if they
 * need a richer selection.
 */
function buildSelectionSet(type: GraphQLOutputType, maxDepth: number): string {
  return renderSelection(type, maxDepth, new Set(), 1)
}

function renderSelection(type: GraphQLOutputType, depth: number, visited: ReadonlySet<string>, indent: number): string {
  const inner = unwrapOutput(type)

  if (isScalarType(inner) || isEnumType(inner)) return ''

  // Unions and interfaces: __typename is the only safe fallback without inline fragments.
  if (isUnionType(inner) || isInterfaceType(inner)) {
    return `{\n${pad(indent)}__typename\n${pad(indent - 1)}}`
  }

  if (!isObjectType(inner)) return ''

  // Depth exhausted or cycle detected — return '' so the parent skips this field
  // entirely rather than emitting `field { __typename }`, which some APIs reject
  // for feature-gated fields.
  if (depth <= 0 || visited.has(inner.name)) return ''

  const nextVisited = new Set(visited).add(inner.name)
  const fields = (inner as GraphQLObjectType).getFields()
  const lines: string[] = []

  for (const field of Object.values(fields)) {
    // Can't auto-invoke fields that require arguments — skip them.
    if (field.args.some((arg) => isNonNullType(arg.type))) continue

    const unwrappedField = unwrapOutput(field.type)
    const isLeaf = isScalarType(unwrappedField) || isEnumType(unwrappedField)

    if (isLeaf) {
      lines.push(`${pad(indent)}${field.name}`)
    } else {
      const sub = renderSelection(field.type, depth - 1, nextVisited, indent + 1)
      if (sub) lines.push(`${pad(indent)}${field.name} ${sub}`)
      // Object fields with no selectable sub-fields are omitted entirely.
    }
  }

  if (lines.length === 0) return ''

  return `{\n${lines.join('\n')}\n${pad(indent - 1)}}`
}

// ─── Operation document assembly ─────────────────────────────────────────────

function capitalize(input: string): string {
  return input.length === 0 ? input : input[0].toUpperCase() + input.slice(1)
}

interface BuildDocumentInput {
  args: ReadonlyArray<GraphQLArgument>
  fieldName: string
  maxDepth: number
  operationName: string
  operationType: 'mutation' | 'query'
  returnType: GraphQLOutputType
}

function buildOperationDocument(input: BuildDocumentInput): string {
  const {args, fieldName, maxDepth, operationName, operationType, returnType} = input
  const varDecls = args.length > 0 ? `(${args.map((a) => `$${a.name}: ${formatTypeRef(a.type)}`).join(', ')})` : ''
  const argList = args.length > 0 ? `(${args.map((a) => `${a.name}: $${a.name}`).join(', ')})` : ''
  const selection = buildSelectionSet(returnType, maxDepth)
  const selectionSuffix = selection ? ` ${selection}` : ''
  return `${operationType} ${operationName}${varDecls} {\n  ${fieldName}${argList}${selectionSuffix}\n}`
}

// ─── Main conversion ─────────────────────────────────────────────────────────

interface GraphQLImportResult {
  description?: string
  operations: StoredOperation[]
  title: string
}

interface ConvertOptions {
  description?: string
  /** Depth limit for auto-generated selection sets. Defaults to 3. */
  selectionDepth?: number
  title?: string
}

export function convertSchema(schema: GraphQLSchema, opts: ConvertOptions = {}): GraphQLImportResult {
  const depth = opts.selectionDepth ?? DEFAULT_SELECTION_DEPTH
  const operations: StoredOperation[] = []

  const queryType = schema.getQueryType()
  if (queryType) {
    for (const field of Object.values(queryType.getFields())) {
      operations.push(fieldToOperation('query', field, depth))
    }
  }

  const mutationType = schema.getMutationType()
  if (mutationType) {
    for (const field of Object.values(mutationType.getFields())) {
      operations.push(fieldToOperation('mutation', field, depth))
    }
  }

  return {
    description: opts.description,
    operations: dedupeOperationIds(operations),
    title: opts.title ?? 'GraphQL API',
  }
}

function fieldToOperation(
  operationType: 'mutation' | 'query',
  field: GraphQLField<unknown, unknown>,
  depth: number,
): StoredOperation {
  const operationId = sanitizeIdentifier(field.name)
  const operationName = sanitizeIdentifier(`${operationType}${capitalize(field.name)}`)

  const bodyParams: StoredOperation['bodyParams'] = {}
  for (const arg of field.args) {
    bodyParams[arg.name] = {
      description: arg.description ?? undefined,
      required: isNonNullType(arg.type),
      type: mapArgumentType(arg.type),
    }
  }

  const query = buildOperationDocument({
    args: field.args,
    fieldName: field.name,
    maxDepth: depth,
    operationName,
    operationType,
    returnType: field.type,
  })

  return {
    bodyParams,
    description: field.description ?? `${operationType} ${field.name}`,
    graphql: {
      fieldName: field.name,
      operationType,
      query,
    },
    method: 'post',
    operationId,
    parameters: [],
    path: '',
  }
}

function sanitizeIdentifier(raw: string): string {
  return raw
    .replaceAll(/[^\w-]/g, '-')
    .replaceAll(/-+/g, '-')
    .replaceAll(/^-|-$/g, '')
}

/**
 * GraphQL Query and Mutation fields live in separate namespaces but share a
 * single sdkck command namespace per spec. When a name appears in both roots
 * we disambiguate the mutation with a `-mutation` suffix — queries keep the
 * short name so the common case stays ergonomic.
 */
function dedupeOperationIds(ops: StoredOperation[]): StoredOperation[] {
  const seen = new Set<string>()
  return ops.map((op) => {
    if (!seen.has(op.operationId)) {
      seen.add(op.operationId)
      return op
    }

    const suffix = op.graphql?.operationType === 'mutation' ? '-mutation' : '-query'
    const candidate = `${op.operationId}${suffix}`
    seen.add(candidate)
    return {...op, operationId: candidate}
  })
}
