import {load as yamlLoad} from 'js-yaml'
import {existsSync} from 'node:fs'
import {mkdir, readFile, writeFile} from 'node:fs/promises'
import {join} from 'node:path'

// ─── OpenAPI types ────────────────────────────────────────────────────────────

export interface OpenApiParameter {
  description?: string
  in: 'cookie' | 'header' | 'path' | 'query'
  name: string
  required?: boolean
  schema?: {enum?: string[]; type?: string}
}

interface OpenApiMediaType {
  schema?: OpenApiSchema
}

interface OpenApiRequestBody {
  content?: Record<string, OpenApiMediaType>
  required?: boolean
}

interface OpenApiSchema {
  description?: string
  properties?: Record<string, OpenApiSchemaProperty>
  required?: string[]
  type?: string
}

interface OpenApiSchemaProperty {
  description?: string
  enum?: string[]
  type?: string
}

interface OpenApiOperation {
  description?: string
  operationId?: string
  parameters?: OpenApiParameter[]
  requestBody?: OpenApiRequestBody
  summary?: string
  tags?: string[]
}

interface OpenApiPaths {
  [path: string]: {
    [method: string]: OpenApiOperation
  }
}

export interface OpenApiSpec {
  info?: {description?: string; title?: string; version?: string}
  openapi?: string
  paths?: OpenApiPaths
  swagger?: string
}

// ─── Stored config types ──────────────────────────────────────────────────────

export type AuthScheme =
  | {apiKey: string; header: string; type: 'apikey'}
  | {password: string; type: 'basic'; username: string}
  | {scheme: 'bearer'; token: string; type: 'http'}
  | {type: 'none'}

export interface BodyParam {
  description?: string
  required: boolean
  type: string
}

export interface StoredOperation {
  bodyParams: Record<string, BodyParam>
  description: string
  method: string
  operationId: string
  parameters: OpenApiParameter[]
  path: string
}

export interface StoredSpec {
  auth: AuthScheme
  baseUrl: string
  description: string
  name: string
  operations: StoredOperation[]
  source: string
  title: string
}

export interface OpenApiStore {
  specs: Record<string, StoredSpec>
}

// ─── File paths ───────────────────────────────────────────────────────────────

function storePath(configDir: string): string {
  return join(configDir, 'openapi-store.json')
}

// ─── Read / write ─────────────────────────────────────────────────────────────

export async function readStore(configDir: string): Promise<OpenApiStore> {
  const fp = storePath(configDir)
  try {
    const raw = await readFile(fp, 'utf8')
    return JSON.parse(raw) as OpenApiStore
  } catch {
    return {specs: {}}
  }
}

export async function writeStore(configDir: string, store: OpenApiStore): Promise<void> {
  if (!existsSync(configDir)) {
    await mkdir(configDir, {recursive: true})
  }

  await writeFile(storePath(configDir), JSON.stringify(store, null, 2), 'utf8')
}

// ─── Spec loading ─────────────────────────────────────────────────────────────

export async function loadSpec(source: string): Promise<OpenApiSpec> {
  let raw: string

  if (source.startsWith('http://') || source.startsWith('https://')) {
    // eslint-disable-next-line n/no-unsupported-features/node-builtins
    const res = await fetch(source)
    if (!res.ok) throw new Error(`HTTP ${res.status} fetching ${source}`)
    raw = await res.text()
  } else {
    raw = await readFile(source, 'utf8')
  }

  const trimmed = raw.trimStart()
  if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
    return JSON.parse(raw) as OpenApiSpec
  }

  return yamlLoad(raw) as OpenApiSpec
}

// ─── Command name generation ──────────────────────────────────────────────────

function deriveOperationId(method: string, path: string): string {
  const segments = path
    .split('/')
    .filter(Boolean)
    .map((s) => (s.startsWith('{') ? s.slice(1, -1) : s))
  return `${method}-${segments.join('-')}`
}

// ─── Spec extraction ──────────────────────────────────────────────────────────

function extractBodyParams(rb: OpenApiRequestBody | undefined): Record<string, BodyParam> {
  const bodyParams: Record<string, BodyParam> = {}
  if (!rb) return bodyParams
  const schema = rb.content?.['application/json']?.schema
  if (!schema?.properties) return bodyParams
  const requiredSet = new Set(schema.required ?? [])
  for (const [name, prop] of Object.entries(schema.properties)) {
    bodyParams[name] = {description: prop.description, required: requiredSet.has(name), type: prop.type ?? 'string'}
  }

  return bodyParams
}

const HTTP_METHODS = ['get', 'post', 'put', 'delete', 'patch', 'options', 'head'] as const

export function extractOperations(spec: OpenApiSpec): StoredOperation[] {
  const ops: StoredOperation[] = []
  const paths = spec.paths ?? {}

  for (const [path, pathItem] of Object.entries(paths)) {
    for (const method of HTTP_METHODS) {
      const operation = (pathItem as Record<string, OpenApiOperation>)[method]
      if (!operation) continue

      const operationId =
        operation.operationId
          ?.replaceAll(/[^\w-]/g, '-')
          .replaceAll(/-+/g, '-')
          .replaceAll(/^-|-$/g, '') ?? deriveOperationId(method, path)

      const parameters: OpenApiParameter[] = (operation.parameters ?? []).map((p) => ({
        description: p.description,
        in: p.in,
        name: p.name,
        required: p.required ?? false,
        schema: p.schema,
      }))

      // Extract request body fields as named body params
      const bodyParams = extractBodyParams(operation.requestBody)

      const description =
        operation.summary ?? operation.description ?? `${method.toUpperCase()} ${path}`

      ops.push({bodyParams, description, method, operationId, parameters, path})
    }
  }

  return ops
}

// ─── Base URL extraction ──────────────────────────────────────────────────────

export function extractBaseUrl(spec: OpenApiSpec & {servers?: Array<{url: string}>}): string {
  // OpenAPI 3.x
  const {servers} = (spec as {servers?: Array<{url: string}>})
  if (servers && servers.length > 0) {
    return servers[0].url.replace(/\/$/, '')
  }

  // Swagger 2.x
  const s2 = spec as {basePath?: string; host?: string; schemes?: string[]}
  if (s2.host) {
    const scheme = s2.schemes?.[0] ?? 'https'
    const basePath = s2.basePath ?? ''
    return `${scheme}://${s2.host}${basePath}`.replace(/\/$/, '')
  }

  return ''
}

// ─── Auth helpers ─────────────────────────────────────────────────────────────

export function buildAuthHeaders(auth: AuthScheme): Record<string, string> {
  switch (auth.type) {
    case 'apikey': {
      return {[auth.header]: auth.apiKey}
    }

    case 'basic': {
      const encoded = Buffer.from(`${auth.username}:${auth.password}`).toString('base64')
      return {Authorization: `Basic ${encoded}`}
    }

    case 'http': {
      return {Authorization: `Bearer ${auth.token}`}
    }

    default: {
      return {}
    }
  }
}

// ─── URL building ─────────────────────────────────────────────────────────────

export function buildUrl(baseUrl: string, path: string, pathParams: Record<string, string>): string {
  let resolvedPath = path
  for (const [key, value] of Object.entries(pathParams)) {
    resolvedPath = resolvedPath.replaceAll(`{${key}}`, encodeURIComponent(value))
  }

  return `${baseUrl}${resolvedPath}`
}
