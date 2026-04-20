import {readFileSync} from 'node:fs'
import {mkdir, writeFile} from 'node:fs/promises'
import {dirname} from 'node:path'

interface CacheEntry {
  output: string
  timestamp: number
}

interface CacheFile {
  entries: Record<string, CacheEntry>
}

interface SearchCacheOptions {
  cacheFilePath?: string
  ttlMs?: number
}

const DEFAULT_TTL_MS = 300_000 // 5 minutes

export class SearchCache {
  private cache = new Map<string, CacheEntry>()
  private readonly filePath?: string
  private readonly ttlMs: number
  private writePending = false

  constructor(options: SearchCacheOptions = {}) {
    this.ttlMs = options.ttlMs ?? DEFAULT_TTL_MS
    this.filePath = options.cacheFilePath
    if (this.filePath) this.loadFromFile()
  }

  get(query: string, limit?: number): string | undefined {
    const key = this.key(query, limit)
    const entry = this.cache.get(key)
    if (!entry) return undefined
    if (Date.now() - entry.timestamp > this.ttlMs) {
      this.cache.delete(key)
      return undefined
    }

    return entry.output
  }

  set(query: string, limit: number | undefined, output: string): void {
    if (!output) return
    const key = this.key(query, limit)
    this.cache.set(key, {output, timestamp: Date.now()})
    this.persist()
  }

  private key(query: string, limit?: number): string {
    const normalized = query.trim().toLowerCase().split(/\s+/).join(' ')
    return `${normalized}|${limit ?? 5}`
  }

  private loadFromFile(): void {
    try {
      const raw = readFileSync(this.filePath!, 'utf8')
      const data: CacheFile = JSON.parse(raw)
      const now = Date.now()
      for (const [key, entry] of Object.entries(data.entries)) {
        if (now - entry.timestamp <= this.ttlMs) {
          this.cache.set(key, entry)
        }
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
        console.error(
          `Failed to load cache from "${this.filePath}": ${error instanceof Error ? error.message : String(error)}`,
        )
      }
    }
  }

  private persist(): void {
    if (!this.filePath) return
    if (this.writePending) return
    this.writePending = true
    setTimeout(() => {
      this.writeToFile()
        .catch(() => {})
        .finally(() => {
          this.writePending = false
        })
    }, 0)
  }

  private async writeToFile(): Promise<void> {
    try {
      const data: CacheFile = {entries: Object.fromEntries(this.cache)}
      const json = JSON.stringify(data, null, 2)
      await mkdir(dirname(this.filePath!), {recursive: true})
      await writeFile(this.filePath!, json, 'utf8')
    } catch (error) {
      console.error(
        `Failed to persist cache to "${this.filePath}": ${error instanceof Error ? error.message : String(error)}`,
      )
    }
  }
}
