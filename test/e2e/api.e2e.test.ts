import {expect} from 'chai'

import {requireApiEnv} from './fixtures.js'
import {createConfigDir, removeConfigDir, runSdkck, runSdkckJson, runSdkckOk} from './helpers.js'

/** Where the three live APIs live. Mirrors the user-facing import commands. */
const LINEAR_GRAPHQL_URL = 'https://api.linear.app/graphql'
const LINEAR_SCHEMA_URL =
  'https://raw.githubusercontent.com/linear/linear/refs/heads/master/packages/sdk/src/schema.graphql'
const VERCEL_SPEC_URL = 'https://openapi.vercel.sh/'
const CONTEXT7_SPEC_URL = 'https://raw.githubusercontent.com/upstash/context7/refs/heads/master/docs/openapi.json'

/**
 * The api leg: the local `@hesed/api2cli` build, installed over the npm-pinned
 * one, importing the three live API specs and calling them with real keys
 * through the sdkck host binary.
 *
 * Unlike every other leg this plugin ships with the host as a package.json
 * dependency; installing the packed local build into the throwaway home is
 * what puts the code under test on the other end of the commands.
 */
describe('e2e: api plugin via sdkck', () => {
  let configDir: string

  before(async function (this: Mocha.Context) {
    // Each import hits the network for the spec (the Linear SDL alone is
    // several MB) and converts it, so the hooks get a generous timeout.
    this.timeout(600_000)
    const {context7, linear, vercel} = requireApiEnv()
    configDir = await createConfigDir('api')

    await runSdkckOk(
      ['api', 'import', LINEAR_SCHEMA_URL, '--name', 'linear', '--base-url', LINEAR_GRAPHQL_URL],
      configDir,
    )
    await runSdkckOk(['api', 'import', VERCEL_SPEC_URL, '--name', 'vercel'], configDir)
    await runSdkckOk(['api', 'import', CONTEXT7_SPEC_URL, '--name', 'context7'], configDir)

    await runSdkckOk(
      ['api', 'auth', 'add', 'linear', '--type', 'apikey', '--api-key', linear, '--api-key-header', 'Authorization'],
      configDir,
    )
    await runSdkckOk(['api', 'auth', 'add', 'vercel', '--type', 'bearer', '--token', vercel], configDir)
    await runSdkckOk(['api', 'auth', 'add', 'context7', '--type', 'bearer', '--token', context7], configDir)
  })

  after(async () => {
    await removeConfigDir(configDir)
  })

  it('shows all three imported specs', async () => {
    const {stdout} = await runSdkckOk(['api', 'list'], configDir)
    expect(stdout).to.contain('linear [graphql]')
    expect(stdout).to.contain('vercel:')
    expect(stdout).to.contain('context7:')
  })

  it('calls Linear through the host', async () => {
    const linear = await runSdkckJson<{data: {viewer: {email: string; id: string}}}>(
      ['api', 'call', 'linear', 'viewer'],
      configDir,
    )
    expect(linear.data.viewer.id).to.be.a('string').and.to.have.lengthOf.at.least(8)
  })

  it('calls Vercel through the host', async () => {
    const vercel = await runSdkckJson<{user: {id: string; username: string}}>(
      ['api', 'call', 'vercel', 'getAuthUser'],
      configDir,
    )
    expect(vercel.user.username).to.be.a('string').and.to.have.lengthOf.at.least(1)
  })

  it('calls Context7 through the host', async () => {
    // `api call` takes no positional parameters — required query params go
    // through the repeatable --param flag.
    const context7 = await runSdkckJson<{results: Array<{id: string}>}>(
      ['api', 'call', 'context7', 'searchLibraries', '--param', 'libraryName=react', '--param', 'query=hooks'],
      configDir,
    )
    expect(context7.results).to.be.an('array').with.lengthOf.at.least(1)
  })

  // `spec operationId` is the space-separated dynamic command form the host
  // registers at startup; it must reach the same command as `api call`.
  it('resolves the space-separated dynamic command form', async () => {
    const {code} = await runSdkck(['linear', 'viewer'], configDir)
    expect(code).to.equal(0)
  })

  it('removes an imported spec', async () => {
    const {code} = await runSdkck(['api', 'remove', 'context7'], configDir)
    expect(code).to.equal(0)

    const {stdout} = await runSdkckOk(['api', 'list'], configDir)
    expect(stdout).to.not.contain('context7')
  })
})
