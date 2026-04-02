import {expect} from 'chai'

import Search from '../../src/commands/search.js'

type MockCommand = {
  description?: string
  hidden: boolean
  id: string
  pluginName: string
  summary?: string
}

const FIXTURE_COMMANDS: MockCommand[] = [
  {hidden: false, id: 'help', pluginName: '@oclif/plugin-help', summary: 'Display help for sdkck.'},
  {hidden: false, id: 'update', pluginName: '@oclif/plugin-update', summary: 'Update the sdkck CLI.'},
  {hidden: false, id: 'search', pluginName: 'sdkck', summary: 'Search for available commands'},
  {hidden: false, id: 'plugins install', pluginName: '@oclif/plugin-plugins', summary: 'Install a plugin.'},
  {hidden: false, id: 'plugins uninstall', pluginName: '@oclif/plugin-plugins', summary: 'Removes a plugin.'},
  {hidden: false, id: 'jira auth add ', pluginName: '@oclif/jira', summary: 'Add Atlassian authentication'},
  {hidden: false, id: 'jira issue get', pluginName: '@oclif/jira', summary: 'Get details of a specific issue'},
]

function makeSearch(argv: string[]): {cmd: Search; output: () => string} {
  const lines: string[] = []
  const config = {
    bin: 'sdkck',
    commands: FIXTURE_COMMANDS,
    runHook: async () => ({failures: [], successes: []}),
    topicSeparator: ' ',
  } as never
  const cmd = new Search(argv, config)
  cmd.log = (message = '') => {
    lines.push(String(message))
  }

  // Prevent any real OpenAI call; tests that need LLM inject _llmClient directly
  ;(cmd as unknown as {_createOpenAIClient: () => null})._createOpenAIClient = () => null

  return {cmd, output: () => lines.join('\n')}
}

function makeSearchJson(argv: string[]): {cmd: Search; output: () => string} {
  const {cmd, output} = makeSearch([...argv, '--json'])
  // jsonEnabled() checks for the flag in parsed args, but oclif sets it via a
  // property that the base Command exposes — override it for unit tests.
  ;(cmd as unknown as {jsonEnabled: () => boolean}).jsonEnabled = () => true
  return {cmd, output}
}

/**
 * Creates a minimal mock sampling client that simulates LLM sampling responses.
 * Returns a predefined list of command IDs as if the LLM ranked them.
 */
function makeMockSamplingClient(resultIds: string[]): Search['_llmClient'] {
  return {
    chat: {
      completions: {
        create: async () => ({
          choices: [{message: {content: JSON.stringify(resultIds)}}],
        }),
      },
    },
  }
}

describe('search', () => {
  describe('fuzzy matching (no LLM client)', () => {
    it('finds commands matching a query', async () => {
      const {cmd, output} = makeSearch(['help'])
      await cmd.run()
      expect(output()).to.contain('help')
      expect(output()).to.match(/Found \d+ commands?:/)
    })

    it('ranks exact matches above fuzzy matches', async () => {
      const {cmd, output} = makeSearch(['help'])
      await cmd.run()
      const lines = output()
        .split('\n')
        .filter((l) => l.trim().length > 0)
      // lines[0] is the "Found N commands..." header, lines[1] should be the best match
      expect(lines[1]).to.contain('help')
    })

    it('matches fuzzy abbreviations', async () => {
      const {cmd, output} = makeSearch(['updt'])
      await cmd.run()
      expect(output()).to.contain('update')
    })

    it('reports no matches for unknown query', async () => {
      const {cmd, output} = makeSearch(['zzzznonexistent'])
      await cmd.run()
      expect(output()).to.equal('')
    })

    it('matches by plugin name', async () => {
      const {cmd, output} = makeSearch(['plugin-update'])
      await cmd.run()
      expect(output()).to.contain('update')
    })

    it('excludes @oclif/plugin-plugins commands', async () => {
      const {cmd, output} = makeSearch(['plugins install'])
      await cmd.run()
      // Results are filtered but the query appears in the "No commands found" message,
      // so check that no command ID line lists 'plugins install' as a match
      expect(output().split('\n')).to.not.include('plugins install')
    })

    it('finds atlassian commands by topic prefix', async () => {
      const {cmd, output} = makeSearch(['atlassian authenticate'])
      await cmd.run()
      expect(output()).to.contain('jira auth add')
    })

    it('matches deep multi-word command by keyword', async () => {
      const {cmd, output} = makeSearch(['atlassian jira issue get'])
      await cmd.run()
      expect(output()).to.contain('jira issue get')
    })

    it('matches deep multi-word command by keyword', async () => {
      const {cmd, output} = makeSearch(['jira issue'])
      await cmd.run()
      expect(output()).to.contain('jira issue get')
    })
  })

  describe('LLM sampling search (with mock sampling client)', () => {
    it('uses LLM results when a sampling client is injected', async () => {
      const {cmd, output} = makeSearch(['help'])
      cmd._llmClient = makeMockSamplingClient(['help'])
      await cmd.run()
      expect(output()).to.contain('help')
      expect(output()).to.match(/Found \d+ commands?:/)
    })

    it('respects LLM ordering — first result appears first in output', async () => {
      const {cmd, output} = makeSearch(['anything'])
      // LLM ranks 'update' above 'help'
      cmd._llmClient = makeMockSamplingClient(['update', 'help'])
      await cmd.run()
      const lines = output()
        .split('\n')
        .filter((l) => l.trim().length > 0)
      // lines[0] is "Found N commands..." header, lines[1] is the top-ranked result
      expect(lines[1]).to.contain('update')
    })

    it('reports no matches when LLM returns an empty array', async () => {
      const {cmd, output} = makeSearch(['zzz'])
      cmd._llmClient = makeMockSamplingClient([])
      await cmd.run()
      expect(output()).to.equal('')
    })

    it('skips unknown command IDs returned by LLM', async () => {
      const {cmd, output} = makeSearch(['help'])
      // LLM hallucinated a non-existent command ID alongside a valid one
      cmd._llmClient = makeMockSamplingClient(['nonexistent-command', 'help'])
      await cmd.run()
      expect(output()).to.contain('help')
      expect(output()).to.not.contain('nonexistent-command')
    })

    it('falls back to fuzzy matching when sampling client throws', async () => {
      const {cmd, output} = makeSearch(['updt'])
      cmd._llmClient = {
        chat: {
          completions: {
            async create() {
              throw new Error('LLM unavailable')
            },
          },
        },
      }
      await cmd.run()
      // Fuzzy fallback should still find 'update' for 'updt'
      expect(output()).to.contain('update')
    })
  })

  describe('--json output', () => {
    it('returns a results array with command, description, plugin fields', async () => {
      const {cmd} = makeSearchJson(['help'])
      const result = await cmd.run()
      expect(result).to.be.an('array')
      expect(result.length).to.be.greaterThan(0)
      const first = result[0]
      expect(first).to.include.keys(['command', 'description'])
    })

    it('returns empty results array when no commands match', async () => {
      const {cmd} = makeSearchJson(['zzzznonexistent'])
      const result = await cmd.run()
      expect(result).to.deep.equal([])
    })

    it('does not log human-readable output when --json is active', async () => {
      const {cmd, output} = makeSearchJson(['help'])
      await cmd.run()
      expect(output()).to.equal('')
    })

    it('includes the correct command in results', async () => {
      const {cmd} = makeSearchJson(['update'])
      const result = await cmd.run()
      const commands = result.map((r) => r.command)
      expect(commands.some((c) => c.startsWith('update'))).to.be.true
    })
  })

  describe('--limit flag', () => {
    it('caps results to the given limit', async () => {
      const {cmd} = makeSearch(['help', '--limit', '1'])
      const result = await cmd.run()
      expect(result.length).to.be.at.most(1)
    })

    it('defaults to 5 results', async () => {
      const {cmd} = makeSearch(['e'])
      const result = await cmd.run()
      expect(result.length).to.be.at.most(5)
    })
  })
})
