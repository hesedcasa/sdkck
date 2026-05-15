import type {Command} from '@oclif/core'
import type {Config} from '@oclif/core/interfaces'

import {toConfiguredId} from '@oclif/core'

import {fileLog} from './file-logger.js'
import {isCommandAllowed, readPermissionConfig} from './permission-config.js'

// ─── Public types ────────────────────────────────────────────────────────────

export interface CommandArg {
  description?: string
  name: string
  required: boolean
}

export interface CommandFlag {
  description?: string
  multiple: boolean
  name: string
  required: boolean
  type: 'boolean' | 'option'
}

export interface CommandInfo {
  aliases: string[]
  args: CommandArg[]
  description?: string
  displayId: string
  flags: CommandFlag[]
  hidden: boolean
  id: string
  isDynamic: boolean
  isPermitted: boolean
  isSensitive: boolean
  pluginName?: string
  pluginType?: 'core' | 'jit' | 'link' | 'user'
  summary?: string
  topic?: string
}

export interface ListCommandsOptions {
  includeDisallowed?: boolean
  includeHidden?: boolean
  includeSensitive?: boolean
  topic?: string
}

export interface RunCommandOptions {
  allowDisallowed?: boolean
  allowSensitive?: boolean
}

export interface RunCommandResult {
  error?: string
  output: string
}

export type SdkckExecutionDenialCode = 'command_not_found' | 'permission_denied' | 'sensitive_denied'

export class SdkckExecutionError extends Error {
  code: SdkckExecutionDenialCode
  commandId: string

  constructor(code: SdkckExecutionDenialCode, commandId: string, message: string) {
    super(message)
    this.name = 'SdkckExecutionError'
    this.code = code
    this.commandId = commandId
  }
}

// ─── Sensitive classification ────────────────────────────────────────────────

export const SENSITIVE_SEGMENTS: ReadonlySet<string> = new Set([
  'auth',
  'credential',
  'credentials',
  'login',
  'logout',
  'secret',
  'secrets',
  'token',
  'tokens',
])

/**
 * Classifies a command as sensitive.
 *
 * Precedence:
 *   1. If the class has `static sensitive` defined (boolean), that wins.
 *   2. Otherwise, return true iff any colon-separated segment of the id
 *      matches SENSITIVE_SEGMENTS (case-insensitive).
 */
export function isSensitiveCommand(
  commandId: string,
  CmdClass: typeof Command | {sensitive?: boolean},
): boolean {
  const explicit = (CmdClass as {sensitive?: boolean}).sensitive
  if (typeof explicit === 'boolean') return explicit

  for (const segment of commandId.split(':')) {
    if (SENSITIVE_SEGMENTS.has(segment.toLowerCase())) return true
  }

  return false
}

// ─── Internal helpers ────────────────────────────────────────────────────────

function mapArgs(rawArgs: Record<string, unknown> | undefined): CommandArg[] {
  if (!rawArgs) return []
  return Object.entries(rawArgs).map(([name, def]) => {
    const d = def as {description?: string; required?: boolean}
    return Object.freeze({
      description: d.description,
      name,
      required: Boolean(d.required),
    })
  })
}

function mapFlags(rawFlags: Record<string, unknown> | undefined): CommandFlag[] {
  if (!rawFlags) return []
  return Object.entries(rawFlags).map(([name, def]) => {
    const d = def as {description?: string; multiple?: boolean; required?: boolean; type?: string}
    return Object.freeze({
      description: d.description,
      multiple: Boolean(d.multiple),
      name,
      required: Boolean(d.required),
      type: d.type === 'boolean' ? ('boolean' as const) : ('option' as const),
    })
  })
}

async function toCommandInfo(
  loadable: Command.Loadable,
  config: Config,
  permittedSeparator: string,
  permissionConfig: Awaited<ReturnType<typeof readPermissionConfig>>,
): Promise<CommandInfo | undefined> {
  let CmdClass: undefined | {__sdkckDynamic?: boolean; sensitive?: boolean;}
  try {
    CmdClass = (await loadable.load()) as unknown as {__sdkckDynamic?: boolean; sensitive?: boolean;}
  } catch (error) {
    fileLog(
      'error',
      `sdkck.commands.list: failed to load ${loadable.id}: ${error instanceof Error ? error.message : String(error)}`,
    )
    return undefined
  }

  const {id} = loadable
  const displayId = toConfiguredId(id, config)
  const normalizedForPermission = id.replaceAll(':', permittedSeparator)
  const isPermitted = isCommandAllowed(normalizedForPermission, permissionConfig)
  const isSensitive = isSensitiveCommand(id, CmdClass)
  const isDynamic = (CmdClass as {__sdkckDynamic?: boolean}).__sdkckDynamic === true
  const topic = id.includes(':') ? id.split(':')[0] : undefined

  const info: CommandInfo = {
    aliases: Object.freeze([...(loadable.aliases ?? [])]) as unknown as string[],
    args: Object.freeze(mapArgs(loadable.args as Record<string, unknown> | undefined)) as unknown as CommandArg[],
    description: loadable.description,
    displayId,
    flags: Object.freeze(mapFlags(loadable.flags as Record<string, unknown> | undefined)) as unknown as CommandFlag[],
    hidden: Boolean(loadable.hidden),
    id,
    isDynamic,
    isPermitted,
    isSensitive,
    pluginName: loadable.pluginName,
    pluginType: loadable.pluginType as CommandInfo['pluginType'],
    summary: loadable.summary,
    topic,
  }

  return Object.freeze(info)
}

// ─── Public surface ──────────────────────────────────────────────────────────

export const sdkck = {
  commands: {
    async list(config: Config, opts: ListCommandsOptions = {}): Promise<readonly CommandInfo[]> {
      const permissionConfig = await readPermissionConfig(config.configDir)
      const separator = config.topicSeparator ?? ' '

      const candidates = opts.topic
        ? config.commands.filter(
            (l) => l.id.startsWith(`${opts.topic}:`) || l.id === opts.topic,
          )
        : config.commands

      const settled = await Promise.allSettled(
        candidates.map((loadable) => toCommandInfo(loadable, config, separator, permissionConfig)),
      )

      const results: CommandInfo[] = []
      for (const outcome of settled) {
        if (outcome.status === 'rejected' || !outcome.value) continue
        const info = outcome.value
        if (!opts.includeHidden && info.hidden) continue
        if (!opts.includeDisallowed && !info.isPermitted) continue
        if (!opts.includeSensitive && info.isSensitive) continue
        results.push(info)
      }

      results.sort((a, b) => a.displayId.localeCompare(b.displayId))
      return Object.freeze(results)
    },
  },
} as const
