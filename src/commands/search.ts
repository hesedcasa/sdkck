import {Args, Command, CommandHelp, Flags, toConfiguredId} from '@oclif/core'
import {OpenAI} from 'openai'

/**
 * Fuzzy match: checks if all characters of the query appear in order within the target.
 * Returns a score (lower is better) based on gap penalties, or -1 if no match.
 */
function fuzzyScore(query: string, target: string): number {
  const q = query.toLowerCase()
  const t = target.toLowerCase()

  // Exact substring match gets the best score
  if (t.includes(q)) return 0

  let qi = 0
  let score = 0
  let lastMatchIndex = -1

  for (let ti = 0; ti < t.length && qi < q.length; ti++) {
    if (t[ti] === q[qi]) {
      // Bonus for matching at word boundaries (after space, colon, hyphen, or start)
      const atBoundary = ti === 0 || ' :-_'.includes(t[ti - 1])
      const gap = lastMatchIndex === -1 ? 0 : ti - lastMatchIndex - 1
      score += gap + (atBoundary ? 0 : 1)
      lastMatchIndex = ti
      qi++
    }
  }

  // All query characters must be found
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

interface CommandEntry {
  description: string
  id: string
  plugin: string
  summary: string
}

/**
 * Minimal structural interface for the OpenAI client required by samplingSearch.
 * Using a structural type here makes the property easy to mock in tests without
 * importing the OpenAI SDK's class directly.
 */
interface SamplingClient {
  chat: {
    completions: {
      create(params: {
        max_tokens?: number
        messages: Array<{content: string; role: string}>
        model: string
      }): Promise<{choices: Array<{message: {content: null | string}}>}>
    }
  }
}

/**
 * MCP sampling-inspired search: passes all available commands to the LLM client
 * for semantic search and relevance ranking, mirroring the MCP sampling pattern
 * where the server delegates LLM inference to the connected client.
 */
async function samplingSearch(query: string, commands: CommandEntry[], client: SamplingClient): Promise<string[]> {
  const commandList = commands
    .map((c) => {
      const desc = [c.summary, c.description].filter(Boolean).join(' — ')
      return `${c.id}: ${desc || '(no description)'}`
    })
    .join('\n')

  const completion = await client.chat.completions.create({
    // eslint-disable-next-line camelcase
    max_tokens: 1024,
    messages: [
      {
        content:
          'You are a CLI command search assistant. Respond with only a valid JSON array, no markdown or explanation.',
        role: 'system',
      },
      {
        content: `Find the most relevant CLI commands for this search query: "${query}"

Available commands:
${commandList}

Return a JSON array of command IDs ordered by relevance (most relevant first).
Return [] if no commands match. Example: ["help", "plugins update"]`,
        role: 'user',
      },
    ],
    model: 'gpt-4o',
  })

  const text = completion.choices[0]?.message.content ?? ''
  const match = text.match(/\[[\s\S]*?]/)
  if (!match) return []
  return JSON.parse(match[0]) as string[]
}

export default class Search extends Command {
  static args = {
    query: Args.string({description: 'Search term to filter commands by', required: true}),
  }
  static description = 'Search for available commands'
  static examples = [
    '<%= config.bin %> search "create pr"',
    '<%= config.bin %> search jira -d',
    '<%= config.bin %> search "update jira" --details',
  ]
  static flags = {
    details: Flags.boolean({char: 'd', description: 'Show full help for each matched command', required: false}),
  }
  // Exposed for testing — inject a mock client to exercise the LLM search path
  _llmClient: null | SamplingClient = null

  async run(): Promise<void> {
    const {args, flags} = await this.parse(Search)
    const {query} = args

    const allCommands = this.config.commands.filter((c) => !c.hidden && c.pluginName !== '@oclif/plugin-plugins')

    const commandEntries: CommandEntry[] = allCommands.map((c) => ({
      description: c.description ?? '',
      id: c.id,
      plugin: c.pluginName ?? '',
      summary: c.summary ?? '',
    }))

    const client = this._llmClient ?? this._createOpenAIClient()
    type ScoredEntry = {cmd: Command.Loadable; score: number}
    let scored: ScoredEntry[]

    if (client === null) {
      scored = this._fuzzySearch(query, allCommands)
    } else {
      try {
        const matchedIds = await samplingSearch(query, commandEntries, client)
        const idToCmd = new Map(allCommands.map((c) => [c.id, c]))
        scored = matchedIds
          .map((id, index) => {
            const cmd = idToCmd.get(id)
            return cmd ? {cmd, score: index} : null
          })
          .filter((entry): entry is ScoredEntry => entry !== null)
      } catch {
        // Fall back to fuzzy matching on any LLM error
        scored = this._fuzzySearch(query, allCommands)
      }
    }

    if (scored.length === 0) {
      this.log(`No commands found matching "${query}"`)
      return
    }

    this.log(`Found ${scored.length} command${scored.length === 1 ? '' : 's'} matching "${query}":\n`)

    for (const {cmd} of scored) {
      const id = toConfiguredId(cmd.id, this.config)
      this.log(id)

      if (flags.details) {
        const help = new CommandHelp(cmd, this.config, {maxWidth: process.stdout.columns ?? 80})
        this.log(help.generate())
      } else {
        const raw = cmd.summary ?? cmd.description ?? ''
        // eslint-disable-next-line unicorn/prefer-string-replace-all
        const description = raw.replace(/<%=\s*config\.bin\s*%>/g, this.config.bin).split('\n')[0]
        if (description) {
          this.log(description)
        }
      }

      this.log('')
    }
  }

  private _createOpenAIClient(): null | SamplingClient {
    const apiKey = process.env.OPENAI_API_KEY
    console.log(apiKey)
    if (!apiKey) return null
    return new OpenAI({apiKey}) as unknown as SamplingClient
  }

  private _fuzzySearch(query: string, commands: Command.Loadable[]): Array<{cmd: Command.Loadable; score: number}> {
    return commands
      .map((c) => {
        const {id} = c
        const summary = c.summary ?? c.description ?? ''
        const plugin = c.pluginName ?? ''
        const score = bestScore(query, id, summary, plugin)
        return {cmd: c, score}
      })
      .filter((entry) => entry.score >= 0)
      .sort((a, b) => a.score - b.score || a.cmd.id.localeCompare(b.cmd.id))
  }
}
