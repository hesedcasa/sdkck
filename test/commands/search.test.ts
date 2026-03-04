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

describe('search', () => {
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
