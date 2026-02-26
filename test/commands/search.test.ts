import {runCommand} from '@oclif/test'
import {expect} from 'chai'

describe('search', () => {
  it('finds commands matching a query', async () => {
    const {stdout} = await runCommand(['search', 'help'])
    expect(stdout).to.contain('help')
    expect(stdout).to.match(/Found \d+ commands? matching "help"/)
  })

  it('ranks exact matches above fuzzy matches', async () => {
    const {stdout} = await runCommand(['search', 'help'])
    // First non-empty line after the header should be "help" (exact match ranked first)
    const lines = stdout.split('\n').filter((l) => l.trim().length > 0)
    // lines[0] is the "Found N commands..." header, lines[1] should be the best match
    expect(lines[1]).to.contain('help')
  })

  it('matches fuzzy abbreviations', async () => {
    const {stdout} = await runCommand(['search', 'plgn'])
    expect(stdout).to.contain('plugins')
  })

  it('reports no matches for unknown query', async () => {
    const {stdout} = await runCommand(['search', 'zzzznonexistent'])
    expect(stdout).to.contain('No commands found')
  })

  it('matches by plugin name', async () => {
    const {stdout} = await runCommand(['search', 'plugin-update'])
    expect(stdout).to.contain('update')
  })

  it('excludes @oclif/plugin-plugins commands', async () => {
    const {stdout} = await runCommand(['search', 'plugins install'])
    expect(stdout).to.not.contain('plugins install')
  })
})
