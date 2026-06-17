export interface FlagMeta {
  char?: string
  default?: unknown
  description?: string
  multiple: boolean
  name: string
  options?: string[]
  required: boolean
  type: 'boolean' | 'option'
}

export interface ArgMeta {
  default?: unknown
  description?: string
  name: string
  options?: string[]
  required: boolean
}

export interface CommandMeta {
  aliases: string[]
  args: ArgMeta[]
  description?: string
  flags: FlagMeta[]
  id: string
  pluginName?: string
  pluginType?: string
  summary?: string
  usage?: string | string[]
}

export interface CommandsResponse {
  bin: string
  commands: CommandMeta[]
  version: string
}

export interface RunResult {
  durationMs: number
  error?: string
  output: string
  success: boolean
}

/** Build an oclif-style argv array from form values for a command. */
export function buildArgv(
  command: CommandMeta,
  argValues: Record<string, string>,
  flagValues: Record<string, boolean | string>,
): string[] {
  const argv: string[] = []

  for (const arg of command.args) {
    const value = argValues[arg.name]
    if (value !== undefined && value !== '') argv.push(value)
  }

  for (const flag of command.flags) {
    const value = flagValues[flag.name]
    if (flag.type === 'boolean') {
      if (value === true) argv.push(`--${flag.name}`)
    } else if (typeof value === 'string' && value !== '') {
      if (flag.multiple) {
        for (const part of value.split(',').map((s) => s.trim()).filter(Boolean)) {
          argv.push(`--${flag.name}`, part)
        }
      } else {
        argv.push(`--${flag.name}`, value)
      }
    }
  }

  return argv
}
