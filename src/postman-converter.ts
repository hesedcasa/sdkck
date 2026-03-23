import {convert} from '@scalar/postman-to-openapi'

export type PostmanCollection = object & Parameters<typeof convert>[0]

// ─── Detection ────────────────────────────────────────────────────────────────

export function isPostmanCollection(obj?: unknown): boolean {
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

export function postmanToOpenApi(collection: PostmanCollection): ReturnType<typeof convert> {
  return convert(collection)
}
