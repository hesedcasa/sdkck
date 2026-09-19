import {expect} from 'chai'

import {requirePsqlEnv, RUN_ID} from './fixtures.js'
import {createConfigDir, removeConfigDir, runSdkck, runSdkckJson} from './helpers.js'

type QueryResult = {data: {result: Array<Record<string, unknown>>}; success: boolean}

/**
 * The psql leg: the local `@hesed/psql` build, installed into the throwaway
 * home, driving the Docker PostgreSQL server scripts/e2e.sh started — the
 * same image the plugin's own e2e suite uses, seeded with the same fixture
 * schema.
 */
describe('e2e: psql plugin via sdkck', () => {
  let configDir: string
  const scratch = `e2e_host_${RUN_ID.replaceAll('-', '_')}`

  before(async () => {
    requirePsqlEnv()
    configDir = await createConfigDir('psql')
  })

  after(async () => {
    try {
      await runSdkck(['psql', 'query', `DROP TABLE IF EXISTS ${scratch}`, '--skip-confirmation'], configDir)
    } catch {
      // Best-effort: the container is discarded anyway.
    } finally {
      await removeConfigDir(configDir)
    }
  })

  it('authenticates with the default profile', async () => {
    const {code, stderr} = await runSdkck(['psql', 'auth', 'test'], configDir)
    expect(code).to.equal(0)
    expect(stderr).to.contain('successful')
  })

  it('fails auth test on bad credentials', async () => {
    const {code} = await runSdkck(['psql', 'auth', 'test', '-p', 'broken'], configDir)
    expect(code).to.not.equal(0)
  })

  it('lists the fixture databases', async () => {
    const payload = await runSdkckJson<{data: {databases: string[]}}>(['psql', 'databases', '--json'], configDir)
    expect(payload.data.databases).to.include('pg_e2e')
  })

  it('lists the fixture tables', async () => {
    const payload = await runSdkckJson<{data: {tables: string[]}}>(['psql', 'tables', '--json'], configDir)
    expect(payload.data.tables).to.include.members(['users', 'orders'])
  })

  it('reads seeded rows', async () => {
    const payload = await runSdkckJson<QueryResult>(
      ['psql', 'query', 'SELECT id, email FROM users ORDER BY id', '--json'],
      configDir,
    )
    expect(payload.data.result).to.have.lengthOf.at.least(1)
    expect(payload.data.result[0]).to.have.property('email')
  })

  it('describes a fixture table', async () => {
    const payload = await runSdkckJson<{data: {structure: Array<{column_name: string}>}}>(
      ['psql', 'describe-table', 'orders', '--json'],
      configDir,
    )
    expect(payload.data.structure.map((column) => column.column_name)).to.include('user_id')
  })

  it('writes through a scratch table lifecycle', async () => {
    // Writes carry --skip-confirmation: the plugin's safety layer asks for
    // confirmation on any mutating statement, and a subprocess has no TTY.
    await runSdkckJson<QueryResult>(
      ['psql', 'query', `CREATE TABLE ${scratch} (id INT PRIMARY KEY)`, '--skip-confirmation', '--json'],
      configDir,
    )

    await runSdkckJson<QueryResult>(
      ['psql', 'query', `INSERT INTO ${scratch} (id) VALUES (1), (2)`, '--skip-confirmation', '--json'],
      configDir,
    )

    const selected = await runSdkckJson<QueryResult>(
      ['psql', 'query', `SELECT id FROM ${scratch} ORDER BY id`, '--json'],
      configDir,
    )
    expect(selected.data.result).to.have.lengthOf(2)

    await runSdkckJson<QueryResult>(
      ['psql', 'query', `DROP TABLE ${scratch}`, '--skip-confirmation', '--json'],
      configDir,
    )

    const payload = await runSdkckJson<{data: {tables: string[]}}>(['psql', 'tables', '--json'], configDir)
    expect(payload.data.tables).to.not.include(scratch)
  })

  it('rejects invalid SQL without crashing', async () => {
    const {code, stderr} = await runSdkck(['psql', 'query', 'SELCT 1'], configDir)
    expect(code).to.not.equal(0)
    expect(stderr).to.not.be.empty
  })
})
