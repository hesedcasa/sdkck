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

/**
 * Multi-target token match: pools tokens from all target strings (id, summary,
 * plugin) and checks how many query tokens match. Each query token matches a
 * pool token when they share a common prefix of length
 * >= max(2, min(queryTokenLen, targetTokenLen) - 1), which handles morphological
 * variants like "authenticate" vs "authentication".
 *
 * Tolerates at most 1 unmatched query token so that a user-supplied topic word
 * (e.g. "atlassian") that doesn't literally appear in any field still allows the
 * rest of the query ("jira issue get") to surface the right command.
 */
function tokenPoolScore(query: string, targets: string[]): number {
  const qTokens = query.toLowerCase().split(/\s+/).filter(Boolean)
  const tTokens = targets.flatMap((t) =>
    t
      .toLowerCase()
      .split(/[\s/.-]+/)
      .filter(Boolean),
  )

  let score = 0
  let matchedCount = 0

  for (const qt of qTokens) {
    let best = -1
    for (const tt of tTokens) {
      let i = 0
      while (i < qt.length && i < tt.length && qt[i] === tt[i]) i++
      if (i >= Math.max(2, Math.min(qt.length, tt.length) - 1)) {
        const s = qt.length - i
        if (best === -1 || s < best) best = s
      }
    }

    if (best >= 0) {
      matchedCount++
      score += best + 1
    }
  }

  // Require all tokens to match, but tolerate 1 unmatched for multi-token queries
  if (matchedCount < Math.max(1, qTokens.length - 1)) return -1
  // Unmatched tokens are penalised heavily so they rank below full matches
  return score + (qTokens.length - matchedCount) * qTokens.length * 10
}

function bestScore(query: string, ...targets: string[]): number {
  let charBest = -1
  for (const t of targets) {
    const s = fuzzyScore(query, t)
    if (s !== -1 && (charBest === -1 || s < charBest)) charBest = s
  }

  const tScore = tokenPoolScore(query, targets)
  if (charBest === -1) return tScore
  if (tScore === -1) return charBest
  return Math.min(charBest, tScore)
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
        this.log(`No commands found matching "${args.query}"`)
        return results
      }

      this.log(`Found ${results.length} command${results.length === 1 ? '' : 's'} matching "${args.query}":\n`)

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
