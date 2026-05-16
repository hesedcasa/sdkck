import {encode} from '@toon-format/toon'

export function formatAsToon(data: unknown): string {
  if (!data) {
    return ''
  }

  return encode(data)
}
