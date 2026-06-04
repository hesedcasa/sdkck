#!/usr/bin/env -S node --loader ts-node/esm --disable-warning=ExperimentalWarning

import {registerApiCommands} from '@hesed/api2cli'
import {registerMcpClientCommands} from '@hesed/mcp-client'
import {Config, flush, handle, run, settings} from '@oclif/core'

process.env.NODE_ENV = 'development'
settings.debug = true

// Patch Config.load so every config instance (including those created inside
// Command.run) automatically gets the dynamic API commands registered.
// This also ensures commands are present when normalizeArgv() parses argv.
const originalLoad = Config.load.bind(Config)
Config.load = async (...args) => {
  const config = await originalLoad(...args)
  await registerApiCommands(config).catch(() => {})
  await registerMcpClientCommands(config).catch(() => {})
  return config
}

await run(process.argv.slice(2), import.meta.url)
  .then(flush)
  .catch(handle)
