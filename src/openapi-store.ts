import {load as yamlLoad} from 'js-yaml'
import {existsSync} from 'node:fs'
import {mkdir, readdir, readFile, unlink, writeFile} from 'node:fs/promises'
import {join} from 'node:path'

import type {PostmanCollection} from './postman-converter.js'

import {isPostmanCollection, postmanToOpenApi} from './postman-converter.js'

// ─── OpenAPI types ────────────────────────────────────────────────────────────

interface OpenApiParameter {
  description?: string
  in: 'cookie' | 'header' | 'path' | 'query'
  name: string
  required?: boolean
  schema?: {enum?: string[]; type?: string}
}

type RawParameter = OpenApiParameter | {$ref: string}

interface OpenApiMediaType {
  schema?: OpenApiSchema | {$ref: string}
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
  parameters?: RawParameter[]
  requestBody?: OpenApiRequestBody
  summary?: string
  tags?: string[]
}

interface OpenApiPaths {
  [path: string]: {
    [method: string]: OpenApiOperation
  }
}

interface OpenApiComponents {
  parameters?: Record<string, OpenApiParameter>
  schemas?: Record<string, OpenApiSchema>
}

interface OpenApiSpec {
  components?: OpenApiComponents
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

interface BodyParam {
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

interface StoredSpec {
  auth: AuthScheme
  baseUrl: string
  description: string
  name: string
  operations: StoredOperation[]
  source: string
  title: string
}

// ts-prune-ignore-next
export interface OpenApiStore {
  specs: Record<string, StoredSpec>
}

// ─── File paths ───────────────────────────────────────────────────────────────

function specFilePath(configDir: string, name: string): string {
  return join(configDir, `openapi-${name}.json`)
}

// ─── Read / write ─────────────────────────────────────────────────────────────

export async function readStore(configDir: string): Promise<OpenApiStore> {
  const store: OpenApiStore = {specs: {}}
  if (!existsSync(configDir)) return store

  let files: string[]
  try {
    files = await readdir(configDir)
  } catch {
    return store
  }

  const specFiles = files.filter((f) => /^openapi-.+\.json$/.test(f))
  const loaded = await Promise.all(
    specFiles.map(async (file) => {
      try {
        const raw = await readFile(join(configDir, file), 'utf8')
        return JSON.parse(raw) as StoredSpec
      } catch {
        return null
      }
    }),
  )

  for (const spec of loaded) {
    if (spec) store.specs[spec.name] = spec
  }

  return store
}

export async function writeStore(configDir: string, store: OpenApiStore): Promise<void> {
  if (!existsSync(configDir)) {
    await mkdir(configDir, {recursive: true})
  }

  await Promise.all(
    Object.entries(store.specs).map(([name, spec]) =>
      writeFile(specFilePath(configDir, name), JSON.stringify(spec, null, 2), 'utf8'),
    ),
  )
}

export async function deleteSpec(configDir: string, name: string): Promise<boolean> {
  const fp = specFilePath(configDir, name)
  try {
    await unlink(fp)
    return true
  } catch {
    return false
  }
}

// ─── Spec loading ─────────────────────────────────────────────────────────────

export async function loadSpec(source: string): Promise<OpenApiSpec> {
  let raw: string

  if (source.startsWith('http://') || source.startsWith('https://')) {
    // eslint-disable-next-line n/no-unsupported-features/node-builtins
    const res = await fetch(source)
    if (!res.ok) throw new Error(`HTTP ${res.status} fetching ${source}`)
    const contentType = res.headers.get('content-type') ?? ''
    if (!contentType.includes('json') && !contentType.includes('yaml') && !contentType.includes('text/plain')) {
      throw new Error(`URL did not return a JSON or YAML file.`)
    }

    raw = await res.text()
  } else {
    raw = await readFile(source, 'utf8')
  }

  const trimmed = raw.trimStart()
  const parsed = (trimmed.startsWith('{') || trimmed.startsWith('['))
    ? JSON.parse(raw)
    : yamlLoad(raw)

  if (isPostmanCollection(parsed)) {
    return postmanToOpenApi(parsed as PostmanCollection) as unknown as OpenApiSpec
  }

  return parsed as OpenApiSpec
}

// ─── Command name generation ──────────────────────────────────────────────────

function deriveOperationId(method: string, path: string): string {
  const segments = path
    .split('/')
    .filter(Boolean)
    .map((s) => (s.startsWith('{') ? s.slice(1, -1) : s))
  return `${method}-${segments.join('-')}`
}

// ─── $ref resolution ──────────────────────────────────────────────────────────

function resolveParameterRef(spec: OpenApiSpec, ref: string): null | OpenApiParameter {
  const match = /^#\/components\/parameters\/(.+)$/.exec(ref)
  if (!match) return null
  return spec.components?.parameters?.[match[1]] ?? null
}

function resolveSchemaRef(spec: OpenApiSpec, ref: string): null | OpenApiSchema {
  const match = /^#\/components\/schemas\/(.+)$/.exec(ref)
  if (!match) return null
  return spec.components?.schemas?.[match[1]] ?? null
}

// ─── Spec extraction ──────────────────────────────────────────────────────────

function resolveParameter(spec: OpenApiSpec, raw: RawParameter): null | OpenApiParameter {
  if ('$ref' in raw) {
    const resolved = resolveParameterRef(spec, raw.$ref)
    if (!resolved) return null
    return {
      description: resolved.description,
      in: resolved.in,
      name: resolved.name,
      required: resolved.required ?? false,
      schema: resolved.schema,
    }
  }

  return {description: raw.description, in: raw.in, name: raw.name, required: raw.required ?? false, schema: raw.schema}
}

function extractBodyParams(spec: OpenApiSpec, rb: OpenApiRequestBody | undefined): Record<string, BodyParam> {
  const bodyParams: Record<string, BodyParam> = {}
  if (!rb) return bodyParams

  const rawSchema = rb.content?.['application/json']?.schema
  if (!rawSchema) return bodyParams

  const schema = '$ref' in rawSchema ? resolveSchemaRef(spec, rawSchema.$ref) : rawSchema
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

      const parameters: OpenApiParameter[] = (operation.parameters ?? [])
        .map((raw) => resolveParameter(spec, raw))
        .filter((p): p is OpenApiParameter => p !== null)

      // Extract request body fields as named body params
      const bodyParams = extractBodyParams(spec, operation.requestBody)

      const description = operation.summary ?? operation.description ?? `${method.toUpperCase()} ${path}`

      ops.push({bodyParams, description, method, operationId, parameters, path})
    }
  }

  return ops
}

// ─── Base URL extraction ──────────────────────────────────────────────────────

export function extractBaseUrl(spec: OpenApiSpec & {servers?: Array<{url: string}>}): string {
  // OpenAPI 3.x
  const {servers} = spec as {servers?: Array<{url: string}>}
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

// ─── KV parsing ───────────────────────────────────────────────────────────────

export function parseKV(pairs: string[]): Record<string, string> {
  const result: Record<string, string> = {}
  for (const pair of pairs) {
    const idx = pair.indexOf('=')
    result[idx === -1 ? pair : pair.slice(0, idx)] = idx === -1 ? '' : pair.slice(idx + 1)
  }

  return result
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
