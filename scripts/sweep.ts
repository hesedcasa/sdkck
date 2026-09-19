import {cleanupRun, RUN_LABEL, sweepStale} from '../test/e2e/fixtures.js'

// With E2E_RUN_ID set, this process shares a fixture label with the mocha run
// that just finished, so it can reclaim that run's fixtures directly. That is
// what covers a mocha killed before its `after` hooks ran — the job timeout in
// the CI workflow, or a local Ctrl-C — whose fixtures are far too young for
// sweepStale's one-hour cutoff to touch.
if (process.env.E2E_RUN_ID) {
  await cleanupRun()
  console.log(`Cleaned up fixtures labelled "${RUN_LABEL}".`)
}

const deleted = await sweepStale()
console.log(`Swept ${deleted} stale e2e fixture(s).`)
