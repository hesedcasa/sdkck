import {expect} from 'chai'
import path from 'node:path'
import {fileURLToPath} from 'node:url'

import {createConfigDir, removeConfigDir, runSdkck, runSdkckJson, runSdkckOk} from './helpers.js'

/** The dependency-free stdio MCP server the leg connects to. */
const FIXTURE_SERVER = path.join(path.dirname(fileURLToPath(import.meta.url)), 'mcp-fixture-server.mjs')

/** Name the fixture server is registered under — and so the tools' topic. */
const SERVER = 'e2efix'

/**
 * The mcp-client leg: `@hesed/mcp-client` registering a local stdio MCP
 * server's tools as dynamic sdkck commands.
 *
 * The code under test is mostly the host's: bin/run.js registers the cached
 * tools on every Config it loads, and they must stay visible to `commands`
 * and `search` — plugins that rebuild the config through their own
 * `@oclif/core` copy (the 0.37.0 regression this leg was added for). No
 * credentials and no network beyond the plugin install.
 */
describe('e2e: mcp-client plugin via sdkck', () => {
  let configDir: string

  before(async function (this: Mocha.Context) {
    this.timeout(300_000)
    configDir = await createConfigDir('mcp-client')
    await runSdkckOk(['mcp', 'client', 'add', SERVER, '--command', process.execPath, '--args', FIXTURE_SERVER], configDir)
  })

  after(async () => {
    await removeConfigDir(configDir)
  })

  it('lists the server in `mcp client list`', async () => {
    const {stdout} = await runSdkckOk(['mcp', 'client', 'list', '--tools'], configDir)
    expect(stdout).to.contain(SERVER)
    expect(stdout).to.contain('echo')
  })

  it('lists the tool commands in `sdkck commands`', async () => {
    const commands = await runSdkckJson<Array<{id: string}>>(['commands', '--json'], configDir)
    expect(commands.map((c) => c.id)).to.include.members([`${SERVER}:echo`, `${SERVER}:ping`])
  })

  it('finds the tool commands with `sdkck search`', async () => {
    const results = await runSdkckJson<Array<{commandId: string}>>(['search', 'echo', '--json'], configDir)
    expect(results.map((r) => r.commandId)).to.include(`${SERVER} echo`)
  })

  it('runs a tool as a dynamic command', async () => {
    const {stdout} = await runSdkckOk([SERVER, 'echo', '--message', 'hello from e2e'], configDir)
    expect(stdout).to.contain('hello from e2e')
  })

  it('drops the tool commands once the server is removed', async () => {
    const {code} = await runSdkck(['mcp', 'client', 'remove', SERVER], configDir)
    expect(code).to.equal(0)

    const commands = await runSdkckJson<Array<{id: string}>>(['commands', '--json'], configDir)
    expect(commands.map((c) => c.id)).to.not.include(`${SERVER}:echo`)
  })
})
