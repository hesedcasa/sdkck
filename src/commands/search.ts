import {Args, Command, CommandHelp, Flags, toConfiguredId} from '@oclif/core'

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

  async run(): Promise<void> {
    const {args, flags} = await this.parse(Search)
    const {query} = args

    const scored = this.config.commands
      .filter((c) => !c.hidden && c.pluginName !== '@oclif/plugin-plugins')
      .map((c) => {
        const {id} = c
        const summary = c.summary ?? c.description ?? ''
        const plugin = c.pluginName ?? ''
        const score = bestScore(query, id, summary, plugin)
        return {cmd: c, score}
      })
      .filter((entry) => entry.score >= 0)
      .sort((a, b) => a.score - b.score || a.cmd.id.localeCompare(b.cmd.id))

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
}
