import type {Config} from '@oclif/core/interfaces'

// eslint-disable-next-line import/no-unresolved
import {McpServer} from '@modelcontextprotocol/sdk/server/mcp.js'
// eslint-disable-next-line import/no-unresolved
import {StdioServerTransport} from '@modelcontextprotocol/sdk/server/stdio.js'
// eslint-disable-next-line import/no-unresolved
import {StreamableHTTPServerTransport} from '@modelcontextprotocol/sdk/server/streamableHttp.js'
// eslint-disable-next-line import/no-unresolved
import {CallToolRequestSchema, isInitializeRequest, ListToolsRequestSchema} from '@modelcontextprotocol/sdk/types.js'
import {randomUUID} from 'node:crypto'
import * as http from 'node:http'

import {sdkck, SdkckExecutionError} from './api.js'
import {checkBearerToken, readMcpAuth} from './mcp-auth.js'
import {isCommandAllowed, readPermissionConfig} from './permission-config.js'
import {SearchCache} from './search-cache.js'

// ─── Server factory ──────────────────────────────────────────────────────────

// ts-prune-ignore-next
export async function createMcpServer(config: Config): Promise<McpServer> {
  const mcpServer = new McpServer({name: 'sdkck', version: config.version ?? '0.0.0'}, {capabilities: {tools: {}}})

  const searchCmd = config.commands.find((c) => c.id === 'search')

  const cacheFilePath = config.configDir ? `${config.configDir}/search-cache-mcp.json` : undefined
  const searchCache = new SearchCache({cacheFilePath})

  const permissionConfig = config.configDir ? await readPermissionConfig(config.configDir) : {rules: []}

  // Build a deduplicated keyword list from each command's ID parts (topics,
  // subcommands) and its summary/description so the search_tools tool
  // advertises both the namespace and what each command actually does.
  const stopwords = new Set([
    'a',
    'all',
    'an',
    'and',
    'any',
    'are',
    'as',
    'at',
    'be',
    'belong',
    'bin',
    'by',
    'can',
    'current',
    'different',
    'display',
    'displays',
    'for',
    'from',
    'get',
    'has',
    'have',
    'hello',
    'in',
    'into',
    'is',
    'it',
    'its',
    'level',
    'new',
    'of',
    'on',
    'or',
    'over',
    'performed',
    'performs',
    'run',
    'set',
    'show',
    'specific',
    'that',
    'the',
    'their',
    'this',
    'to',
    'use',
    'used',
    'useful',
    'uses',
    'using',
    'will',
    'with',
    'work',
    'you',
  ])

  const keywords = new Set<string>()

  const addWord = (raw: string) => {
    const word = raw.toLowerCase().replaceAll(/^-+|-+$/g, '')
    if (word.length >= 2 && !stopwords.has(word)) keywords.add(word)
  }

  for (const c of config.commands) {
    const commandId = c.id.replaceAll(':', ' ')
    if (!isCommandAllowed(commandId, permissionConfig)) continue
    for (const part of c.id.split(':')) addWord(part)
    const text = `${c.summary ?? ''} ${c.description ?? ''}`
    for (const raw of text.split(/[^a-zA-Z0-9-]+/)) addWord(raw)
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const jitPlugins = (config.pjson?.oclif as any)?.jitPlugins as Record<string, string> | undefined
  for (const name of Object.keys(jitPlugins ?? {})) {
    const short = name.split('/').pop()
    if (short) addWord(short)
  }

  const searchToolsDescription = `Search for MCP tools with keywords: ${[...keywords].sort().join(' ')}`

  mcpServer.server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: [
      {
        description: searchToolsDescription,
        inputSchema: {
          properties: {
            limit: {description: 'Maximum number of results (default 5)', type: 'number'},
            query: {description: 'Search query describing the task or command you are looking for', type: 'string'},
          },
          required: ['query'],
          type: 'object',
        },
        name: 'search_tools',
      },
      {
        description: 'Run a Sidekick command. Use "search_tools" first to discover commands and their arguments.',
        inputSchema: {
          properties: {
            args: {
              description: 'Command arguments as key-value pairs (e.g. {"issueId":"PROJ-123"})',
              type: 'object',
            },
            commandId: {
              description: 'The command ID to run (e.g. "jira issue get")',
              type: 'string',
            },
            flags: {
              description: 'Flag arguments as key-value pairs (e.g. {"limit":10,"verbose":true})',
              type: 'object',
            },
          },
          required: ['commandId'],
          type: 'object',
        },
        name: 'run_command',
      },
    ],
  }))

  mcpServer.server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const {arguments: toolArgs, name} = request.params

    if (name === 'search_tools') {
      if (!searchCmd) {
        return {content: [{text: 'Search command not available', type: 'text' as const}], isError: true}
      }

      const query = (toolArgs?.query as string) ?? ''
      const limit = toolArgs?.limit as number | undefined

      const cached = searchCache.get(query, limit)
      if (cached !== undefined) {
        return {content: [{text: cached, type: 'text' as const}]}
      }

      const searchArgs: Record<string, unknown> = {query}
      if (limit !== undefined) searchArgs.limit = limit

      const {error, output} = await sdkck.commands.run(config, 'search', searchArgs)
      if (error) {
        return {content: [{text: error, type: 'text' as const}], isError: true}
      }

      searchCache.set(query, limit, output)
      return {content: [{text: output, type: 'text' as const}]}
    }

    if (name === 'run_command') {
      const {
        args: cmdArgs = {},
        commandId = '',
        flags: cmdFlags = {},
      } = (request.params.arguments ?? {}) as {
        args?: Record<string, unknown>
        commandId: string
        flags?: Record<string, unknown>
      }

      try {
        const result = await sdkck.commands.run(config, commandId, {...cmdArgs, ...cmdFlags})

        return {
          content: [
            {
              text: result.error ? `Error: ${result.error}\n${result.output}` : result.output,
              type: 'text',
            },
          ],
          ...(result.error ? {isError: true} : {}),
        }
      } catch (error) {
        const msg =
          error instanceof SdkckExecutionError
            ? error.code === 'command_not_found'
              ? `Unknown command: "${commandId}". Use the "search_tools" tool to find available commands.`
              : error.message
            : error instanceof Error
              ? error.message
              : String(error)
        return {content: [{text: msg, type: 'text' as const}], isError: true}
      }
    }

    return {content: [{text: `Unknown tool: ${name}`, type: 'text' as const}], isError: true}
  })

  return mcpServer
}

export async function startMcpServer(
  config: Config,
  options: {host?: string; port?: number; transport?: string} = {},
): Promise<void> {
  const {host = '127.0.0.1', port = 3000, transport = 'stdio'} = options
  const server = await createMcpServer(config)

  if (transport === 'http') {
    const transports = new Map<string, StreamableHTTPServerTransport>()
    const token = config.configDir ? await readMcpAuth(config.configDir) : null

    const httpServer = http.createServer(async (req, res) => {
      const url = new URL(req.url ?? '/', `http://${req.headers.host}`)

      if (url.pathname !== '/mcp') {
        res.writeHead(404).end('Not found')
        return
      }

      if (token && !checkBearerToken(req, res, token)) return

      const sessionId = req.headers['mcp-session-id'] as string | undefined

      if (req.method === 'GET') {
        if (!sessionId || !transports.has(sessionId)) {
          res.writeHead(400).end('Invalid or missing session ID')
          return
        }

        await transports.get(sessionId)!.handleRequest(req, res)
        return
      }

      if (req.method === 'POST') {
        if (sessionId && transports.has(sessionId)) {
          await transports.get(sessionId)!.handleRequest(req, res)
          return
        }

        // New session — only accept initialize requests
        let body: unknown
        try {
          body = await new Promise<unknown>((resolve, reject) => {
            let raw = ''
            req.on('data', (chunk: string) => {
              raw += chunk
            })
            req.on('end', () => {
              try {
                resolve(JSON.parse(raw))
              } catch {
                reject(new Error('Invalid JSON'))
              }
            })
            req.on('error', reject)
          })
        } catch {
          res.writeHead(400).end('Invalid JSON')
          return
        }

        if (!isInitializeRequest(body)) {
          res.writeHead(400).end(
            JSON.stringify({
              error: {code: -32_000, message: 'Bad Request: expected initialize'},
              id: null,
              jsonrpc: '2.0',
            }),
          )
          return
        }

        const mcpTransport = new StreamableHTTPServerTransport({
          onsessioninitialized(sid) {
            transports.set(sid, mcpTransport)
          },
          sessionIdGenerator: () => randomUUID(),
        })

        // eslint-disable-next-line unicorn/prefer-add-event-listener
        mcpTransport.onclose = () => {
          if (mcpTransport.sessionId) transports.delete(mcpTransport.sessionId)
        }

        const mcpServerInstance = await createMcpServer(config)
        await mcpServerInstance.connect(mcpTransport)
        await mcpTransport.handleRequest(req, res, body)
        return
      }

      if (req.method === 'DELETE') {
        if (!sessionId || !transports.has(sessionId)) {
          res.writeHead(400).end('Invalid or missing session ID')
          return
        }

        await transports.get(sessionId)!.close()
        res.writeHead(200).end()
        return
      }

      res.writeHead(405).end('Method not allowed')
    })

    await new Promise<void>((resolve, reject) => {
      httpServer.on('error', reject)
      httpServer.listen(port, host, resolve)
    })
    process.stderr.write(`MCP server listening on http://${host}:${port}\n`)
    process.stderr.write(`  Endpoint: /mcp\n`)
    if (token) process.stderr.write(`  Authentication: Bearer token required\n`)

    await new Promise<void>((_, reject) => {
      httpServer.on('error', reject)
    })
    return
  }

  const stdioTransport = new StdioServerTransport()
  await server.connect(stdioTransport)
}
