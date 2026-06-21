#!/usr/bin/env -S node --loader ts-node/esm --disable-warning=ExperimentalWarning

import {registerApiCommands} from '@hesed/api2cli'
import {Config, flush, handle, run, settings} from '@oclif/core'

process.env.NODE_ENV = 'development'
settings.debug = true

// @hesed/mcp-client is a JIT plugin, so it may not be installed yet. Import it
// lazily and ignore a missing module so the CLI still starts; its dynamic
// commands register once the plugin has been auto-installed on first use.
async function registerMcpClientCommands(config) {
  try {
    // eslint-disable-next-line import/no-unresolved -- JIT plugin, may not be installed
    const {registerMcpClientCommands: register} = await import('@hesed/mcp-client')
    await register(config)
  } catch {
    // plugin not installed yet, or registration failed — skip silently
  }
}

// Patch Config.load so every config instance (including those created inside
// Command.run) automatically gets the dynamic API commands registered.
// This also ensures commands are present when normalizeArgv() parses argv.
const originalLoad = Config.load.bind(Config)
Config.load = async (...args) => {
  const config = await originalLoad(...args)
  await registerApiCommands(config).catch(() => {})
  await registerMcpClientCommands(config)
  return config
}

await run(process.argv.slice(2), import.meta.url)
  .then(flush)
  .catch(handle)
