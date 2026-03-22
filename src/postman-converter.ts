// ─── Postman Collection v2.x types ─────────────────────────────────────────

interface PostmanUrl {
  host?: string[]
  path?: string[]
  query?: Array<{description?: string; key: string; value?: string}>
  raw?: string
  variable?: Array<{description?: string; key: string; value?: string}>
}

interface PostmanHeader {
  description?: string
  key: string
  value?: string
}

interface PostmanBody {
  mode?: string
  raw?: string
}

interface PostmanRequest {
  body?: PostmanBody
  description?: string
  header?: PostmanHeader[]
  method?: string
  url?: PostmanUrl | string
}

interface PostmanItem {
  item?: PostmanItem[]
  name?: string
  request?: PostmanRequest
}

interface PostmanAuth {
  apikey?: Array<{key: string; value?: string}>
  basic?: Array<{key: string; value?: string}>
  bearer?: Array<{key: string; value?: string}>
  type?: string
}

export interface PostmanCollection {
  auth?: PostmanAuth
  info?: {
    _postman_id?: string
    description?: string
    name?: string
    schema?: string
  }
  item?: PostmanItem[]
  variable?: Array<{key: string; value?: string}>
}

// ─── Detection ────────────────────────────────────────────────────────────────

export function isPostmanCollection(obj?: unknown): obj is PostmanCollection {
  if (!obj || typeof obj !== 'object') return false
  const candidate = obj as Record<string, unknown>
  const info = candidate.info as Record<string, unknown> | undefined
  if (!info) return false
  return (
    (typeof info.schema === 'string' && info.schema.includes('schema.getpostman.com')) ||
    typeof info._postman_id === 'string'
  )
}

// ─── Conversion ───────────────────────────────────────────────────────────────

interface OpenApiSpec {
  info: {description?: string; title: string; version: string}
  openapi: string
  paths: Record<string, Record<string, unknown>>
  servers?: Array<{url: string}>
}

function slugify(text: string): string {
  return text
    .toLowerCase()
    .replaceAll(/[^\w]+/g, '-')
    .replaceAll(/^-|-$/g, '')
}

function extractPath(url: PostmanUrl | string | undefined): string {
  if (!url) return '/'

  if (typeof url === 'string') {
    try {
      return new URL(url).pathname || '/'
    } catch {
      // raw string that might be a relative path or contain {{variables}}
      const cleaned = url.replaceAll(/\{\{(\w+)\}\}/g, '{$1}')
      const pathMatch = /^(?:https?:\/\/[^/]*)?(\/.*)$/.exec(cleaned)
      return pathMatch?.[1] ?? `/${cleaned}`
    }
  }

  if (url.path && url.path.length > 0) {
    const segments = url.path.map((seg) => {
      // Postman uses :varName for path variables
      if (seg.startsWith(':')) return `{${seg.slice(1)}}`
      // Postman uses {{varName}} for environment variables
      return seg.replaceAll(/\{\{(\w+)\}\}/g, '{$1}')
    })
    return `/${segments.join('/')}`
  }

  return '/'
}

function extractBaseUrlFromCollection(collection: PostmanCollection): string {
  // Try to extract from first request URL
  const firstItem = findFirstRequest(collection.item ?? [])
  if (!firstItem?.request?.url) return ''

  const {url} = firstItem.request
  if (typeof url === 'string') {
    try {
      const parsed = new URL(url)
      return `${parsed.protocol}//${parsed.host}`
    } catch {
      return ''
    }
  }

  if (url.host && url.host.length > 0) {
    const host = url.host.join('.')
    // Skip template variables as base URL
    if (host.includes('{{')) return ''
    return `https://${host}`
  }

  return ''
}

function findFirstRequest(items: PostmanItem[]): PostmanItem | undefined {
  for (const item of items) {
    if (item.request) return item
    if (item.item) {
      const found = findFirstRequest(item.item)
      if (found) return found
    }
  }

  return undefined
}

function extractParameters(url: PostmanUrl | string | undefined) {
  const parameters: Array<Record<string, unknown>> = []

  if (!url || typeof url === 'string') return parameters

  // Path variables
  for (const v of url.variable ?? []) {
    parameters.push({
      description: v.description,
      in: 'path',
      name: v.key,
      required: true,
      schema: {type: 'string'},
    })
  }

  // Query parameters
  for (const q of url.query ?? []) {
    parameters.push({
      description: q.description,
      in: 'query',
      name: q.key,
      required: false,
      schema: {type: 'string'},
    })
  }

  return parameters
}

function extractRequestBody(body: PostmanBody | undefined): Record<string, unknown> | undefined {
  if (!body || body.mode !== 'raw' || !body.raw) return undefined

  // Try to parse the raw body as JSON to infer schema
  try {
    const parsed = JSON.parse(body.raw)
    if (typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)) {
      const properties: Record<string, {type: string}> = {}
      for (const [key, value] of Object.entries(parsed)) {
        properties[key] = {type: typeof value === 'number' ? 'number' : typeof value === 'boolean' ? 'boolean' : 'string'}
      }

      return {
        content: {
          'application/json': {
            schema: {properties, type: 'object'},
          },
        },
      }
    }
  } catch {
    // Not JSON — skip body schema
  }

  return undefined
}

function flattenItems(items: PostmanItem[], prefix: string[] = []): Array<{item: PostmanItem; prefix: string[]}> {
  const result: Array<{item: PostmanItem; prefix: string[]}> = []
  for (const item of items) {
    if (item.request) {
      result.push({item, prefix})
    }

    if (item.item) {
      result.push(...flattenItems(item.item, [...prefix, item.name ?? 'folder']))
    }
  }

  return result
}

export function postmanToOpenApi(collection: PostmanCollection): OpenApiSpec {
  const title = collection.info?.name ?? 'Postman Collection'
  const description = collection.info?.description ?? ''
  const baseUrl = extractBaseUrlFromCollection(collection)

  const paths: Record<string, Record<string, unknown>> = {}
  const seenOperationIds = new Set<string>()

  for (const {item, prefix} of flattenItems(collection.item ?? [])) {
    const req = item.request!
    const method = (req.method ?? 'GET').toLowerCase()
    const path = extractPath(req.url)

    // Generate operationId from folder prefix + request name
    const nameParts = [...prefix, item.name ?? method]
    let operationId = slugify(nameParts.join('-'))
    if (!operationId) operationId = `${method}-${slugify(path)}`

    // Ensure uniqueness
    let finalId = operationId
    let counter = 2
    while (seenOperationIds.has(finalId)) {
      finalId = `${operationId}-${counter++}`
    }

    seenOperationIds.add(finalId)

    const operation: Record<string, unknown> = {
      description: req.description ?? `${method.toUpperCase()} ${path}`,
      operationId: finalId,
    }

    const parameters = extractParameters(req.url)
    if (parameters.length > 0) {
      operation.parameters = parameters
    }

    const requestBody = extractRequestBody(req.body)
    if (requestBody) {
      operation.requestBody = requestBody
    }

    if (!paths[path]) paths[path] = {}
    paths[path][method] = operation
  }

  const spec: OpenApiSpec = {
    info: {description, title, version: '1.0.0'},
    openapi: '3.0.0',
    paths,
  }

  if (baseUrl) {
    spec.servers = [{url: baseUrl}]
  }

  return spec
}
