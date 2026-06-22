#!/usr/bin/env node

import {registerApiCommands} from '@hesed/api2cli'
import {Config, flush, handle, run} from '@oclif/core'

// @hesed/mcp-client is a JIT plugin, so it may not be installed yet. Import it
// lazily and ignore a missing module so the CLI still starts; its dynamic
// commands register once the plugin has been auto-installed on first use.
async function registerMcpClientCommands(config) {
  try {
    // JIT plugins are installed under config.dataDir, not the project's node_modules,
    // so we must resolve the absolute path rather than using a bare package specifier.
    const pluginPath = new URL('node_modules/@hesed/mcp-client/dist/index.js', `file://${config.dataDir}/`).href
    const {registerMcpClientCommands: register} = await import(pluginPath)
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
