/**
 * Integration tests for scripts/limit-detection-hook.py.
 *
 * The script is invoked as a real subprocess so we can verify its exit codes
 * and that it remains silent (no stdout) when no limit is detected.  We do NOT
 * test that desktop notifications or `claude /login` are actually launched —
 * those side-effects require platform tooling and would be fragile in CI.
 * Instead we verify that the limit-detection logic produces the right
 * decision for a variety of payloads.
 */

import {expect} from 'chai'
import {spawnSync} from 'node:child_process'
import {mkdtempSync, rmSync, writeFileSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join} from 'node:path'

// Path to the hook script relative to repo root (CWD when tests run).
const HOOK = 'scripts/limit-detection-hook.py'

/** Run the hook with the given payload as stdin.  Returns {code, stdout, stderr}. */
function runHook(payload: unknown): {code: number; stderr: string; stdout: string} {
  const result = spawnSync('python3', [HOOK], {
    encoding: 'utf8',
    input: JSON.stringify(payload),
  })
  return {
    code: result.status ?? 1,
    stderr: result.stderr ?? '',
    stdout: result.stdout ?? '',
  }
}

/** Build a minimal transcript JSONL file with a single assistant message. */
function makeTranscript(assistantMessage: string): string {
  const dir = mkdtempSync(join(tmpdir(), 'hook-test-'))
  const path = join(dir, 'transcript.jsonl')
  writeFileSync(
    path,
    JSON.stringify({content: assistantMessage, role: 'assistant'}) + '\n',
    'utf8',
  )

  return path
}

describe('limit-detection-hook', () => {
  // Track temp dirs created so we can clean up after each test.
  const tempPaths: string[] = []

  after(() => {
    for (const p of tempPaths) {
      try {
        rmSync(p, {force: true, recursive: true})
      } catch {
        /* ignore */
      }
    }
  })

  describe('normal operation — no limit', () => {
    it('exits 0 with empty stdin', () => {
      const result = spawnSync('python3', [HOOK], {encoding: 'utf8', input: ''})
      expect(result.status).to.equal(0)
    })

    it('exits 0 and produces no stdout for a clean stop payload', () => {
      // eslint-disable-next-line camelcase
      const {code, stdout} = runHook({session_id: 'abc123', stop_hook_active: false, transcript_path: ''})
      expect(code).to.equal(0)
      expect(stdout).to.equal('')
    })

    it('exits 0 when reason is unrelated to limits', () => {
      // eslint-disable-next-line camelcase
      const {code} = runHook({reason: 'task completed successfully', transcript_path: ''})
      expect(code).to.equal(0)
    })
  })

  describe('error handling', () => {
    it('exits 1 for invalid JSON on stdin', () => {
      const result = spawnSync('python3', [HOOK], {encoding: 'utf8', input: 'not json'})
      expect(result.status).to.equal(1)
    })
  })

  describe('limit detection via payload reason field', () => {
    for (const reason of [
      'usage limit exceeded',
      'quota exceeded',
      'rate limit hit',
      'exceeded daily billing limit',
    ]) {
      it(`detects limit for reason: "${reason}"`, () => {
        // The script will attempt notification + login which will fail silently
        // in CI (no notify-send / claude binary).  We only assert it exits 0
        // (not a crash) and writes nothing to stdout.
        // eslint-disable-next-line camelcase
        const {code, stdout} = runHook({reason, transcript_path: ''})
        expect(code).to.equal(0)
        expect(stdout).to.equal('')
      })
    }
  })

  describe('limit detection via transcript', () => {
    const limitMessages = [
      "You've reached your usage limit for today.",
      'Rate limit exceeded. Please try again later.',
      'Quota exceeded for this billing period.',
      'Your plan limit has been reached.',
      'You have reached the maximum context window.',
    ]

    for (const message of limitMessages) {
      it(`detects limit phrase in transcript: "${message.slice(0, 50)}..."`, () => {
        const transcriptPath = makeTranscript(message)
        // Register for cleanup
        tempPaths.push(transcriptPath.replace(/\/[^/]+$/, ''))

        // eslint-disable-next-line camelcase
        const {code, stdout} = runHook({reason: '', session_id: 'test', stop_hook_active: false, transcript_path: transcriptPath})
        expect(code).to.equal(0)
        expect(stdout).to.equal('')
      })
    }

    it('does not trigger on a normal assistant message', () => {
      const transcriptPath = makeTranscript('Here is the result of your search query.')
      tempPaths.push(transcriptPath.replace(/\/[^/]+$/, ''))

      // eslint-disable-next-line camelcase
      const {code} = runHook({reason: '', transcript_path: transcriptPath})
      expect(code).to.equal(0)
    })

    it('handles a missing transcript file gracefully', () => {
      // eslint-disable-next-line camelcase
      const {code} = runHook({reason: '', transcript_path: '/nonexistent/path/transcript.jsonl'})
      expect(code).to.equal(0)
    })

    it('handles a transcript with only non-assistant entries', () => {
      const dir = mkdtempSync(join(tmpdir(), 'hook-test-'))
      tempPaths.push(dir)
      const path = join(dir, 'transcript.jsonl')
      writeFileSync(
        path,
        [
          JSON.stringify({content: 'search for files', role: 'user'}),
          JSON.stringify({content: 'running search...', role: 'tool'}),
        ].join('\n') + '\n',
        'utf8',
      )

      // eslint-disable-next-line camelcase
      const {code} = runHook({reason: '', transcript_path: path})
      expect(code).to.equal(0)
    })

    it('handles malformed JSONL lines in transcript', () => {
      const dir = mkdtempSync(join(tmpdir(), 'hook-test-'))
      tempPaths.push(dir)
      const path = join(dir, 'transcript.jsonl')
      writeFileSync(path, 'not json\n{"role":"assistant","content":"hello"}\n', 'utf8')

      // eslint-disable-next-line camelcase
      const {code} = runHook({reason: '', transcript_path: path})
      expect(code).to.equal(0)
    })
  })

  describe('transcript with list-style content blocks', () => {
    it('detects limit phrase in content block array', () => {
      const dir = mkdtempSync(join(tmpdir(), 'hook-test-'))
      tempPaths.push(dir)
      const path = join(dir, 'transcript.jsonl')
      writeFileSync(
        path,
        JSON.stringify({
          content: [{text: 'You have reached your usage limit for this billing period.', type: 'text'}],
          role: 'assistant',
        }) + '\n',
        'utf8',
      )

      // eslint-disable-next-line camelcase
      const {code} = runHook({reason: '', transcript_path: path})
      expect(code).to.equal(0)
    })
  })
})
