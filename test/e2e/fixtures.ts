import {Buffer} from 'node:buffer'
import {randomBytes} from 'node:crypto'

/**
 * One id per mocha process, so concurrent runs never collide in the shared
 * sandboxes.
 *
 * `E2E_RUN_ID` overrides it so a *separate* process can address this run's
 * fixtures by label or name — `scripts/e2e.sh` and the CI workflow both set
 * it, which is what lets their post-run sweep reclaim fixtures a killed mocha
 * never got to clean up.
 */
export const RUN_ID = process.env.E2E_RUN_ID || randomBytes(4).toString('hex')
/** Carried by every fixture ever created, so a crashed run can be reclaimed later. */
export const SHARED_LABEL = 'e2e-host'
/** Carried by this run's fixtures only, for exact-run cleanup. */
export const RUN_LABEL = `e2e-host-${RUN_ID}`

/** The Jira project and Confluence space the sibling plugins' suites own. */
export const E2E_PROJECT = 'SS'
export const E2E_SPACE = 'Sidekick'

// ─── Environment ─────────────────────────────────────────────────────────────

function requireVars(names: string[], context: string): Record<string, string> {
  const missing = names.filter((name) => !process.env[name])
  if (missing.length > 0) {
    throw new Error(
      `Missing ${missing.join(', ')} (needed by the ${context} e2e tests). ` +
        'scripts/e2e.sh loads .env automatically — check it has these keys, or narrow the run with E2E_PLUGINS.',
    )
  }

  return Object.fromEntries(names.map((name) => [name, process.env[name]!]))
}

function envSet(names: string[]): boolean {
  return names.every((name) => process.env[name])
}

/**
 * Reads the Atlassian sandbox credentials shared by the jira and conni legs.
 *
 * @returns The host, email and API token.
 */
export function requireAtlassianEnv(): {apiToken: string; email: string; host: string} {
  const vars = requireVars(['ATLASSIAN_URL', 'ATLASSIAN_EMAIL', 'ATLASSIAN_API_TOKEN'], 'jira/conni') as {
    ATLASSIAN_API_TOKEN: string
    ATLASSIAN_EMAIL: string
    ATLASSIAN_URL: string
  }
  return {
    apiToken: vars.ATLASSIAN_API_TOKEN,
    email: vars.ATLASSIAN_EMAIL,
    host: vars.ATLASSIAN_URL.endsWith('/') ? vars.ATLASSIAN_URL.slice(0, -1) : vars.ATLASSIAN_URL,
  }
}

/**
 * Reads the Bitbucket sandbox credentials.
 *
 * @returns The email, API token and fixture workspace slug.
 */
export function requireBitbucketEnv(): {apiToken: string; email: string; workspace: string} {
  const vars = requireVars(['BITBUCKET_API_TOKEN', 'BITBUCKET_EMAIL', 'E2E_WORKSPACE'], 'bb') as {
    BITBUCKET_API_TOKEN: string
    BITBUCKET_EMAIL: string
    E2E_WORKSPACE: string
  }
  return {apiToken: vars.BITBUCKET_API_TOKEN, email: vars.BITBUCKET_EMAIL, workspace: vars.E2E_WORKSPACE}
}

/**
 * Reads the Sentry sandbox credentials.
 *
 * The .env at the repo root names the API root `SENTRY_URL`; the sentry plugin
 * calls it `SENTRY_HOST` and expects the full API root, so a bare host gets
 * `/api/0` appended. SENTRY_HOST wins when both are set.
 *
 * @returns The API token and the Sentry API root.
 */
export function requireSentryEnv(): {apiToken: string; host: string} {
  const vars = requireVars(['SENTRY_API_KEY'], 'sentry') as {SENTRY_API_KEY: string}

  let host = process.env.SENTRY_HOST || process.env.SENTRY_URL || 'https://sentry.io/api/0'
  if (host.endsWith('/')) host = host.slice(0, -1)
  // A bare origin (no /api/0 path) is completed here, not in the plugin.
  if (!host.endsWith('/api/0')) host += '/api/0'
  return {apiToken: vars.SENTRY_API_KEY, host}
}

/**
 * Reads the Trello account credentials, throwing when incomplete.
 *
 * The API key is read from `TRELLO_API_KEY` with `RELLO_API_KEY` accepted as a
 * fallback — the .env at the repo root carries the shorter name. TRELLO_SECRET
 * holds the API token despite its name.
 *
 * @returns The API key and token.
 */
export function requireTrelloEnv(): {apiKey: string; apiToken: string} {
  const apiKey = process.env.TRELLO_API_KEY || process.env.RELLO_API_KEY
  const apiToken = process.env.TRELLO_SECRET
  if (!apiKey || !apiToken) {
    throw new Error(
      'Missing TRELLO_API_KEY (or RELLO_API_KEY) or TRELLO_SECRET. ' +
        'scripts/e2e.sh loads .env automatically — check it has these keys, or narrow the run with E2E_PLUGINS.',
    )
  }

  return {apiKey, apiToken}
}

/**
 * Reads the Docker MySQL server coordinates the script publishes.
 *
 * @returns The host and port.
 */
export function requireMysqlEnv(): {host: string; port: number} {
  const vars = requireVars(['MQ_E2E_PORT'], 'mysql') as {MQ_E2E_PORT: string}
  return {host: process.env.MQ_E2E_HOST || '127.0.0.1', port: Number(vars.MQ_E2E_PORT)}
}

/**
 * Reads the Docker PostgreSQL server coordinates the script publishes.
 *
 * @returns The host and port.
 */
export function requirePsqlEnv(): {host: string; port: number} {
  const vars = requireVars(['PG_E2E_PORT'], 'psql') as {PG_E2E_PORT: string}
  return {host: process.env.PG_E2E_HOST || '127.0.0.1', port: Number(vars.PG_E2E_PORT)}
}

/**
 * Reads the three live-API credentials the api leg drives.
 *
 * @returns The Linear, Vercel and Context7 keys.
 */
export function requireApiEnv(): {context7: string; linear: string; vercel: string} {
  const vars = requireVars(['LINEAR_API_KEY', 'VERCEL_API_KEY', 'CONTEXT7_API_KEY'], 'api') as {
    CONTEXT7_API_KEY: string
    LINEAR_API_KEY: string
    VERCEL_API_KEY: string
  }
  return {context7: vars.CONTEXT7_API_KEY, linear: vars.LINEAR_API_KEY, vercel: vars.VERCEL_API_KEY}
}

// ─── Atlassian REST (jira + conni share credentials and host) ────────────────

type AtlassianResponse = {body: unknown; status: number}

async function atlassianCall(method: string, endpoint: string, body?: unknown): Promise<AtlassianResponse> {
  const {apiToken, email, host} = requireAtlassianEnv()
  const authorization = `Basic ${Buffer.from(`${email}:${apiToken}`).toString('base64')}`

  const response = await fetch(host + endpoint, {
    body: body === undefined ? undefined : JSON.stringify(body),
    headers: {accept: 'application/json', authorization, 'content-type': 'application/json'},
    method,
  })

  const text = await response.text()
  const contentType = response.headers.get('content-type') ?? ''
  return {body: text && contentType.includes('application/json') ? JSON.parse(text) : null, status: response.status}
}

/**
 * Keys created by this process, as a fallback for `cleanupRun`.
 *
 * Jira's search index is asynchronous, so a JQL lookup alone can miss a
 * fixture created moments earlier and silently leave it behind.
 */
const createdJiraKeys = new Set<string>()

/**
 * Creates a fixture issue in the seeded project via the REST API directly.
 *
 * Fixtures are never created through the CLI: they are the oracle the CLI is
 * checked against, so they must not share its code path.
 *
 * @param overrides Extra or replacement issue fields.
 * @returns The created issue key.
 */
export async function seedJiraIssue(overrides: Record<string, unknown> = {}): Promise<string> {
  const {body, status} = await atlassianCall('POST', '/rest/api/3/issue', {
    fields: {
      issuetype: {name: 'Task'},
      labels: [SHARED_LABEL, RUN_LABEL],
      project: {key: E2E_PROJECT},
      summary: `[e2e-host ${RUN_ID}] fixture`,
      ...overrides,
    },
  })

  if (status !== 201) {
    throw new Error(`seedJiraIssue failed: ${status} ${JSON.stringify(body)}`)
  }

  const {key} = body as {key: string}
  createdJiraKeys.add(key)
  return key
}

/**
 * Deletes an issue, tolerating one that is already gone.
 *
 * Never goes through the CLI under test — cleanup that shares the CLI's code
 * path fails exactly when the CLI is broken, which is when it matters most.
 *
 * @param key The issue key.
 */
export async function deleteJiraIssue(key: string): Promise<void> {
  const {status} = await atlassianCall('DELETE', `/rest/api/3/issue/${key}`)
  if (status !== 204 && status !== 404) {
    throw new Error(`deleteJiraIssue ${key} failed: ${status}`)
  }

  createdJiraKeys.delete(key)
}

/**
 * Reads an issue's HTTP status straight from the REST API.
 *
 * An existence check that does not go through JQL, so it is not subject to
 * the search index's lag — 404 means gone, right now.
 *
 * @param key The issue key.
 * @returns The status code: 200 if the issue is there, 404 once it is gone.
 */
export async function jiraIssueHttpStatus(key: string): Promise<number> {
  const {status} = await atlassianCall('GET', `/rest/api/3/issue/${key}?fields=key`)
  return status
}

/**
 * Searches for issues carrying a label.
 *
 * Always scoped to E2E_PROJECT. Both `cleanupRun` and `sweepStale` are
 * destructive queries driven by ambient environment variables (a label and an
 * age cutoff) with no other guard, so scoping every lookup to the fixture
 * project here — structurally, once — bounds their blast radius to that one
 * project instead of every project the credentials can see.
 *
 * @param label The exact label to match.
 * @param extraJql Optional additional JQL, ANDed onto the label clause.
 * @returns The matching issue keys.
 */
export async function findJiraByLabel(label: string, extraJql = ''): Promise<string[]> {
  const jql = `project = "${E2E_PROJECT}" AND labels = "${label}"${extraJql ? ` AND ${extraJql}` : ''}`
  const keys: string[] = []
  let nextPageToken: string | undefined

  // Every page, not just the first: a caller that stopped at 100 would delete
  // one page of fixtures and report success, leaving the rest in the sandbox.
  do {
    // eslint-disable-next-line no-await-in-loop -- each page's request needs the previous page's token
    const {body, status} = await atlassianCall('POST', '/rest/api/3/search/jql', {
      fields: ['key'],
      jql,
      maxResults: 100,
      ...(nextPageToken && {nextPageToken}),
    })

    if (status !== 200) {
      throw new Error(`findJiraByLabel failed: ${status} ${JSON.stringify(body)}`)
    }

    const page = body as {issues?: Array<{key: string}>; nextPageToken?: string}
    keys.push(...(page.issues ?? []).map((issue) => issue.key))
    nextPageToken = page.nextPageToken
  } while (nextPageToken)

  return keys
}

/**
 * Deletes every issue in `keys`, tolerating individual failures until all
 * deletions have been attempted, then throwing if any actually failed.
 *
 * @param keys The issue keys to delete.
 */
async function deleteJiraAll(keys: string[]): Promise<void> {
  const results = await Promise.allSettled(keys.map((key) => deleteJiraIssue(key)))
  const failures = results.filter((result): result is PromiseRejectedResult => result.status === 'rejected')
  if (failures.length > 0) {
    throw new Error(
      `jira cleanup: ${failures.length}/${keys.length} deletion(s) failed: ${failures
        .map((failure) => String(failure.reason))
        .join('; ')}`,
    )
  }
}

/**
 * Searches Confluence for pages carrying a label, via CQL.
 *
 * Always scoped to E2E_SPACE, bounding every destructive caller's blast
 * radius structurally — the same reasoning as findJiraByLabel's project clause.
 *
 * @param label The exact label to match.
 * @param extraCql Optional additional CQL, ANDed onto the label clause.
 * @returns The matching page ids.
 */
export async function findConfluencePagesByLabel(label: string, extraCql = ''): Promise<string[]> {
  const cql = `space="${E2E_SPACE}" AND label="${label}"${extraCql ? ` AND ${extraCql}` : ''}`
  const ids: string[] = []
  let next: string | undefined

  do {
    const suffix = next ?? `/wiki/rest/api/content/search?limit=50&cql=${encodeURIComponent(cql)}`
    // eslint-disable-next-line no-await-in-loop -- cursor pagination needs the previous page's link
    const {body, status} = await atlassianCall('GET', suffix)
    if (status !== 200) {
      throw new Error(`findConfluencePagesByLabel failed: ${status} ${JSON.stringify(body)}`)
    }

    const page = body as {_links?: {next?: string}; results?: Array<{id: string}>}
    ids.push(...(page.results ?? []).map((result) => result.id))
    next = page._links?.next
  } while (next)

  return ids
}

/**
 * Purges a Confluence page from the sandbox, including from the trash.
 *
 * The CLI's `conni content delete` only moves a page to the trash, so this is
 * the backstop that keeps the shared space clean. Never goes through the CLI
 * under test.
 *
 * @param pageId The page to purge.
 */
export async function purgeConfluencePage(pageId: string): Promise<void> {
  const trashed = await atlassianCall('DELETE', `/wiki/rest/api/content/${pageId}`)
  if (trashed.status === 204 || trashed.status === 404) return

  // It existed, so it is now in the trash; a second delete purges for good.
  const purged = await atlassianCall('DELETE', `/wiki/rest/api/content/${pageId}?status=trashed`)
  if (purged.status !== 204 && purged.status !== 404) {
    throw new Error(`purgeConfluencePage ${pageId} failed: ${trashed.status}/${purged.status}`)
  }
}

// ─── Sentry REST (org discovery for config seeding) ─────────────────────────

let cachedSentryOrg: Promise<string> | undefined

/**
 * Resolves the Sentry organization the suite runs against, once per process.
 *
 * `SENTRY_ORG` pins it explicitly; without it, exactly one organization must
 * be visible to the token — guessing among many would let the suite read the
 * wrong org.
 *
 * @returns The organization slug.
 */
export function resolveSentryOrg(): Promise<string> {
  cachedSentryOrg ??= discoverSentryOrg()
  return cachedSentryOrg
}

async function discoverSentryOrg(): Promise<string> {
  const {apiToken, host} = requireSentryEnv()
  const response = await fetch(`${host}/organizations/`, {
    headers: {accept: 'application/json', authorization: `Bearer ${apiToken}`},
  })
  if (!response.ok) {
    throw new Error(`resolveSentryOrg failed: ${response.status} ${await response.text()}`)
  }

  const orgs = (await response.json()) as Array<{slug: string}>
  const requested = process.env.SENTRY_ORG
  if (requested) {
    if (orgs.every((org) => org.slug !== requested)) {
      throw new Error(
        `SENTRY_ORG "${requested}" is not visible to this token (saw: ${orgs.map((org) => org.slug).join(', ') || 'none'})`,
      )
    }

    return requested
  }

  if (orgs.length === 1) return orgs[0]!.slug
  throw new Error(
    `Token sees ${orgs.length} organizations; set SENTRY_ORG to pick one (${orgs.map((org) => org.slug).join(', ')})`,
  )
}

/**
 * Lists one Sentry org's projects via the REST API, for picking a project to
 * point `sentry project issues` at.
 *
 * @returns The project slugs, possibly empty.
 */
export async function sentryProjectSlugs(): Promise<string[]> {
  const {apiToken, host} = requireSentryEnv()
  const organization = await resolveSentryOrg()
  const response = await fetch(`${host}/organizations/${organization}/projects/`, {
    headers: {accept: 'application/json', authorization: `Bearer ${apiToken}`},
  })
  if (!response.ok) {
    throw new Error(`sentryProjectSlugs failed: ${response.status} ${await response.text()}`)
  }

  const projects = (await response.json()) as Array<{slug: string}>
  return projects.map((project) => project.slug)
}

// ─── Bitbucket REST ──────────────────────────────────────────────────────────

type Repo = {slug: string; updated_on: string}

async function bbCall(method: string, endpoint: string): Promise<{body: unknown; status: number}> {
  const {apiToken, email} = requireBitbucketEnv()
  const authorization = `Basic ${Buffer.from(`${email}:${apiToken}`).toString('base64')}`

  const response = await fetch(`https://api.bitbucket.org${endpoint}`, {
    headers: {accept: 'application/json', authorization},
    method,
  })

  const text = await response.text()
  const contentType = response.headers.get('content-type') ?? ''
  return {body: text && contentType.includes('application/json') ? JSON.parse(text) : null, status: response.status}
}

/**
 * Lists the workspace's repos matching a name query, following pagination.
 *
 * @param query The `q=` filter, e.g. `name~"e2e-host"`.
 * @returns The matching repos with slug and last-update timestamp.
 */
export async function findBbRepos(query: string): Promise<Repo[]> {
  const {workspace} = requireBitbucketEnv()
  const repos: Repo[] = []
  let next: string | undefined

  do {
    const suffix = next ?? `/2.0/repositories/${workspace}?pagelen=100&q=${encodeURIComponent(query)}`
    // eslint-disable-next-line no-await-in-loop -- cursor pagination needs the previous page's link
    const {body, status} = await bbCall('GET', suffix)
    if (status !== 200) {
      throw new Error(`findBbRepos failed: ${status} ${JSON.stringify(body)}`)
    }

    const page = body as {next?: string; values?: Repo[]}
    repos.push(...(page.values ?? []))
    // `next` is absolute; keep only its path+query for the next call.
    next = page.next ? page.next.slice('https://api.bitbucket.org'.length) : undefined
  } while (next)

  return repos
}

/**
 * Deletes a repo, tolerating one that is already gone.
 *
 * @param slug The repo slug within the fixture workspace.
 */
export async function deleteBbRepo(slug: string): Promise<void> {
  const {workspace} = requireBitbucketEnv()
  const {status} = await bbCall('DELETE', `/2.0/repositories/${workspace}/${slug}`)
  if (status !== 204 && status !== 404) {
    throw new Error(`deleteBbRepo ${slug} failed: ${status}`)
  }
}

async function deleteBbAll(slugs: string[]): Promise<void> {
  const results = await Promise.allSettled(slugs.map((slug) => deleteBbRepo(slug)))
  const failures = results.filter((result): result is PromiseRejectedResult => result.status === 'rejected')
  if (failures.length > 0) {
    throw new Error(
      `bb cleanup: ${failures.length}/${slugs.length} deletion(s) failed: ${failures
        .map((failure) => String(failure.reason))
        .join('; ')}`,
    )
  }
}

// ─── Trello REST ─────────────────────────────────────────────────────────────

const TRELLO_API_BASE = 'https://api.trello.com/1'

/**
 * When this process started — embedded in the run board's name, see
 * runBoardName(). Trello reports neither `dateLastActivity` nor `created`
 * reliably for API-created boards, so the name is the only durable timestamp
 * a fixture board carries and the stale sweep's age key.
 */
const RUN_EPOCH = Date.now()

/**
 * The fixture board's name: the shared prefix, the run id, and the creation
 * epoch. The complete naming contract a board must satisfy before any
 * destructive lookup will admit it — a board that merely starts with the
 * prefix must never be mistaken for a fixture the sweep may close.
 */
export function runBoardName(runId: string = RUN_ID, epoch: number = RUN_EPOCH): string {
  return `[e2e-host] run ${runId} ${epoch}`
}

/**
 * The creation epoch embedded in a fixture board's name.
 *
 * @param name The board name.
 * @returns The epoch millis, or undefined when the name carries none —
 *   treated as brand new by the stale sweep, never as infinitely old.
 */
export function boardEpoch(name: string): number | undefined {
  const epoch = Number(name.split(' ').at(-1))
  return Number.isFinite(epoch) && epoch > 0 ? epoch : undefined
}

/**
 * Whether a board name is a run board owned by `runId` — the shared prefix
 * plus an exact run id, in the shape runBoardName() builds.
 *
 * @param name The board name.
 * @param runId The run id to match.
 * @returns True when the name is that run's board.
 */
export function isRunBoardName(name: string, runId: string): boolean {
  const parts = name.split(' ')
  return parts.length === 4 && parts[0] === '[e2e-host]' && parts[1] === 'run' && parts[2] === runId
}

async function trelloCall<T = unknown>(
  method: string,
  endpoint: string,
  params: Record<string, string> = {},
): Promise<T> {
  const {apiKey, apiToken} = requireTrelloEnv()
  // String concatenation, not `new URL(endpoint, base)`: a root-relative
  // endpoint would discard the /1 path segment and land on the marketing site.
  const url = new URL(TRELLO_API_BASE + endpoint)
  url.searchParams.set('key', apiKey)
  url.searchParams.set('token', apiToken)
  for (const [name, value] of Object.entries(params)) {
    url.searchParams.set(name, value)
  }

  const response = await fetch(url, {method})
  const text = await response.text()
  const contentType = response.headers.get('content-type') ?? ''

  if (response.ok && contentType.includes('application/json')) {
    return JSON.parse(text) as T
  }

  throw new Error(`trelloCall ${method} ${endpoint} failed: ${response.status} ${contentType} ${text.slice(0, 200)}`)
}

/**
 * The three lists seedTrelloBoard() creates inside the run board.
 */
export type SeedLists = {doing: string; done: string; todo: string}

/**
 * Creates a private board with To Do/Doing/Done lists via the REST API.
 *
 * The CLI has no board-create command, so the fixture board is seeded
 * directly; cards are then driven through the CLI under test.
 *
 * @returns The board id and the three list ids.
 */
export async function seedTrelloBoard(): Promise<{boardId: string; lists: SeedLists}> {
  const board = await trelloCall<{id: string}>('POST', '/boards', {
    defaultLabels: 'false',
    defaultLists: 'false',
    name: runBoardName(),
    prefs_permissionLevel: 'private',
  })

  const names: Array<[keyof SeedLists, string]> = [
    ['todo', 'To Do'],
    ['doing', 'Doing'],
    ['done', 'Done'],
  ]
  const lists = {} as SeedLists
  for (const [key, name] of names) {
    // eslint-disable-next-line no-await-in-loop -- creation order fixes list order
    const list = await trelloCall<{id: string}>('POST', '/lists', {idBoard: board.id, name})
    lists[key] = list.id
  }

  return {boardId: board.id, lists}
}

/**
 * Closes the fixture board. Trello's API cannot delete boards — DELETE on a
 * board is not supported — so closing is the strongest cleanup available and
 * closed boards accumulate in the account.
 *
 * @param boardId The board to close.
 */
export async function closeTrelloBoard(boardId: string): Promise<void> {
  await trelloCall('PUT', `/boards/${boardId}`, {closed: 'true'})
}

/**
 * Lists the account's open boards with just their ids and names — the raw
 * material for name-based fixture lookup.
 *
 * @returns The open boards.
 */
export async function openTrelloBoards(): Promise<Array<{id: string; name: string}>> {
  return trelloCall<Array<{id: string; name: string}>>('GET', '/members/me/boards', {fields: 'id,name', filter: 'open'})
}

// ─── Run cleanup + stale sweep ───────────────────────────────────────────────

/**
 * One reclaimable service: credentials it needs, and how to reclaim this
 * run's fixtures and stale ones.
 *
 * A service whose credentials are absent is skipped by both sweep directions —
 * `E2E_PLUGINS="jira" npm run test:e2e` leaves the other sandboxes' keys
 * unset, and a missing key must read as "nothing to do here", not a failure.
 */
type Service = {
  cleanupRun(): Promise<number>
  hasCredentials: boolean
  name: string
  /** Reclaims fixtures older than the cutoff, returning how many. */
  sweepStale(cutoffEpoch: number): Promise<number>
}

const SERVICES: Service[] = [
  {
    async cleanupRun() {
      // Unions the JQL lookup with the keys seedJiraIssue recorded, because
      // indexing lags creation by seconds: a suite that seeds an issue and
      // then cleans up immediately would otherwise find nothing and orphan
      // it. The JQL half still matters — with E2E_RUN_ID set, a sweep running
      // in a different process than mocha has an empty tracking set and the
      // label is all it has to go on.
      const indexed = await findJiraByLabel(RUN_LABEL)
      const keys = [...new Set([...indexed, ...createdJiraKeys])]
      await deleteJiraAll(keys)
      return keys.length
    },
    hasCredentials: envSet(['ATLASSIAN_URL', 'ATLASSIAN_EMAIL', 'ATLASSIAN_API_TOKEN']),
    name: 'jira',
    async sweepStale() {
      const keys = await findJiraByLabel(SHARED_LABEL, 'created <= "-1h"')
      await deleteJiraAll(keys)
      return keys.length
    },
  },
  {
    async cleanupRun() {
      const ids = await findConfluencePagesByLabel(RUN_LABEL)
      await Promise.allSettled(ids.map((id) => purgeConfluencePage(id)))
      return ids.length
    },
    hasCredentials: envSet(['ATLASSIAN_URL', 'ATLASSIAN_EMAIL', 'ATLASSIAN_API_TOKEN']),
    name: 'conni',
    async sweepStale() {
      const ids = await findConfluencePagesByLabel(SHARED_LABEL, 'lastmodified <= now("-1h")')
      await Promise.allSettled(ids.map((id) => purgeConfluencePage(id)))
      return ids.length
    },
  },
  {
    async cleanupRun() {
      const repos = await findBbRepos(`name="e2e-host-${RUN_ID}"`)
      await deleteBbAll(repos.map((repo) => repo.slug))
      return repos.length
    },
    hasCredentials: envSet(['BITBUCKET_API_TOKEN', 'BITBUCKET_EMAIL', 'E2E_WORKSPACE']),
    name: 'bb',
    async sweepStale(cutoffEpoch) {
      // ISO-8601 timestamps sort lexicographically, so a string compare is an
      // age compare.
      const cutoff = new Date(cutoffEpoch).toISOString()
      const repos = (await findBbRepos('name~"e2e-host"')).filter((repo) => repo.updated_on < cutoff)
      await deleteBbAll(repos.map((repo) => repo.slug))
      return repos.length
    },
  },
  {
    async cleanupRun() {
      const boards = (await openTrelloBoards()).filter((board) => isRunBoardName(board.name, RUN_ID))
      await Promise.allSettled(boards.map((board) => closeTrelloBoard(board.id)))
      return boards.length
    },
    hasCredentials: envSet(['TRELLO_API_KEY', 'TRELLO_SECRET']) || envSet(['RELLO_API_KEY', 'TRELLO_SECRET']),
    name: 'trello',
    async sweepStale(cutoffEpoch) {
      const boards = (await openTrelloBoards())
        .filter((board) => board.name.startsWith('[e2e-host] run '))
        .filter((board) => {
          const epoch = boardEpoch(board.name)
          // A name without an epoch is treated as brand new, never as
          // infinitely old — the prefix alone never admits a board to the
          // stale sweep.
          return epoch !== undefined && epoch < cutoffEpoch
        })
      await Promise.allSettled(boards.map((board) => closeTrelloBoard(board.id)))
      return boards.length
    },
  },
]

async function forEachService(
  direction: 'cleanupRun' | 'sweepStale',
  cutoffEpoch: number,
  operation: (service: Service) => Promise<number>,
): Promise<void> {
  const failures: string[] = []
  for (const service of SERVICES) {
    if (!service.hasCredentials) {
      console.log(`${service.name}: skipped (no credentials)`)
      continue
    }

    try {
      // eslint-disable-next-line no-await-in-loop -- sequential is the point: one service's cleanup must finish before the next starts
      const reclaimed = await operation(service)
      console.log(
        `${service.name}: reclaimed ${reclaimed} ${direction === 'cleanupRun' ? 'run fixture(s)' : 'stale fixture(s)'}`,
      )
    } catch (error) {
      // One service's failure must not skip the others: fixtures left in the
      // shared sandboxes are the very thing this sweep exists to prevent.
      failures.push(`${service.name}: ${String(error)}`)
    }
  }

  if (failures.length > 0) {
    throw new Error(`sweep failures:\n${failures.join('\n')}`)
  }
}

/**
 * Deletes every fixture this run created, across every service whose
 * credentials are present — the backstop for a mocha killed before its
 * `after` hooks ran.
 */
export async function cleanupRun(): Promise<void> {
  await forEachService('cleanupRun', 0, (service) => service.cleanupRun())
}

/**
 * Deletes fixtures older than an hour, left behind by a crashed run.
 *
 * The age filter is what makes this safe to run while another suite is in
 * flight: it can only ever reclaim fixtures no live run still owns.
 *
 * @returns How many fixtures were reclaimed.
 */
export async function sweepStale(): Promise<number> {
  const cutoff = Date.now() - 3_600_000
  let reclaimed = 0
  await forEachService('sweepStale', cutoff, async (service) => {
    const count = await service.sweepStale(cutoff)
    reclaimed += count
    return count
  })
  return reclaimed
}
