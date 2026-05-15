import type {Command} from '@oclif/core'

// ─── Public types ────────────────────────────────────────────────────────────

export interface CommandArg {
  name: string
  required: boolean
  description?: string
}

export interface CommandFlag {
  name: string
  type: 'boolean' | 'option'
  required: boolean
  multiple: boolean
  description?: string
}

export interface CommandInfo {
  id: string
  displayId: string
  summary?: string
  description?: string
  hidden: boolean
  pluginName?: string
  pluginType?: 'core' | 'user' | 'link' | 'jit'
  isDynamic: boolean
  isPermitted: boolean
  isSensitive: boolean
  args: CommandArg[]
  flags: CommandFlag[]
  aliases: string[]
  topic?: string
}

export interface ListCommandsOptions {
  includeHidden?: boolean
  includeDisallowed?: boolean
  includeSensitive?: boolean
  topic?: string
}

export interface RunCommandOptions {
  allowSensitive?: boolean
  allowDisallowed?: boolean
}

export interface RunCommandResult {
  output: string
  error?: string
}

export type SdkckExecutionDenialCode = 'permission_denied' | 'sensitive_denied' | 'command_not_found'

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
  CmdClass: {sensitive?: boolean} | typeof Command,
): boolean {
  const explicit = (CmdClass as {sensitive?: boolean}).sensitive
  if (typeof explicit === 'boolean') return explicit

  for (const segment of commandId.split(':')) {
    if (SENSITIVE_SEGMENTS.has(segment.toLowerCase())) return true
  }

  return false
}
