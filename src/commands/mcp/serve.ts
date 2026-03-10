import {Server} from '@modelcontextprotocol/sdk/server/index.js'
import {StdioServerTransport} from '@modelcontextprotocol/sdk/server/stdio.js'
import {CallToolRequestSchema, ListToolsRequestSchema} from '@modelcontextprotocol/sdk/types.js'
import {Command, toConfiguredId} from '@oclif/core'
import {execFile} from 'node:child_process'
import {join} from 'node:path'
import {promisify} from 'node:util'

const execFileAsync = promisify(execFile)

/**
 * Fuzzy match: checks if all characters of the query appear in order within the target.
 * Returns a score (lower is better) based on gap penalties, or -1 if no match.
 */
function fuzzyScore(query: string, target: string): number {
  const q = query.toLowerCase()
  const t = target.toLowerCase()

  if (t.includes(q)) return 0

  let qi = 0
  let score = 0
  let lastMatchIndex = -1

  for (let ti = 0; ti < t.length && qi < q.length; ti++) {
    if (t[ti] === q[qi]) {
      const atBoundary = ti === 0 || ' :-_'.includes(t[ti - 1])
      const gap = lastMatchIndex === -1 ? 0 : ti - lastMatchIndex - 1
      score += gap + (atBoundary ? 0 : 1)
      lastMatchIndex = ti
      qi++
    }
  }

  return qi === q.length ? score : -1
}

function bestScore(query: string, ...targets: string[]): number {
  let best = -1
  for (const t of targets) {
    const s = fuzzyScore(query, t)
    if (s === -1) continue
    if (best === -1 || s < best) best = s
  }

  return best
}

export default class McpServe extends Command {
  static description = 'Start an MCP server exposing search and execute tools'
  static examples = ['<%= config.bin %> mcp serve']
  // Exposed for testing — inject a mock server to bypass real stdio binding
  _server: null | Server = null

  async run(): Promise<void> {
    const server =
      this._server ?? new Server({name: 'sdkck', version: this.config.version}, {capabilities: {tools: {}}})

    server.setRequestHandler(ListToolsRequestSchema, async () => ({
      tools: [
        {
          description:
            'Search for available CLI commands by a query term. Returns a list of matching commands with their IDs, summaries, descriptions, and plugin names.',
          inputSchema: {
            properties: {
              query: {description: 'Search term to filter commands by', type: 'string'},
            },
            required: ['query'],
            type: 'object',
          },
          name: 'search',
        },
        {
          description:
            'Execute a CLI command by its ID with optional arguments. Returns the command output. Use the search tool first to discover available command IDs.',
          inputSchema: {
            properties: {
              args: {
                description: 'Arguments and flags to pass to the command (e.g. ["my query", "--details"])',
                items: {type: 'string'},
                type: 'array',
              },
              command: {
                description: 'Command ID to execute (e.g. "search", "jira create")',
                type: 'string',
              },
            },
            required: ['command'],
            type: 'object',
          },
          name: 'execute',
        },
      ],
    }))

    server.setRequestHandler(CallToolRequestSchema, async (request) => {
      const {arguments: toolArgs, name} = request.params

      if (name === 'search') {
        const query = toolArgs?.query as string
        const allCommands = this.config.commands.filter((c) => !c.hidden && c.pluginName !== '@oclif/plugin-plugins')

        const results = allCommands
          .map((c) => {
            const score = bestScore(query, c.id, c.summary ?? c.description ?? '', c.pluginName ?? '')
            return {cmd: c, score}
          })
          .filter((e) => e.score >= 0)
          .sort((a, b) => a.score - b.score || a.cmd.id.localeCompare(b.cmd.id))
          .map(({cmd}) => ({
            description: cmd.description ?? '',
            id: toConfiguredId(cmd.id, this.config),
            plugin: cmd.pluginName ?? '',
            summary: cmd.summary ?? '',
          }))

        return {
          content: [{text: JSON.stringify(results, null, 2), type: 'text'}],
        }
      }

      if (name === 'execute') {
        const commandId = toolArgs?.command as string
        const args = (toolArgs?.args as string[] | undefined) ?? []
        const commandParts = commandId.split(' ')
        const binPath = join(this.config.root, 'bin', 'run.js')

        try {
          const {stderr, stdout} = await execFileAsync(process.execPath, [binPath, ...commandParts, ...args], {
            timeout: 30_000,
          })
          const output = [stdout, stderr].filter(Boolean).join('\n')
          return {
            content: [{text: output || '(no output)', type: 'text'}],
          }
        } catch (error: unknown) {
          const err = error as {message?: string; stderr?: string; stdout?: string}
          const output = [err.stdout, err.stderr, err.message].filter(Boolean).join('\n')
          return {
            content: [{text: output || 'Command failed', type: 'text'}],
            isError: true,
          }
        }
      }

      throw new Error(`Unknown tool: ${name}`)
    })

    const transport = new StdioServerTransport()
    await server.connect(transport)
  }
}
