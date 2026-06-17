#!/usr/bin/env -S node --loader ts-node/esm --disable-warning=ExperimentalWarning

import {execute} from '@oclif/core'

process.env.NODE_ENV = 'development'

await execute({development: true, dir: import.meta.url})
