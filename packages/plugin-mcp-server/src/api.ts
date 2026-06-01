import type {Command} from '@oclif/core'
import type {Config} from '@oclif/core/interfaces'

import {toConfiguredId} from '@oclif/core'

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
  isPermitted: boolean
  pluginName?: string
  pluginType?: 'core' | 'jit' | 'link' | 'user'
  summary?: string
  topic?: string
}

export interface ListCommandsOptions {
  includeDisallowed?: boolean
  includeHidden?: boolean
  topic?: string
}

export type RunCommandOptions = Record<string, never>

export interface RunCommandResult {
  error?: string
  output: string
}

export type SdkckExecutionDenialCode = 'command_not_found' | 'permission_denied'

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

function toCommandInfo(
  loadable: Command.Loadable,
  config: Config,
  permittedSeparator: string,
  permissionConfig: Awaited<ReturnType<typeof readPermissionConfig>>,
): CommandInfo {
  const {id} = loadable
  const displayId = toConfiguredId(id, config)
  const normalizedForPermission = id.replaceAll(':', permittedSeparator)
  const isPermitted = isCommandAllowed(normalizedForPermission, permissionConfig)
  const topic = id.includes(':') ? id.split(':')[0] : undefined

  const info: CommandInfo = {
    aliases: Object.freeze([...(loadable.aliases ?? [])]) as unknown as string[],
    args: Object.freeze(mapArgs(loadable.args as Record<string, unknown> | undefined)) as unknown as CommandArg[],
    description: loadable.description,
    displayId,
    flags: Object.freeze(mapFlags(loadable.flags as Record<string, unknown> | undefined)) as unknown as CommandFlag[],
    hidden: Boolean(loadable.hidden),
    id,
    isPermitted,
    pluginName: loadable.pluginName,
    pluginType: loadable.pluginType as CommandInfo['pluginType'],
    summary: loadable.summary,
    topic,
  }

  return Object.freeze(info)
}

// ─── Argv builder ────────────────────────────────────────────────────────────

function buildArgv(loadable: Command.Loadable, args: Record<string, unknown>): string[] {
  const argv: string[] = []

  for (const name of Object.keys(loadable.args ?? {})) {
    const value = args[name]
    if (value !== undefined && value !== null) argv.push(String(value))
  }

  for (const [name, flag] of Object.entries(loadable.flags ?? {})) {
    if (name === 'json') continue
    const value = args[name]
    if (value === undefined || value === null) continue

    const f = flag as {type: string}
    if (f.type === 'boolean') {
      if (value === true) argv.push(`--${name}`)
    } else if (Array.isArray(value)) {
      for (const v of value) argv.push(`--${name}`, String(v))
    } else {
      argv.push(`--${name}`, String(value))
    }
  }

  return argv
}

// ─── Command resolution ─────────────────────────────────────────────────────

function resolveCommand(config: Config, id: string): Command.Loadable | undefined {
  const colonId = id.replaceAll(' ', ':')
  return config.commands.find((c) => c.id === colonId)
}

// ─── Execution ───────────────────────────────────────────────────────────────

async function executeCommand(loadable: Command.Loadable, argv: string[], config: Config): Promise<RunCommandResult> {
  try {
    const CmdClass = await loadable.load()
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const instance = new (CmdClass as any)(argv, config) as Command

    const lines: string[] = []
    instance.log = (msg = '') => {
      lines.push(String(msg))
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ;(instance as any).logJson = (json: unknown) => {
      lines.push(JSON.stringify(json, null, 2))
    }

    instance.warn = (msg: Error | string) => {
      lines.push(`Warning: ${String(msg)}`)
      return String(msg)
    }

    const result = await instance.run()
    const output = result === null || result === undefined ? lines.join('\n') : JSON.stringify(result, null, 2)
    return {output: output || '(no output)'}
  } catch (error) {
    return {error: error instanceof Error ? error.message : String(error), output: ''}
  }
}

// ─── Public surface ──────────────────────────────────────────────────────────

export const sdkck = {
  commands: {
    async list(config: Config, opts: ListCommandsOptions = {}): Promise<readonly CommandInfo[]> {
      const permissionConfig = await readPermissionConfig(config.configDir)
      const separator = config.topicSeparator ?? ' '

      const candidates = opts.topic
        ? config.commands.filter((l) => l.id.startsWith(`${opts.topic}:`) || l.id === opts.topic)
        : config.commands

      const results: CommandInfo[] = []
      for (const loadable of candidates) {
        const info = toCommandInfo(loadable, config, separator, permissionConfig)
        if (!opts.includeHidden && info.hidden) continue
        if (!opts.includeDisallowed && !info.isPermitted) continue
        results.push(info)
      }

      results.sort((a, b) => a.displayId.localeCompare(b.displayId))
      return Object.freeze(results)
    },

    async run(config: Config, id: string, args: Record<string, unknown> = {}): Promise<RunCommandResult> {
      const loadable = resolveCommand(config, id)
      if (!loadable) {
        throw new SdkckExecutionError('command_not_found', id, `Command "${id}" not found.`)
      }

      const permissionConfig = await readPermissionConfig(config.configDir)
      const separator = config.topicSeparator ?? ' '
      const normalizedForPermission = loadable.id.replaceAll(':', separator)
      if (!isCommandAllowed(normalizedForPermission, permissionConfig)) {
        throw new SdkckExecutionError(
          'permission_denied',
          loadable.id,
          `Command "${normalizedForPermission}" is blocked by the permission list.`,
        )
      }

      const argv = buildArgv(loadable, args)
      return executeCommand(loadable, argv, config)
    },
  },
} as const
