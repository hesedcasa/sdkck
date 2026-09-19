import {expect} from 'chai'

import {deleteBbRepo, requireBitbucketEnv, RUN_ID, RUN_LABEL} from './fixtures.js'
import {createConfigDir, removeConfigDir, runSdkck, runSdkckJson} from './helpers.js'

type Paged<T> = {size: number; values: T[]}

/**
 * The bb leg: the local `@hesed/bb` build, installed into the throwaway home,
 * driving the shared Bitbucket sandbox through the sdkck host binary.
 *
 * Cleanup goes through the REST oracle in fixtures.ts, never the CLI under
 * test: cleanup that shares the CLI's code path fails exactly when the CLI is
 * broken, which is when it matters most.
 */
describe('e2e: bb plugin via sdkck', () => {
  let configDir: string
  let workspace: string
  let slug: string

  before(async () => {
    workspace = requireBitbucketEnv().workspace
    // The slug doubles as the run's fixture name: `name="slug"` is what both
    // this run's cleanup and the sweep key on.
    slug = RUN_LABEL
    configDir = await createConfigDir('bb')
  })

  after(async () => {
    try {
      // Tolerates a repo already gone (204/404 are both success).
      await deleteBbRepo(slug)
    } finally {
      await removeConfigDir(configDir)
    }
  })

  it('authenticates with the default profile', async () => {
    const {code, stderr} = await runSdkck(['bb', 'auth', 'test'], configDir)
    expect(code).to.equal(0)
    expect(stderr).to.contain('successful')
  })

  it('fails auth test with a broken profile', async () => {
    const {code} = await runSdkck(['bb', 'auth', 'test', '--profile', 'broken'], configDir)
    expect(code).to.equal(2)
  })

  it('gets the sandbox workspace', async () => {
    const payload = await runSdkckJson<{data: {slug: string}; success: boolean}>(
      ['bb', 'workspace', workspace],
      configDir,
    )
    expect(payload.success).to.be.true
    expect(payload.data.slug).to.equal(workspace)
  })

  it('creates, reads and deletes a repo', async () => {
    const created = await runSdkckJson<{data: {full_name: string; is_private: boolean}; success: boolean}>(
      ['bb', 'repo', 'create', workspace, slug, '--private', '--description', `[e2e-host ${RUN_ID}] lifecycle`],
      configDir,
    )
    expect(created.success).to.be.true
    expect(created.data.full_name).to.equal(`${workspace}/${slug}`)
    expect(created.data.is_private).to.be.true

    const fetched = await runSdkckJson<{data: {full_name: string}; success: boolean}>(
      ['bb', 'repo', workspace, slug],
      configDir,
    )
    expect(fetched.data.full_name).to.equal(`${workspace}/${slug}`)

    const prs = await runSdkckJson<{data: Paged<unknown>}>(['bb', 'pr', 'list', workspace, slug], configDir)
    expect(prs.data.size).to.equal(0)

    const {code} = await runSdkck(['bb', 'repo', 'delete', workspace, slug], configDir)
    expect(code).to.equal(0)

    const gone = await runSdkckJson<{data: unknown; success: boolean}>(['bb', 'repo', workspace, slug], configDir)
    expect(gone.success).to.be.false
  })
})
