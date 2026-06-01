import {existsSync} from 'node:fs'
import {mkdir, readFile, writeFile} from 'node:fs/promises'
import {join} from 'node:path'

interface PermissionRule {
  pattern: string
}

export interface PermissionConfig {
  rules: PermissionRule[]
}

function configFilePath(configDir: string): string {
  return join(configDir, 'permission.json')
}

export async function readPermissionConfig(configDir: string | undefined): Promise<PermissionConfig> {
  if (!configDir) return {rules: []}
  const filePath = configFilePath(configDir)
  try {
    const content = await readFile(filePath, 'utf8')
    return JSON.parse(content) as PermissionConfig
  } catch {
    return {rules: []}
  }
}

export async function writePermissionConfig(configDir: string, config: PermissionConfig): Promise<void> {
  if (!existsSync(configDir)) {
    await mkdir(configDir, {recursive: true})
  }

  await writeFile(configFilePath(configDir), JSON.stringify(config, null, 2), 'utf8')
}

/**
 * Returns true if a command ID matches the given pattern.
 *
 * Pattern forms:
 *   "*"            — matches every command
 *   "jira"         — matches the exact command "jira" AND any command in the
 *                    "jira" topic (e.g. "jira issue", "jira issue create")
 *   "jira *"       — same as above (explicit wildcard)
 *   "jira issue *" — matches "jira issue" and any sub-command thereof
 *   "jira issue"   — exact match only (no sub-commands unless "jira issue *" is used)
 *
 * Note: bare topic pattern "jira" also matches "jira" itself, mirroring the
 * behaviour of "jira *" for topic-level allow/disallow convenience.
 */
export function matchesPattern(commandId: string, pattern: string): boolean {
  const p = pattern.trim()

  if (p === '*') return true

  // Trailing " *" — strip the wildcard and treat as a prefix match
  if (p.endsWith(' *')) {
    const prefix = p.slice(0, -2)
    return commandId === prefix || commandId.startsWith(prefix + ' ')
  }

  // Exact match
  if (commandId === p) return true

  // Topic match: bare "jira" also covers "jira issue", "jira issue create", etc.
  if (commandId.startsWith(p + ' ')) return true

  return false
}

/**
 * Returns true if a command id is allowed by the given permission config.
 * A command is blocked if any rule pattern matches it. Unmatched commands are allowed.
 */
export function isCommandAllowed(commandId: string, config: PermissionConfig): boolean {
  return !config.rules.some((rule) => matchesPattern(commandId, rule.pattern))
}
