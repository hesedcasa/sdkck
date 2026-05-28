import UFuzzy from '@leeoniya/ufuzzy'
import {Args, Command, CommandHelp, Flags, toConfiguredId} from '@oclif/core'
import {OpenAI} from 'openai'

import {SearchCache} from '../search-cache.js'
import {applyUsageBoost, readUsageSync, type UsageMap} from '../usage-tracker.js'

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
async function samplingSearch(
  query: string,
  commands: CommandEntry[],
  client: SamplingClient,
  usageMap: UsageMap = {},
): Promise<string[]> {
  const commandList = commands
    .map((c) => {
      const desc = [c.summary, c.description].filter(Boolean).join(' — ')
      return `${c.id}: ${desc || '(no description)'}`
    })
    .join('\n')

  const commandIdSet = new Set(commands.map((c) => c.id))
  const topUsed = Object.entries(usageMap)
    .filter(([id]) => commandIdSet.has(id))
    .sort(([, a], [, b]) => b.count - a.count)
    .slice(0, 5)
    .map(([id, e]) => `${id} (×${e.count})`)
  const usageContext =
    topUsed.length > 0
      ? `\nFrequently used commands in this workspace (consider for relevance): ${topUsed.join(', ')}`
      : ''

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
        content: `Find the most relevant CLI commands for this search query: "${query}"${usageContext}

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
    compact: Flags.boolean({description: 'Show only command IDs without descriptions (token-efficient)', required: false}),
    details: Flags.boolean({char: 'd', description: 'Show full help for each matched command', required: false}),
    limit: Flags.integer({char: 'n', default: 5, description: 'Maximum number of results to return', required: false}),
    top: Flags.integer({description: 'Maximum number of results; overrides --limit when provided', required: false}),
  }
  // Exposed for testing — inject a mock client to exercise the LLM search path
  _llmClient: null | SamplingClient = null
  // Exposed for testing — inject a pre-populated cache to exercise the cache hit path
  _searchCache: null | SearchCache = null
  // Exposed for testing — inject usage data to exercise the rank-by-usage path
  _usageMap: null | UsageMap = null

  async run(): Promise<
    Array<{
      args: Array<Record<string, {description: string; required: boolean; type: string}>>
      command: string
      commandId: string
      description: string
      flags: Array<Record<string, {description: string; required: boolean; type: string}>>
    }>
  > {
    const {args, flags} = await this.parse(Search)
    const effectiveLimit = flags.top ?? flags.limit
    const allCommands = this.config.commands.filter((c) => !c.hidden && c.pluginName !== '@oclif/plugin-plugins')
    const commandEntries: CommandEntry[] = allCommands.map((c) => ({
      description: c.description ?? '',
      id: c.id,
      plugin: c.pluginName ?? '',
      summary: c.summary ?? '',
    }))

    const cacheFilePath = this.config.configDir ? `${this.config.configDir}/search-cache-cli.json` : undefined
    const searchCache = this._searchCache ?? new SearchCache({cacheFilePath})
    const usageMap = this._usageMap ?? (this.config.configDir ? readUsageSync(this.config.configDir) : {})

    const client = this._llmClient ?? this._createOpenAIClient()
    type ScoredEntry = {cmd: Command.Loadable; score: number}
    let scored: ScoredEntry[] = []

    const idToCmd = new Map(allCommands.map((c) => [c.id, c]))
    const cached = searchCache.get(args.query, effectiveLimit)
    let cacheHit = false

    if (cached !== undefined) {
      try {
        const cachedIds = JSON.parse(cached) as string[]
        scored = cachedIds
          .map((id, index) => {
            const cmd = idToCmd.get(id)
            return cmd ? {cmd, score: index} : null
          })
          .filter((entry): entry is ScoredEntry => entry !== null)
        cacheHit = true
      } catch (error) {
        this.warn(
          `Corrupted search cache entry for query "${args.query}". Error: ${error instanceof Error ? error.message : String(error)}`,
        )
      }
    }

    if (cacheHit) {
      scored = scored.slice(0, effectiveLimit)
    } else {
      let llmFailed = false
      if (client === null) {
        scored = this._fuzzySearch(args.query, allCommands)
      } else {
        try {
          const matchedIds = await samplingSearch(args.query, commandEntries, client, usageMap)
          scored = matchedIds
            .map((id, index) => {
              const cmd = idToCmd.get(id)
              return cmd ? {cmd, score: index} : null
            })
            .filter((entry): entry is ScoredEntry => entry !== null)
        } catch (error) {
          this.warn(
            `LLM search failed (falling back to fuzzy matching): ${error instanceof Error ? error.message : String(error)}`,
          )
          llmFailed = true
          scored = this._fuzzySearch(args.query, allCommands)
        }
      }

      scored = scored.slice(0, effectiveLimit)
      if (!llmFailed && scored.length > 0) {
        searchCache.set(args.query, effectiveLimit, JSON.stringify(scored.map((e) => e.cmd.id)))
      }
    }

    // Re-rank by blending semantic position with usage frequency. Cache stores
    // the stable semantic ordering; boost is applied fresh on every search so
    // it reflects current usage without invalidating the cache.
    if (Object.keys(usageMap).length > 0) {
      const boostedIds = applyUsageBoost(
        scored.map((e) => e.cmd.id),
        usageMap,
      )
      const idToEntry = new Map(scored.map((e) => [e.cmd.id, e]))
      scored = boostedIds
        .map((id, i) => {
          const e = idToEntry.get(id)
          return e ? {cmd: e.cmd, score: i} : null
        })
        .filter((e): e is ScoredEntry => e !== null)
    }

    const results = scored.map((entry) => {
      const {cmd} = entry
      const configuredId = toConfiguredId(cmd.id, this.config)
      const usageOverride = cmd.usage
      const visibleArgs = Object.values(cmd.args ?? {}).filter((a) => !a.hidden)
      const argList = visibleArgs.map((a) => (a.required ? `<${a.name}>` : `[${a.name}]`)).join(' ')
      const usage = usageOverride
        ? Array.isArray(usageOverride)
          ? usageOverride.join('\n')
          : usageOverride
        : [configuredId, argList].filter(Boolean).join(' ')
      const args = visibleArgs.map((a) => ({
        [a.name]: {description: a.description ?? '', required: a.required ?? false, type: 'string'},
      }))
      const flags = Object.values(cmd.flags ?? {})
        .filter((f) => !f.hidden)
        .map((f) => ({
          [f.name]: {
            description: f.summary ?? f.description ?? '',
            required: f.required ?? false,
            type: f.type === 'boolean' ? 'boolean' : 'string',
          },
        }))
      return {
        args,
        command: usage,
        commandId: configuredId,
        description: cmd.summary ?? cmd.description ?? '',
        flags,
      }
    })

    if (!this.jsonEnabled()) {
      this._printResults(scored, results, {compact: flags.compact ?? false, details: flags.details})
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

  private _printResults(
    scored: Array<{cmd: Command.Loadable; score: number}>,
    results: Array<{[key: string]: unknown; command: string; commandId: string; description: string}>,
    flags: {compact: boolean; details: boolean},
  ): void {
    if (results.length === 0) return

    if (flags.compact) {
      for (const result of results) {
        this.log(result.commandId)
      }

      return
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
}
