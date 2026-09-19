import {expect} from 'chai'

import {
  deleteJiraIssue,
  E2E_PROJECT,
  findJiraByLabel,
  jiraIssueHttpStatus,
  RUN_ID,
  RUN_LABEL,
  seedJiraIssue,
  SHARED_LABEL,
} from './fixtures.js'
import {createConfigDir, eventually, removeConfigDir, runSdkck, runSdkckJson} from './helpers.js'

type Created = {data: {id: number; key: string}; success: boolean}
type Fetched = {data: {fields: {summary: string}; key: string}; success: boolean}
type Searched = {data: {issues: Array<{key: string}>}; success: boolean}

/** Both labels, as the JSON array `--fields labels=` takes. */
const LABELS = JSON.stringify([SHARED_LABEL, RUN_LABEL])

/**
 * The jira leg: the local `@hesed/jira` build, installed into the throwaway
 * home, driving the shared Atlassian sandbox through the sdkck host binary.
 *
 * This is a host-integration slice, not the plugin's own exhaustive suite —
 * one connection proof, one read, one write lifecycle, one oracle check.
 * Cleanup goes through the REST oracle in fixtures.ts, never the CLI under
 * test: cleanup that shares the CLI's code path fails exactly when the CLI is
 * broken, which is when it matters most.
 */
describe('e2e: jira plugin via sdkck', () => {
  let configDir: string
  const createdKeys: string[] = []

  before(async () => {
    configDir = await createConfigDir('jira')
  })

  after(async () => {
    try {
      await Promise.allSettled(createdKeys.map((key) => deleteJiraIssue(key)))
    } finally {
      await removeConfigDir(configDir)
    }
  })

  it('authenticates with the default profile', async () => {
    const {code, stderr} = await runSdkck(['jira', 'auth', 'test'], configDir)
    expect(code).to.equal(0)
    expect(stderr).to.contain('successful')
  })

  it('fails auth test with a broken profile', async () => {
    const {code} = await runSdkck(['jira', 'auth', 'test', '--profile', 'broken'], configDir)
    expect(code).to.equal(2)
  })

  it('lists projects', async () => {
    const payload = await runSdkckJson<{data: Array<{key: string}>}>(['jira', 'project', 'list'], configDir)
    expect(payload.data).to.be.an('array')
    expect(payload.data.map((project) => project.key)).to.include(E2E_PROJECT)
  })

  it('runs a JQL search', async () => {
    const payload = await runSdkckJson<Searched>(
      ['jira', 'issue', 'search', `project = ${E2E_PROJECT} ORDER BY created DESC`],
      configDir,
    )
    expect(payload.success).to.be.true
    expect(payload.data.issues).to.be.an('array')
  })

  it('creates, reads and deletes an issue', async () => {
    const summary = `[e2e-host ${RUN_ID}] lifecycle`
    const created = await runSdkckJson<Created>(
      [
        'jira',
        'issue',
        'create',
        '--fields',
        `project={"key":"${E2E_PROJECT}"}`,
        '--fields',
        'issuetype={"name":"Task"}',
        '--fields',
        `summary=${summary}`,
        '--fields',
        'description=created by the sdkck host e2e suite',
        '--fields',
        `labels=${LABELS}`,
      ],
      configDir,
    )
    expect(created.success).to.be.true
    expect(created.data.key.startsWith('SS-'), `unexpected key: ${created.data.key}`).to.be.true
    createdKeys.push(created.data.key)

    const fetched = await runSdkckJson<Fetched>(['jira', 'issue', created.data.key], configDir)
    expect(fetched.data.fields.summary).to.equal(summary)

    // Jira's search index is asynchronous, so the search assertion is polled.
    // Selection is by exact label, never `summary ~` — JQL's `~` is a
    // tokenized match that drops punctuation.
    const searched = await eventually(
      'the created issue to appear in JQL search',
      () => runSdkckJson<Searched>(['jira', 'issue', 'search', `labels = "${RUN_LABEL}"`], configDir),
      (result) => result.data.issues.some((issue) => issue.key === created.data.key),
    )
    expect(searched.data.issues.map((issue) => issue.key)).to.include(created.data.key)

    const {code} = await runSdkck(['jira', 'issue', 'delete', created.data.key], configDir)
    expect(code).to.equal(0)
    createdKeys.pop()

    // After the delete the issue is gone. Unlike the conni plugin, whose
    // API failures ride on exit 0, the jira plugin surfaces them as a
    // non-zero exit with a structured error body — asserted through the CLI
    // (the behavior under test), then confirmed gone through the REST oracle,
    // which is not subject to the search index's lag.
    const after = await runSdkck(['jira', 'issue', created.data.key], configDir)
    expect(after.code).to.not.equal(0)
    expect(await jiraIssueHttpStatus(created.data.key)).to.equal(404)
  })

  // The fixture oracle itself: seed through REST, find by run label, delete,
  // confirm gone — if this breaks, every other jira test fails for the wrong
  // reason.
  it('seeds a fixture that the REST oracle can find and reclaim', async () => {
    const key = await seedJiraIssue()
    expect(key.startsWith('SS-'), `unexpected key: ${key}`).to.be.true

    const found = await eventually(
      'the seeded issue to appear in JQL search',
      () => findJiraByLabel(RUN_LABEL),
      (keys) => keys.includes(key),
    )
    expect(found).to.include(key)

    await deleteJiraIssue(key)
    // Tolerating a double delete is what lets cleanup hooks run unguarded.
    await deleteJiraIssue(key)
    expect(await jiraIssueHttpStatus(key), `${key} should be gone`).to.equal(404)
  })
})
