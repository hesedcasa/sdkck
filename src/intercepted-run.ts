import {type ChildProcess, spawn} from 'node:child_process'
import {mkdtemp, rm} from 'node:fs/promises'
import {constants, tmpdir} from 'node:os'
import {join} from 'node:path'

/**
 * Re-executing this CLI invocation with a broker's proxy environment in place.
 *
 * Shared by both credential brokers, because the reason for the re-exec is the
 * same for both: Node reads `NODE_USE_ENV_PROXY` and `NODE_EXTRA_CA_CERTS` when
 * the process starts, so a process cannot proxy its own `fetch` by mutating
 * `process.env`. Running the command in a process that *started* with the
 * environment covers in-process `fetch`, every plugin's HTTP, and any
 * subprocess, in one mechanism.
 */

/** Options for {@link runInterceptedProcess}. Everything is injectable for tests. */
export type InterceptedProcessOptions = {
  /** Arguments for the child, defaulting to this process's (`process.argv.slice(1)`). */
  argv?: string[]
  /**
   * Resolve the broker credential and install the proxy environment.
   *
   * Called with a private temporary path for the root CA and the child's
   * environment object to mutate. Throwing here means the command is not run
   * at all, which is what fails the invocation closed.
   */
  configure(context: {certPath: string; env: NodeJS.ProcessEnv}): Promise<unknown>
  /** Environment to derive the child's from. Defaults to `process.env`. */
  env?: NodeJS.ProcessEnv
  /** Node options for the child, defaulting to this process's `execArgv`. */
  execArgv?: string[]
  /** Node binary to re-execute. Defaults to `process.execPath`. */
  execPath?: string
  /**
   * Environment keys set to `1` in the child, marking interception as already
   * active so it does not intercept itself again. One broker per invocation:
   * a second one would only overwrite the first one's `HTTPS_PROXY`.
   */
  sentinels: string[]
  /** Spawn implementation, for tests. */
  spawnFn?: typeof spawn
  /**
   * Environment keys removed from the child — the broker credentials it has no
   * business holding, now that the proxy credential rides inside the proxy URL.
   */
  stripEnv?: string[]
  /** Prefix for the temporary directory holding the root CA. */
  tmpPrefix: string
}

/**
 * Re-execute this CLI invocation with its outbound traffic brokered, and
 * resolve with the child's exit code.
 *
 * The root CA lives in a private temporary directory for the child's lifetime
 * and is removed once it exits, so no certificate and no token is left behind.
 *
 * @throws {Error} When `configure` fails — the credential could not be
 *   resolved, or the certificate could not be written. Callers fail closed
 *   rather than run unbrokered.
 */
export async function runInterceptedProcess(options: InterceptedProcessOptions): Promise<number> {
  const sourceEnv = options.env ?? process.env
  const childEnv: NodeJS.ProcessEnv = {...sourceEnv}
  for (const key of options.sentinels) childEnv[key] = '1'
  for (const key of options.stripEnv ?? []) Reflect.deleteProperty(childEnv, key)

  const certDir = await mkdtemp(join(tmpdir(), options.tmpPrefix))

  try {
    await options.configure({certPath: join(certDir, 'ca.pem'), env: childEnv})

    return await spawnChild({
      argv: options.argv ?? process.argv.slice(1),
      env: childEnv,
      execArgv: options.execArgv ?? process.execArgv,
      execPath: options.execPath ?? process.execPath,
      spawnFn: options.spawnFn ?? spawn,
    })
  } finally {
    // The child has exited by now, so the certificate is no longer needed.
    await rm(certDir, {force: true, recursive: true})
  }
}

/** Exit code a shell reports for a process killed by a signal. */
function signalExitCode(signal: NodeJS.Signals): number {
  const number = constants.signals[signal]
  return number ? 128 + number : 1
}

/** Run the child with inherited stdio, forwarding termination signals to it. */
async function spawnChild(opts: {
  argv: string[]
  env: NodeJS.ProcessEnv
  execArgv: string[]
  execPath: string
  spawnFn: typeof spawn
}): Promise<number> {
  const child: ChildProcess = opts.spawnFn(opts.execPath, [...opts.execArgv, ...opts.argv], {
    env: opts.env,
    stdio: 'inherit',
  })

  const forward = (signal: NodeJS.Signals) => () => {
    child.kill(signal)
  }

  const onInt = forward('SIGINT')
  const onTerm = forward('SIGTERM')
  process.on('SIGINT', onInt)
  process.on('SIGTERM', onTerm)

  try {
    return await new Promise<number>((resolve, reject) => {
      child.once('error', reject)
      child.once('close', (code, signal) => {
        resolve(signal ? signalExitCode(signal) : (code ?? 1))
      })
    })
  } finally {
    process.removeListener('SIGINT', onInt)
    process.removeListener('SIGTERM', onTerm)
  }
}
