#!/usr/bin/env -S node --loader ts-node/esm --disable-warning=ExperimentalWarning

import {Config, flush, handle, run, settings} from '@oclif/core'

// eslint-disable-next-line n/no-unpublished-import
import {registerOpenApiCommands} from '../src/openapi-dynamic-commands.js'

process.env.NODE_ENV = 'development'
settings.debug = true

const config = await Config.load(import.meta.url)
await registerOpenApiCommands(config)

await run(process.argv.slice(2), config).then(flush).catch(handle)
