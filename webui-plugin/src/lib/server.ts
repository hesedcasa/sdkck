import type {Config} from '@oclif/core'
import type {IncomingMessage, Server, ServerResponse} from 'node:http'

import {createServer} from 'node:http'
import {existsSync} from 'node:fs'
import {dirname, join} from 'node:path'
import {fileURLToPath} from 'node:url'
import {parse} from 'node:url'

import {runCommand} from './executor.js'
import {describeCommands} from './introspect.js'

export interface ServerOptions {
  config: Config
  dev: boolean
  host: string
  port: number
}

export interface RunningServer {
  server: Server
  url: string
}

const moduleDir = dirname(fileURLToPath(import.meta.url))
/** The Next.js project lives at `<pluginRoot>/web`; this file is `<pluginRoot>/dist/lib/server.js`. */
const webDir = join(moduleDir, '..', '..', 'web')

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  const payload = JSON.stringify(body)
  res.writeHead(status, {'content-type': 'application/json', 'content-length': Buffer.byteLength(payload)})
  res.end(payload)
}

async function readJsonBody(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = []
  for await (const chunk of req) chunks.push(chunk as Buffer)
  if (chunks.length === 0) return {}
  return JSON.parse(Buffer.concat(chunks).toString('utf8'))
}

/**
 * Handle the small JSON API the browser app talks to. Returns `true` if the
 * request was an API request (and has been answered), `false` otherwise so the
 * caller can hand it to Next.js.
 */
async function handleApi(config: Config, req: IncomingMessage, res: ServerResponse): Promise<boolean> {
  const {pathname} = parse(req.url ?? '', true)
  if (!pathname?.startsWith('/api/')) return false

  try {
    if (pathname === '/api/health') {
      sendJson(res, 200, {ok: true})
      return true
    }

    if (pathname === '/api/commands' && req.method === 'GET') {
      sendJson(res, 200, {bin: config.bin, commands: describeCommands(config), version: config.version})
      return true
    }

    if (pathname === '/api/run' && req.method === 'POST') {
      const body = (await readJsonBody(req)) as {argv?: unknown; id?: unknown}
      if (typeof body.id !== 'string') {
        sendJson(res, 400, {error: 'Request body must include a string "id".'})
        return true
      }

      const argv = Array.isArray(body.argv) ? body.argv.map(String) : []
      const found = config.findCommand(body.id)
      if (!found) {
        sendJson(res, 404, {error: `Unknown command: ${body.id}`})
        return true
      }

      const result = await runCommand(config, body.id, argv)
      sendJson(res, 200, result)
      return true
    }

    sendJson(res, 404, {error: 'Not found'})
    return true
  } catch (error) {
    sendJson(res, 500, {error: error instanceof Error ? error.message : String(error)})
    return true
  }
}

/**
 * Start the web UI server: a Next.js app for the front-end plus a JSON API
 * (served from the same origin) that introspects and runs oclif commands.
 */
export async function startServer(options: ServerOptions): Promise<RunningServer> {
  const {config, dev, host, port} = options

  if (!dev && !existsSync(join(webDir, '.next'))) {
    throw new Error(
      `No production build found at ${join(webDir, '.next')}.\n` +
        `Run "npm run build:web" in the @hesed/webui plugin, or start with --dev.`,
    )
  }

  // Imported lazily and loosely typed so the oclif command can be compiled
  // without pulling Next's full type surface into the plugin's tsconfig.
  const {default: next} = (await import('next')) as unknown as {
    default: (options: Record<string, unknown>) => {
      getRequestHandler(): (req: IncomingMessage, res: ServerResponse, parsedUrl: ReturnType<typeof parse>) => void
      prepare(): Promise<void>
    }
  }

  const app = next({dev, dir: webDir, hostname: host, port})
  await app.prepare()
  const handle = app.getRequestHandler()

  const server = createServer((req, res) => {
    handleApi(config, req, res)
      .then((handled) => {
        if (!handled) handle(req, res, parse(req.url ?? '', true))
      })
      .catch((error) => {
        if (!res.headersSent) sendJson(res, 500, {error: error instanceof Error ? error.message : String(error)})
      })
  })

  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(port, host, resolve)
  })

  const displayHost = host === '0.0.0.0' ? 'localhost' : host
  return {server, url: `http://${displayHost}:${port}`}
}
