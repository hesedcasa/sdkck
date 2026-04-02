import UFuzzy from '@leeoniya/ufuzzy'
import {Args, Command, CommandHelp, Flags, toConfiguredId} from '@oclif/core'
import {OpenAI} from 'openai'

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
  static enableJsonFlag = true
  static examples = [
    '<%= config.bin %> search "create pr"',
    '<%= config.bin %> search jira -d',
    '<%= config.bin %> search "update jira" --details',
  ]
  static flags = {
    details: Flags.boolean({char: 'd', description: 'Show full help for each matched command', required: false}),
    limit: Flags.integer({char: 'n', default: 5, description: 'Maximum number of results to return', required: false}),
  }
  // Exposed for testing — inject a mock client to exercise the LLM search path
  _llmClient: null | SamplingClient = null

  async run(): Promise<Array<{command: string; description: string}>> {
    const {args, flags} = await this.parse(Search)
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
      scored = this._fuzzySearch(args.query, allCommands)
    } else {
      try {
        const matchedIds = await samplingSearch(args.query, commandEntries, client)
        const idToCmd = new Map(allCommands.map((c) => [c.id, c]))
        scored = matchedIds
          .map((id, index) => {
            const cmd = idToCmd.get(id)
            return cmd ? {cmd, score: index} : null
          })
          .filter((entry): entry is ScoredEntry => entry !== null)
      } catch {
        // Fall back to fuzzy matching on any LLM error
        scored = this._fuzzySearch(args.query, allCommands)
      }
    }

    scored = scored.slice(0, flags.limit)

    const results = scored.map((entry) => {
      const {cmd} = entry
      const configuredId = toConfiguredId(cmd.id, this.config)
      const usageOverride = cmd.usage
      const argList = Object.values(cmd.args ?? {})
        .filter((a) => !a.hidden)
        .map((a) => (a.required ? `<${a.name}>` : `[${a.name}]`))
        .join(' ')
      const usage = usageOverride
        ? Array.isArray(usageOverride)
          ? usageOverride.join('\n')
          : usageOverride
        : [configuredId, argList].filter(Boolean).join(' ')
      return {
        command: usage,
        description: cmd.summary ?? cmd.description ?? '',
      }
    })

    if (!this.jsonEnabled()) {
      if (results.length === 0) {
        return results
      }

      this.log(`Found ${results.length} command${results.length === 1 ? '' : 's'}:\n`)

      for (const {cmd, result} of scored.map((s, i) => ({cmd: s.cmd, result: results[i]}))) {
        this.log(result.command)

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

    return results
  }

  private _createOpenAIClient(): null | SamplingClient {
    const apiKey = process.env.OPENAI_API_KEY
    if (!apiKey) return null
    return new OpenAI({apiKey}) as unknown as SamplingClient
  }

  private _fuzzySearch(query: string, commands: Command.Loadable[]): Array<{cmd: Command.Loadable; score: number}> {
    const uf = new UFuzzy({intraIns: Infinity})
    const haystack = commands.map((c) =>
      [c.id, c.summary ?? c.description ?? '', c.pluginName ?? ''].filter(Boolean).join(' '),
    )

    const [idxs, , order] = uf.search(haystack, query, 0, Infinity)
    if (idxs && idxs.length > 0) {
      const ranked = order ?? idxs.map((_, i) => i)
      return ranked.map((oi, rank) => ({cmd: commands[idxs[oi]], score: rank}))
    }

    // Multi-token fallback: score each command by how many individual query
    // tokens it matches. Handles queries containing unknown alias words (e.g.
    // "atlassian") that don't appear literally in any command field.
    const tokens = query.trim().split(/\s+/).filter(Boolean)
    if (tokens.length <= 1) return []

    const hitCount = new Map<number, number>()
    for (const token of tokens) {
      const [tIdxs] = uf.search(haystack, token, 0, Infinity)
      if (tIdxs) {
        for (const idx of tIdxs) hitCount.set(idx, (hitCount.get(idx) ?? 0) + 1)
      }
    }

    return [...hitCount.entries()]
      .sort((a, b) => b[1] - a[1] || a[0] - b[0])
      .map(([idx, hits]) => ({cmd: commands[idx], score: tokens.length - hits}))
  }
}
