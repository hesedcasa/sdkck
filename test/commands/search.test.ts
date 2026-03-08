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

  return {cmd, output: () => lines.join('\n')}
}

/**
 * Creates a minimal mock sampling client that simulates LLM sampling responses.
 * Returns a predefined list of command IDs as if the LLM ranked them.
 */
function makeMockSamplingClient(resultIds: string[]): Search['_anthropicClient'] {
  return {
    messages: {
      stream: () => ({
        finalMessage: async () => ({
          content: [{text: JSON.stringify(resultIds), type: 'text'}],
        }),
      }),
    },
  }
}

describe('search', () => {
  describe('fuzzy matching (no LLM client)', () => {
    it('finds commands matching a query', async () => {
      const {cmd, output} = makeSearch(['help'])
      await cmd.run()
      expect(output()).to.contain('help')
      expect(output()).to.match(/Found \d+ commands? matching "help"/)
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
      expect(output()).to.contain('No commands found')
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
  })

  describe('LLM sampling search (with mock sampling client)', () => {
    it('uses LLM results when a sampling client is injected', async () => {
      const {cmd, output} = makeSearch(['help'])
      cmd._anthropicClient = makeMockSamplingClient(['help'])
      await cmd.run()
      expect(output()).to.contain('help')
      expect(output()).to.match(/Found \d+ commands? matching "help"/)
    })

    it('respects LLM ordering — first result appears first in output', async () => {
      const {cmd, output} = makeSearch(['anything'])
      // LLM ranks 'update' above 'help'
      cmd._anthropicClient = makeMockSamplingClient(['update', 'help'])
      await cmd.run()
      const lines = output()
        .split('\n')
        .filter((l) => l.trim().length > 0)
      // lines[0] is "Found N commands..." header, lines[1] is the top-ranked result
      expect(lines[1]).to.contain('update')
    })

    it('reports no matches when LLM returns an empty array', async () => {
      const {cmd, output} = makeSearch(['zzz'])
      cmd._anthropicClient = makeMockSamplingClient([])
      await cmd.run()
      expect(output()).to.contain('No commands found')
    })

    it('skips unknown command IDs returned by LLM', async () => {
      const {cmd, output} = makeSearch(['help'])
      // LLM hallucinated a non-existent command ID alongside a valid one
      cmd._anthropicClient = makeMockSamplingClient(['nonexistent-command', 'help'])
      await cmd.run()
      expect(output()).to.contain('help')
      expect(output()).to.not.contain('nonexistent-command')
    })

    it('falls back to fuzzy matching when sampling client throws', async () => {
      const {cmd, output} = makeSearch(['updt'])
      cmd._anthropicClient = {
        messages: {
          stream: () => ({
            async finalMessage() {
              throw new Error('LLM unavailable')
            },
          }),
        },
      }
      await cmd.run()
      // Fuzzy fallback should still find 'update' for 'updt'
      expect(output()).to.contain('update')
    })
  })
})
