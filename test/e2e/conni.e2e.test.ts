import {expect} from 'chai'

import {E2E_SPACE, purgeConfluencePage, RUN_ID, RUN_LABEL, SHARED_LABEL} from './fixtures.js'
import {createConfigDir, eventually, removeConfigDir, runSdkck, runSdkckJson} from './helpers.js'

type PagePayload = {data: {id: string; title: string}; success: boolean}
type SearchResults = {data: {results: Array<{id: string}>}; success: boolean}

/**
 * The conni leg: the local `@hesed/conni` build, installed into the throwaway
 * home, driving the shared Atlassian sandbox's Confluence through the sdkck
 * host binary.
 *
 * Its four template pages are not in the CQL index, so a CQL search scoped to
 * the space only ever sees content the suites created. Cleanup goes through
 * the REST oracle in fixtures.ts, never the CLI under test.
 */
describe('e2e: conni plugin via sdkck', () => {
  let configDir: string
  let pageId: string | undefined
  const title = `[e2e-host ${RUN_ID}] lifecycle`

  before(async () => {
    configDir = await createConfigDir('conni')
  })

  after(async () => {
    try {
      // The CLI delete only moves a page to the trash; this purges it for
      // good, and works even when the CLI under test is what broke.
      if (pageId) await purgeConfluencePage(pageId)
    } finally {
      await removeConfigDir(configDir)
    }
  })

  it('authenticates with the default profile', async () => {
    const {code, stderr} = await runSdkck(['conni', 'auth', 'test'], configDir)
    expect(code).to.equal(0)
    expect(stderr).to.contain('successful')
  })

  it('fails auth test with a broken profile', async () => {
    const {code} = await runSdkck(['conni', 'auth', 'test', '-p', 'broken'], configDir)
    expect(code).to.equal(2)
  })

  it('lists spaces', async () => {
    const payload = await runSdkckJson<{data: Array<{key: string}>; success: boolean}>(
      ['conni', 'space', 'list'],
      configDir,
    )
    expect(payload.success).to.be.true
    expect(payload.data).to.be.an('array')
    expect(payload.data.map((space) => space.key)).to.include(E2E_SPACE)
  })

  it('creates, labels, updates, searches and deletes a page', async () => {
    const created = await runSdkckJson<PagePayload>(
      [
        'conni',
        'content',
        'create',
        '--fields',
        `spaceKey=${E2E_SPACE}`,
        '--fields',
        `title=${title}`,
        '--fields',
        'body=original body',
      ],
      configDir,
    )
    expect(created.success).to.be.true
    expect(created.data.title).to.equal(title)
    pageId = created.data.id

    // Both labels — the shared one is what the stale sweep reclaims by; the
    // run one is what this run's cleanup targets. The search below scopes by
    // label, not title: the plugin repo's own suite pins title~ searches
    // through the eventually-consistent CQL index as pure flake, while
    // label= matches stably.
    const labeled = await runSdkckJson<PagePayload>(
      ['conni', 'content', 'label', pageId, `${SHARED_LABEL},${RUN_LABEL}`],
      configDir,
    )
    expect(labeled.success).to.be.true

    const {code} = await runSdkck(
      ['conni', 'content', 'update', pageId, '--fields', `title=${title} (updated)`],
      configDir,
    )
    expect(code).to.equal(0)

    const payload = await eventually(
      'the labeled page to appear in CQL search',
      () =>
        runSdkckJson<SearchResults>(
          ['conni', 'content', 'search', `space="${E2E_SPACE}" AND label="${RUN_LABEL}"`],
          configDir,
        ),
      (result) => result.data.results.some((page) => page.id === pageId),
    )
    expect(payload.success).to.be.true

    const {code: deleteCode} = await runSdkck(['conni', 'content', 'delete', pageId], configDir)
    expect(deleteCode).to.equal(0)
  })
})
