#!/usr/bin/env -S node --loader ts-node/esm --disable-warning=ExperimentalWarning

import {Config, flush, handle, run, settings} from '@oclif/core'

// eslint-disable-next-line n/no-unpublished-import
import {registerOpenApiCommands} from '../src/openapi-dynamic-commands.js'

process.env.NODE_ENV = 'development'
settings.debug = true

// Patch Config.load so every config instance (including those created inside
// Command.run) automatically gets the dynamic OpenAPI commands registered.
// This also ensures commands are present when normalizeArgv() parses argv.
const originalLoad = Config.load.bind(Config)
Config.load = async (...args) => {
  const config = await originalLoad(...args)
  await registerOpenApiCommands(config).catch(() => {})
  return config
}

await run(process.argv.slice(2), import.meta.url)
  .then(flush)
  .catch(handle)
