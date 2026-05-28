import {readFileSync} from 'node:fs'
import {mkdir, writeFile} from 'node:fs/promises'
import {join} from 'node:path'

export interface UsageEntry {
  count: number
  lastUsed: number
}

export type UsageMap = Record<string, UsageEntry>

interface UsageFile {
  entries: UsageMap
}

export function readUsageSync(configDir: string): UsageMap {
  try {
    const raw = readFileSync(join(configDir, 'usage.json'), 'utf8')
    return (JSON.parse(raw) as UsageFile).entries ?? {}
  } catch {
    return {}
  }
}

/**
 * Re-ranks command IDs by blending semantic position with usage frequency.
 * Each command at position i gets an adjusted score of i - ln(1 + count) * 0.5.
 * ~10 uses are needed to jump one position over an unused command, so semantic
 * relevance stays dominant while frequently-used commands gradually surface.
 */
export function applyUsageBoost(ranked: string[], usage: UsageMap): string[] {
  if (Object.keys(usage).length === 0) return ranked
  const adjusted = ranked.map((id, i) => ({
    id,
    score: i - Math.log(1 + (usage[id]?.count ?? 0)) * 0.5,
  }))
  adjusted.sort((a, b) => a.score - b.score)
  return adjusted.map((e) => e.id)
}

// ts-prune-ignore-next
export async function recordUsage(configDir: string, commandId: string): Promise<void> {
  if (!configDir) return
  const filePath = join(configDir, 'usage.json')
  const entries = readUsageSync(configDir)
  const prev = entries[commandId] ?? {count: 0, lastUsed: 0}
  entries[commandId] = {count: prev.count + 1, lastUsed: Date.now()}
  try {
    await mkdir(configDir, {recursive: true})
    await writeFile(filePath, JSON.stringify({entries}, null, 2), 'utf8')
  } catch {
    // fire-and-forget — never block the calling command
  }
}
