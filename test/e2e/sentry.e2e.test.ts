import {expect} from 'chai'

import {resolveSentryOrg, sentryProjectSlugs} from './fixtures.js'
import {createConfigDir, removeConfigDir, runSdkck, runSdkckJson} from './helpers.js'

type IssuePayload = {data: unknown; success: boolean}

/**
 * The sentry leg: the local `@hesed/sentry` build, installed into the throwaway
 * home, reading the live Sentry organization through the sdkck host binary.
 *
 * Read-only by design — the plugin's own repo owns the issue-lifecycle
 * coverage against disposable sandbox projects; this leg proves the plugin
 * loads into the host and round-trips the real API.
 */
describe('e2e: sentry plugin via sdkck', () => {
  let configDir: string

  before(async () => {
    // Validates the token`/host` early and caches the org for createConfigDir().
    await resolveSentryOrg()
    configDir = await createConfigDir('sentry')
  })

  after(async () => {
    await removeConfigDir(configDir)
  })

  it('authenticates with the default profile', async () => {
    const {code} = await runSdkck(['sentry', 'auth', 'test'], configDir)
    expect(code).to.equal(0)
  })

  it('fails auth test on a bad API token', async () => {
    const {code} = await runSdkck(['sentry', 'auth', 'test', '--profile', 'broken'], configDir)
    expect(code).to.equal(2)
  })

  it('errors on an unknown profile rather than falling back to the default', async () => {
    const {code, stdout} = await runSdkck(['sentry', 'org', '--profile', 'nosuch'], configDir)
    expect(code).to.equal(1)

    // Structured presence only: a payload carrying an error — instead of the
    // default profile's issue listing — is what proves there was no silent
    // fallback.
    const payload = JSON.parse(stdout) as {error?: unknown}
    expect(payload.error).to.be.a('string').that.is.not.empty
  })

  it('lists org issues', async () => {
    const payload = await runSdkckJson<IssuePayload>(['sentry', 'org'], configDir)
    expect(payload.success).to.be.true
    expect(payload.data).to.be.an('array')
  })

  it('lists project issues for an existing project', async function (this: Mocha.Context) {
    const slugs = await sentryProjectSlugs()
    if (slugs.length === 0) {
      this.skip()
    }

    const payload = await runSdkckJson<IssuePayload>(['sentry', 'project', 'issues', slugs[0]!], configDir)
    expect(payload.success).to.be.true
    expect(payload.data).to.be.an('array')
  })
})
