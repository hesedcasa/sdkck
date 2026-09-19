import {expect} from 'chai'
import {execFile} from 'node:child_process'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import {fileURLToPath} from 'node:url'
import {promisify} from 'node:util'

import {
  requireAtlassianEnv,
  requireBitbucketEnv,
  requireMysqlEnv,
  requirePsqlEnv,
  requireSentryEnv,
  requireTrelloEnv,
  resolveSentryOrg,
} from './fixtures.js'

const execFileAsync = promisify(execFile)

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const CLI = path.join(REPO_ROOT, 'bin', 'run.js')

export type CliResult = {
  code: number
  stderr: string
  stdout: string
}

/**
 * The throwaway sdkck home `scripts/e2e.sh` packed and installed every local
 * plugin build into.
 *
 * Deliberately required rather than defaulted: without it a subprocess would
 * fall back to the developer's real sdkck data dir, whose installed plugin
 * releases are exactly what this suite must not test.
 *
 * @returns Absolute path to the shared throwaway home.
 * @throws {Error} If E2E_SDKCK_HOME is not set.
 */
function sdkckHome(): string {
  const home = process.env.E2E_SDKCK_HOME
  if (!home) {
    throw new Error(
      'Missing E2E_SDKCK_HOME — this suite must run through scripts/e2e.sh (npm run test:e2e), ' +
        'which packs the local plugins and installs them into a throwaway home',
    )
  }

  return home
}

/**
 * Runs the built sdkck CLI (`bin/run.js`) as a real subprocess, with every
 * oclif dir redirected: config to the per-plugin throwaway dir holding the
 * profile JSON, data/cache into the throwaway home the script installed the
 * local plugin builds into.
 *
 * Non-zero exits are returned rather than thrown so tests can assert on
 * failure paths.
 *
 * @param args Command line arguments, e.g. ['jira', 'project', 'list'].
 * @param configDir Value for SDKCK_CONFIG_DIR, from createConfigDir().
 * @returns The exit code and captured stdout/stderr.
 */
export async function runSdkck(args: string[], configDir: string): Promise<CliResult> {
  const home = sdkckHome()
  try {
    const {stderr, stdout} = await execFileAsync(process.execPath, [CLI, ...args], {
      env: {
        ...process.env,
        FORCE_COLOR: '0',
        NO_COLOR: '1',
        SDKCK_CACHE_DIR: path.join(home, 'cache'),
        SDKCK_CONFIG_DIR: configDir,
        SDKCK_DATA_DIR: path.join(home, 'data'),
      },
      maxBuffer: 64 * 1024 * 1024,
    })
    return {code: 0, stderr, stdout}
  } catch (error: unknown) {
    const failure = error as {code?: number; stderr?: string; stdout?: string}
    return {code: failure.code ?? 1, stderr: failure.stderr ?? '', stdout: failure.stdout ?? ''}
  }
}

/**
 * Replaces every occurrence of each secret in `text` with `<redacted>`.
 *
 * Empty/missing secrets are skipped rather than matching everything — an empty
 * needle would otherwise turn `replaceAll` into a full-string redaction.
 *
 * @param text Captured stdout/stderr that may contain secrets.
 * @param needles The values to scrub; falsy values leave `text` untouched.
 * @returns `text` with every occurrence of every needle replaced.
 */
export function redactSecrets(text: string, needles: Array<string | undefined>): string {
  let result = text
  for (const needle of needles) {
    if (needle) result = result.replaceAll(needle, '<redacted>')
  }

  return result
}

/**
 * Every credential this suite knows about, for redacting captured CLI output.
 *
 * Swallows missing-credential errors so a call site with no env configured
 * still gets a (no-op) redaction rather than a throw.
 *
 * @returns The secret values present in the environment.
 */
export function allSecrets(): string[] {
  const values = [
    process.env.ATLASSIAN_API_TOKEN,
    process.env.BITBUCKET_API_TOKEN,
    process.env.SENTRY_API_KEY,
    process.env.TRELLO_SECRET,
    process.env.LINEAR_API_KEY,
    process.env.VERCEL_API_KEY,
    process.env.CONTEXT7_API_KEY,
  ]
  return values.filter((value): value is string => Boolean(value))
}

/**
 * Runs the CLI and fails the test if it exited non-zero.
 *
 * The failure message redacts every known secret from stdout/stderr before it
 * is interpolated, so a failing call never prints a live credential into
 * mocha's failure output or CI logs. The returned `CliResult` itself is left
 * unredacted — tests need the real values to assert on.
 *
 * @param args Command line arguments.
 * @param configDir Value for SDKCK_CONFIG_DIR.
 * @returns The successful result.
 */
export async function runSdkckOk(args: string[], configDir: string): Promise<CliResult> {
  const result = await runSdkck(args, configDir)
  const stdout = redactSecrets(result.stdout, allSecrets())
  const stderr = redactSecrets(result.stderr, allSecrets())
  expect(result.code, `\`sdkck ${args.join(' ')}\` failed:\n${stdout}\n${stderr}`).to.equal(0)
  return result
}

/**
 * Strips the `METHOD <url>` request line that every api call/dynamic command
 * logs to stdout before the response body.
 *
 * @param stdout Captured stdout.
 * @returns The response body, ready to parse as JSON.
 */
export function stripRequestLine(stdout: string): string {
  const trimmed = stdout.trimStart()
  if (trimmed.startsWith('{') || trimmed.startsWith('[')) return trimmed

  const newline = stdout.indexOf('\n')
  return newline === -1 ? '' : stdout.slice(newline + 1)
}

/**
 * Runs the CLI and parses stdout as JSON.
 *
 * The Atlassian/Bitbucket/Sentry/Trello plugins emit JSON by default; the mysql
 * and psql plugins need `--json` passed explicitly — include it in `args`.
 *
 * @param args Command line arguments.
 * @param configDir Value for SDKCK_CONFIG_DIR.
 * @returns The parsed JSON payload.
 */
export async function runSdkckJson<T = unknown>(args: string[], configDir: string): Promise<T> {
  const {stdout} = await runSdkckOk(args, configDir)
  return JSON.parse(stripRequestLine(stdout)) as T
}

/**
 * Retries `attempt` until `predicate` accepts its result, or the deadline passes.
 *
 * Confluence's CQL index and Jira's JQL index are both eventually consistent,
 * so asserting once that a search finds freshly created content is a race;
 * polling the assertion itself is the honest shape.
 *
 * @param description What is being waited for, used in the timeout message.
 * @param attempt The operation to retry.
 * @param predicate Returns true once the result is the expected one.
 * @param timeoutMs How long to keep trying.
 * @returns The first accepted result.
 * @throws {Error} If the deadline passes before the predicate is satisfied.
 */
export async function eventually<T>(
  description: string,
  attempt: () => Promise<T>,
  predicate: (value: T) => boolean,
  timeoutMs = 60_000,
): Promise<T> {
  const deadline = Date.now() + timeoutMs
  let last: T | undefined

  while (Date.now() < deadline) {
    // eslint-disable-next-line no-await-in-loop
    last = await attempt()
    if (predicate(last)) return last

    // eslint-disable-next-line no-await-in-loop
    await new Promise((resolve) => {
      setTimeout(resolve, 1000)
    })
  }

  throw new Error(
    `eventually: timed out after ${timeoutMs}ms waiting for ${description}; last saw ${JSON.stringify(last)}`,
  )
}

/**
 * The plugin each config flavor is written for.
 *
 * `api` gets an empty dir: its stores are created by the commands under test
 * (`api import`, `api auth add`), not seeded here.
 */
export type PluginName = 'api' | 'bb' | 'conni' | 'jira' | 'mysql' | 'psql' | 'sentry' | 'trello'

/**
 * Writes a throwaway config dir holding the plugin's `<topic>-config.json`
 * with a `default` profile pointing at the live sandbox and a `broken` profile
 * whose credentials are invalid.
 *
 * Credentials are written as literals rather than `env:` references so the
 * suite never depends on a secret backend being reachable. The dir is passed
 * to the subprocess as SDKCK_CONFIG_DIR, so the real sdkck config is never
 * touched.
 *
 * @param plugin The plugin the config dir is for.
 * @returns Absolute path to the config dir.
 */
export async function createConfigDir(plugin: PluginName): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), `sdkck-e2e-${plugin}-`))
  let config: Record<string, unknown>

  switch (plugin) {
    case 'api': {
      return dir
    }

    case 'bb': {
      const {apiToken, email} = requireBitbucketEnv()
      const profile = {apiToken, email}
      config = {
        defaultProfile: 'default',
        profiles: {broken: {...profile, apiToken: 'definitely-not-the-token'}, default: profile},
      }
      break
    }

    case 'conni':
    case 'jira': {
      const {apiToken, email, host} = requireAtlassianEnv()
      const profile = {apiToken, email, host}
      config = {
        defaultProfile: 'default',
        profiles: {broken: {...profile, apiToken: 'definitely-not-the-token'}, default: profile},
      }
      break
    }

    case 'mysql': {
      const {host, port} = requireMysqlEnv()
      const profile = {
        database: 'mq_e2e',
        host,
        maxConcurrentQueries: 5,
        password: 'mq_root_pw',
        port,
        queryQueueTimeoutMs: 10_000,
        ssl: false,
        user: 'root',
      }
      config = {
        defaultProfile: 'default',
        profiles: {broken: {...profile, password: 'definitely-not-the-password'}, default: profile},
      }
      break
    }

    case 'psql': {
      const {host, port} = requirePsqlEnv()
      const profile = {
        database: 'pg_e2e',
        host,
        maxConcurrentQueries: 5,
        password: 'pg_e2e_pw',
        port,
        queryQueueTimeoutMs: 10_000,
        ssl: false,
        user: 'postgres',
      }
      config = {
        defaultProfile: 'default',
        profiles: {broken: {...profile, password: 'definitely-not-the-password'}, default: profile},
      }
      // The psql plugin reads `pg-config.json` — its own name for the file,
      // inherited from the standalone `pg` CLI the plugin repo grew out of.
      await fs.writeFile(path.join(dir, 'pg-config.json'), JSON.stringify(config, null, 2), {mode: 0o600})
      return dir
    }

    case 'sentry': {
      const {apiToken, host} = requireSentryEnv()
      const profile = {authToken: apiToken, host, organization: await resolveSentryOrg()}
      config = {
        defaultProfile: 'default',
        profiles: {broken: {...profile, authToken: 'definitely-not-the-token'}, default: profile},
      }
      break
    }

    case 'trello': {
      const {apiKey, apiToken} = requireTrelloEnv()
      const profile = {apiKey, apiToken}
      config = {
        defaultProfile: 'default',
        profiles: {
          broken: {
            apiKey: 'bogus-key-000000000000000',
            apiToken: 'bogus-token-000000000000000000000000000000000000000000000000000000000',
          },
          default: profile,
        },
      }
      break
    }
  }

  await fs.writeFile(path.join(dir, `${plugin}-config.json`), JSON.stringify(config, null, 2), {
    mode: 0o600,
  })
  return dir
}

/**
 * Removes a config dir written by createConfigDir().
 *
 * @param dir The directory to remove.
 */
export async function removeConfigDir(dir: string): Promise<void> {
  await fs.rm(dir, {force: true, recursive: true})
}
