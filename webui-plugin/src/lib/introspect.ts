import type {Command, Config} from '@oclif/core'

/**
 * Serializable description of a single command flag, suitable for rendering a
 * form control in the web UI.
 */
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

/** Serializable description of a positional argument. */
export interface ArgMeta {
  default?: unknown
  description?: string
  name: string
  options?: string[]
  required: boolean
}

/** Serializable description of a command, sent to the browser as JSON. */
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

function flagToMeta(name: string, flag: Command.Flag.Cached): FlagMeta {
  const isBoolean = flag.type === 'boolean'
  return {
    char: flag.char,
    default: isBoolean ? undefined : (flag as {default?: unknown}).default,
    description: flag.summary ?? flag.description,
    multiple: !isBoolean && Boolean((flag as {multiple?: boolean}).multiple),
    name,
    options: isBoolean ? undefined : (flag as {options?: string[]}).options,
    required: Boolean(flag.required),
    type: isBoolean ? 'boolean' : 'option',
  }
}

function argToMeta(name: string, arg: Command.Arg.Cached): ArgMeta {
  return {
    default: (arg as {default?: unknown}).default,
    description: arg.description,
    name,
    options: (arg as {options?: string[]}).options,
    required: Boolean(arg.required),
  }
}

/**
 * Build a serializable list of every visible command known to the oclif
 * {@link Config}, including dynamically registered ones.
 */
export function describeCommands(config: Config): CommandMeta[] {
  return config.commands
    .filter((cmd) => !cmd.hidden)
    .map((cmd) => ({
      aliases: cmd.aliases ?? [],
      args: Object.entries(cmd.args ?? {}).map(([name, arg]) => argToMeta(name, arg as Command.Arg.Cached)),
      description: cmd.description,
      flags: Object.entries(cmd.flags ?? {})
        .filter(([, flag]) => !(flag as {hidden?: boolean}).hidden)
        .map(([name, flag]) => flagToMeta(name, flag as Command.Flag.Cached)),
      id: cmd.id,
      pluginName: cmd.pluginName,
      pluginType: cmd.pluginType,
      summary: cmd.summary,
      usage: cmd.usage,
    }))
    .sort((a, b) => a.id.localeCompare(b.id))
}
