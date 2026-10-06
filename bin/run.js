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

// registerApiCommands and registerMcpClientCommands insert straight into the
// config's private command map, so the commands exist only on that one Config
// instance. A command built against a different @oclif/core copy than the CLI's
// own (e.g. @oclif/plugin-commands and @hesed/search, still on core 4) receives
// a foreign config and rebuilds it through *its* copy's Config.load — reusing
// the plugin instances but bypassing the patch below — so `commands` and
// `search` came up without any dynamic command. Mirroring the dynamic commands
// onto the root plugin, whose instance every such reload reuses, carries them
// into the rebuilt config too.
function persistDynamicCommands(config) {
  const owned = new Set(config.getPluginsList().flatMap((p) => p.commands.flatMap((c) => [c.id, ...(c.aliases ?? [])])))
  config.rootPlugin.commands.push(...config.commands.filter((c) => !owned.has(c.id)))
}

// Patch Config.load so every config instance (including those created inside
// Command.run) automatically gets the dynamic API commands registered.
// This also ensures commands are present when normalizeArgv() parses argv.
const originalLoad = Config.load.bind(Config)
Config.load = async (...args) => {
  const config = await originalLoad(...args)
  await registerApiCommands(config).catch(() => {})
  await registerMcpClientCommands(config)
  persistDynamicCommands(config)
  return config
}

// run() resolves with the command's return value; don't pass it to flush(),
// which would treat it as the timeout in ms (NaN → TimeoutNaNWarning).
await run(process.argv.slice(2), import.meta.url)
  .then(() => flush())
  .catch(handle)
