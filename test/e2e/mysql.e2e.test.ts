import {expect} from 'chai'

import {requireMysqlEnv, RUN_ID} from './fixtures.js'
import {createConfigDir, removeConfigDir, runSdkck, runSdkckJson} from './helpers.js'

type QueryResult = {data: {result: Array<Record<string, unknown>>}; success: boolean}

/**
 * The mysql leg: the local `@hesed/mysql` build, installed into the throwaway
 * home, driving the Docker MySQL server scripts/e2e.sh started — the same
 * image the plugin's own e2e suite uses, seeded with the same fixture schema.
 */
describe('e2e: mysql plugin via sdkck', () => {
  let configDir: string
  const scratch = `e2e_host_${RUN_ID.replaceAll('-', '_')}`

  before(async () => {
    requireMysqlEnv()
    configDir = await createConfigDir('mysql')
  })

  after(async () => {
    try {
      await runSdkck(['mysql', 'query', `DROP TABLE IF EXISTS ${scratch}`, '--skip-confirmation'], configDir)
    } catch {
      // Best-effort: the container is discarded anyway.
    } finally {
      await removeConfigDir(configDir)
    }
  })

  it('authenticates with the default profile', async () => {
    const {code, stderr} = await runSdkck(['mysql', 'auth', 'test'], configDir)
    expect(code).to.equal(0)
    expect(stderr).to.contain('successful')
  })

  it('fails auth test on bad credentials', async () => {
    const {code} = await runSdkck(['mysql', 'auth', 'test', '-p', 'broken'], configDir)
    expect(code).to.not.equal(0)
  })

  it('lists the fixture databases', async () => {
    const payload = await runSdkckJson<{data: {databases: string[]}}>(['mysql', 'databases', '--json'], configDir)
    expect(payload.data.databases).to.include.members(['mq_e2e', 'mq_e2e_alt', 'mq_e2e_empty'])
  })

  it('lists the fixture tables', async () => {
    const payload = await runSdkckJson<{data: {tables: string[]}}>(['mysql', 'tables', '--json'], configDir)
    expect(payload.data.tables).to.include.members(['users', 'orders'])
  })

  it('reads seeded rows', async () => {
    const payload = await runSdkckJson<QueryResult>(
      ['mysql', 'query', 'SELECT id, email FROM users ORDER BY id', '--json'],
      configDir,
    )
    expect(payload.data.result).to.have.lengthOf(5)
    expect(payload.data.result[0]).to.include({email: 'ada@example.com'})
  })

  it('describes a fixture table', async () => {
    const payload = await runSdkckJson<{data: {structure: Array<{Field: string}>}}>(
      ['mysql', 'describe-table', 'users', '--json'],
      configDir,
    )
    expect(payload.data.structure.map((column) => column.Field)).to.include('email')
  })

  it('writes through a scratch table lifecycle', async () => {
    // Writes carry --skip-confirmation: the plugin's safety layer asks for
    // confirmation on any mutating statement, and a subprocess has no TTY.
    await runSdkckJson<QueryResult>(
      ['mysql', 'query', `CREATE TABLE ${scratch} (id INT PRIMARY KEY)`, '--skip-confirmation', '--json'],
      configDir,
    )

    await runSdkckJson<QueryResult>(
      ['mysql', 'query', `INSERT INTO ${scratch} (id) VALUES (1), (2)`, '--skip-confirmation', '--json'],
      configDir,
    )

    const selected = await runSdkckJson<QueryResult>(
      ['mysql', 'query', `SELECT id FROM ${scratch} ORDER BY id`, '--json'],
      configDir,
    )
    expect(selected.data.result).to.have.lengthOf(2)

    await runSdkckJson<QueryResult>(
      ['mysql', 'query', `DROP TABLE ${scratch}`, '--skip-confirmation', '--json'],
      configDir,
    )

    const payload = await runSdkckJson<{data: {tables: string[]}}>(['mysql', 'tables', '--json'], configDir)
    expect(payload.data.tables).to.not.include(scratch)
  })

  it('rejects invalid SQL without crashing', async () => {
    const {code, stderr} = await runSdkck(['mysql', 'query', 'SELCT 1'], configDir)
    expect(code).to.not.equal(0)
    expect(stderr).to.not.be.empty
  })
})
