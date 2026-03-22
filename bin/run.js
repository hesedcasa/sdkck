#!/usr/bin/env node

import {Config, flush, handle, run} from '@oclif/core'

import {registerOpenApiCommands} from '../dist/openapi-dynamic-commands.js'

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
