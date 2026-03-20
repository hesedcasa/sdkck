#!/usr/bin/env node

import {Config, flush, handle, run} from '@oclif/core'

import {registerOpenApiCommands} from '../dist/openapi-dynamic-commands.js'

const config = await Config.load(import.meta.url)
await registerOpenApiCommands(config)

await run(process.argv.slice(2), config).then(flush).catch(handle)
