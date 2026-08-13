import {Errors, type Hook} from '@oclif/core'

const hook: Hook<'jit_plugin_not_installed'> = async function (opts) {
  try {
    await opts.config.runCommand('plugins:install', [`${opts.command.pluginName}@${opts.pluginVersion}`])
  } catch (error: unknown) {
    throw new Errors.CLIError(
      `Could not install ${opts.command.pluginName}: ${error instanceof Error ? error.message : String(error)}`,
    )
  }
}

export default hook
