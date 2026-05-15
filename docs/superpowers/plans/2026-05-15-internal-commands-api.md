# Internal Commands API Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add `sdkck.commands.list()` + `sdkck.commands.run()` — a typed, frozen, policy-gated programmatic API so oclif plugins loaded into sdkck can discover and invoke commands without re-implementing permission and sensitive-command filtering.

**Architecture:** A single new module `src/api.ts` owns the public surface (types, `sdkck` object, helpers). It reuses `permission-config.ts` for the allowlist, defines a small sensitive-segment denylist plus a `static sensitive` opt-in, and consolidates the `buildArgv` + output-capture execution helper currently duplicated in `mcp-server.ts`. The MCP server is refactored to call through `sdkck.commands.run` so policy logic lives in exactly one place.

**Tech Stack:** TypeScript (ESM, ES2022, strict), oclif v4, mocha + chai, Node 22.

**Spec:** `docs/superpowers/specs/2026-05-15-internal-commands-api-design.md`

---

## File Structure

**New files:**
- `src/api.ts` — public types, `sdkck` object, `list()`, `run()`, sensitive classification, argv builder, execution helper.
- `test/api.test.ts` — tests for `sdkck.commands.list`.
- `test/api-run.test.ts` — tests for `sdkck.commands.run`.

**Modified files:**
- `src/permission-config.ts` — extract `isCommandAllowed(commandId, config, separator)` helper used by both the init hook and the new API.
- `src/api-dynamic-commands.ts` — mark generated classes with `static __sdkckDynamic = true`.
- `src/commands/api/auth.ts` — add `static sensitive = true`.
- `src/mcp-server.ts` — delete local `buildArgv` + `runCommand`, delegate to `sdkck.commands.run`.
- `src/hooks/init/apply-permission.ts` — switch its inline rule loop to the new `isCommandAllowed` helper (DRY).
- `src/index.ts` — `export {sdkck, …types}` from `./api.js`.
- `test/permission-config.test.ts` — tests for `isCommandAllowed`.
- `test/mcp-server.test.ts` — update so it still passes after the refactor.
- `README.md` — short "Programmatic API" section under "Built-in Features".
- `docs/superpowers/specs/2026-05-15-internal-commands-api-design.md` — fix the consumer example to `await` async calls.

---

## Task 0: Spec correction — async usage in consumer example

**Files:**
- Modify: `docs/superpowers/specs/2026-05-15-internal-commands-api-design.md`

The current "Consumer Shape" example has `const cmds = sdkck.commands.list(this.config)` without `await`. Implementation must be async (we need `cmd.load()` to read static class props). Fix the example.

- [ ] **Step 1: Update the consumer example**

Edit the "Consumer Shape" code block to:

```ts
import {sdkck} from 'sdkck'

// inside a command/hook in another oclif plugin:
const cmds = await sdkck.commands.list(this.config)
// → Array<CommandInfo>

const result = await sdkck.commands.run(this.config, 'api:list', {json: true})
// → {output: string, error?: string}
```

- [ ] **Step 2: Commit**

```bash
git add docs/superpowers/specs/2026-05-15-internal-commands-api-design.md
git commit -m "docs: clarify sdkck.commands.list is async in spec example"
```

---

## Task 1: Extract `isCommandAllowed` helper in `permission-config.ts`

**Files:**
- Modify: `src/permission-config.ts`
- Test: `test/permission-config.test.ts`

Add a single function that answers "given a command id, is it allowed by the current rules?" — encapsulating the first-match-wins loop currently inlined in `apply-permission.ts`. Both the init hook and the new API will use this.

- [ ] **Step 1: Write the failing tests**

Append to `test/permission-config.test.ts`:

```ts
import {isCommandAllowed, type PermissionConfig} from '../src/permission-config.js'

describe('isCommandAllowed', () => {
  it('allows commands when no rules exist', () => {
    const config: PermissionConfig = {rules: []}
    expect(isCommandAllowed('jira issue create', config)).to.be.true
  })

  it('disallows when first matching rule is disallow', () => {
    const config: PermissionConfig = {
      rules: [{action: 'disallow', pattern: 'jira *'}],
    }
    expect(isCommandAllowed('jira issue', config)).to.be.false
  })

  it('allows when first matching rule is allow', () => {
    const config: PermissionConfig = {
      rules: [
        {action: 'allow', pattern: 'jira issue'},
        {action: 'disallow', pattern: 'jira *'},
      ],
    }
    expect(isCommandAllowed('jira issue', config)).to.be.true
  })

  it('first match wins — ignores later rules', () => {
    const config: PermissionConfig = {
      rules: [
        {action: 'disallow', pattern: '*'},
        {action: 'allow', pattern: 'jira issue'},
      ],
    }
    expect(isCommandAllowed('jira issue', config)).to.be.false
  })

  it('returns true for an unmatched command id', () => {
    const config: PermissionConfig = {
      rules: [{action: 'disallow', pattern: 'mysql *'}],
    }
    expect(isCommandAllowed('jira issue', config)).to.be.true
  })
})
```

- [ ] **Step 2: Run the test and verify it fails**

Run: `npx mocha --forbid-only "test/permission-config.test.ts"`
Expected: FAIL with "isCommandAllowed is not a function" (or similar import error).

- [ ] **Step 3: Implement `isCommandAllowed`**

Add to `src/permission-config.ts` (after `matchesPattern`):

```ts
/**
 * Returns true if a command id is allowed by the given permission config.
 * First matching rule wins. Commands with no matching rule are allowed.
 */
export function isCommandAllowed(commandId: string, config: PermissionConfig): boolean {
  for (const rule of config.rules) {
    if (matchesPattern(commandId, rule.pattern)) {
      return rule.action === 'allow'
    }
  }

  return true
}
```

- [ ] **Step 4: Run the test and verify it passes**

Run: `npx mocha --forbid-only "test/permission-config.test.ts"`
Expected: All tests pass.

- [ ] **Step 5: Refactor `apply-permission.ts` to use `isCommandAllowed`**

In `src/hooks/init/apply-permission.ts`, replace the three inline `for (const rule of permissionConfig.rules)` loops with calls to `isCommandAllowed`.

Replace the command-hiding loop:

```ts
for (const [id, command] of internalCommands) {
  const normalizedId = id.replaceAll(':', opts.config.topicSeparator)
  if (!isCommandAllowed(normalizedId, permissionConfig)) {
    command.hidden = true
  }
}
```

Replace the topic-hiding loop:

```ts
for (const [id, topic] of internalTopics) {
  const normalizedId = id.replaceAll(':', opts.config.topicSeparator)
  if (!isCommandAllowed(normalizedId, permissionConfig)) {
    topic.hidden = true
  }
}
```

Replace the invocation-block loop:

```ts
if (invokedId && !isCommandAllowed(invokedId, permissionConfig)) {
  process.stderr.write(`Command "${invokedId}" is not permitted.\n`)
  Errors.exit(2)
}
```

Update the imports at the top of the file:

```ts
import {isCommandAllowed, readPermissionConfig} from '../../permission-config.js'
```

(`matchesPattern` import is no longer needed.)

- [ ] **Step 6: Run the full test suite**

Run: `npm run test`
Expected: All tests pass (no regression in permission hook tests).

- [ ] **Step 7: Commit**

```bash
git add src/permission-config.ts src/hooks/init/apply-permission.ts test/permission-config.test.ts
git commit -m "refactor: extract isCommandAllowed helper for reuse"
```

---

## Task 2: Define types and sensitive classification in `src/api.ts`

**Files:**
- Create: `src/api.ts`
- Test: `test/api.test.ts`

Start the new module with just the types and the `isSensitiveCommand` helper. Nothing exported as `sdkck` yet — that comes next task.

- [ ] **Step 1: Write the failing test**

Create `test/api.test.ts`:

```ts
import {expect} from 'chai'

import {SENSITIVE_SEGMENTS, isSensitiveCommand} from '../src/api.js'

describe('SENSITIVE_SEGMENTS', () => {
  it('contains expected auth-related segments', () => {
    expect(SENSITIVE_SEGMENTS.has('auth')).to.be.true
    expect(SENSITIVE_SEGMENTS.has('login')).to.be.true
    expect(SENSITIVE_SEGMENTS.has('logout')).to.be.true
    expect(SENSITIVE_SEGMENTS.has('credential')).to.be.true
    expect(SENSITIVE_SEGMENTS.has('credentials')).to.be.true
    expect(SENSITIVE_SEGMENTS.has('secret')).to.be.true
    expect(SENSITIVE_SEGMENTS.has('secrets')).to.be.true
    expect(SENSITIVE_SEGMENTS.has('token')).to.be.true
    expect(SENSITIVE_SEGMENTS.has('tokens')).to.be.true
  })
})

describe('isSensitiveCommand', () => {
  it('returns true when class has static sensitive = true', () => {
    const CmdClass = class {static sensitive = true} as unknown as {sensitive?: boolean}
    expect(isSensitiveCommand('foo:bar', CmdClass)).to.be.true
  })

  it('returns false when class has static sensitive = false (escape hatch)', () => {
    const CmdClass = class {static sensitive = false} as unknown as {sensitive?: boolean}
    // id segment 'login' would normally match the pattern fallback
    expect(isSensitiveCommand('foo:login', CmdClass)).to.be.false
  })

  it('falls back to pattern match when sensitive is undefined', () => {
    const CmdClass = class {} as unknown as {sensitive?: boolean}
    expect(isSensitiveCommand('api:auth', CmdClass)).to.be.true
    expect(isSensitiveCommand('foo:login', CmdClass)).to.be.true
  })

  it('pattern match is per-segment (no substring match)', () => {
    const CmdClass = class {} as unknown as {sensitive?: boolean}
    expect(isSensitiveCommand('authority:list', CmdClass)).to.be.false
  })

  it('pattern match is case-insensitive', () => {
    const CmdClass = class {} as unknown as {sensitive?: boolean}
    expect(isSensitiveCommand('api:Auth', CmdClass)).to.be.true
  })

  it('returns false when neither flag nor pattern matches', () => {
    const CmdClass = class {} as unknown as {sensitive?: boolean}
    expect(isSensitiveCommand('api:list', CmdClass)).to.be.false
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx mocha --forbid-only "test/api.test.ts"`
Expected: FAIL — module `src/api.js` does not exist.

- [ ] **Step 3: Create `src/api.ts` with types + sensitive helper**

```ts
import type {Command} from '@oclif/core'

// ─── Public types ────────────────────────────────────────────────────────────

export interface CommandArg {
  name: string
  required: boolean
  description?: string
}

export interface CommandFlag {
  name: string
  type: 'boolean' | 'option'
  required: boolean
  multiple: boolean
  description?: string
}

export interface CommandInfo {
  id: string
  displayId: string
  summary?: string
  description?: string
  hidden: boolean
  pluginName?: string
  pluginType?: 'core' | 'user' | 'link' | 'jit'
  isDynamic: boolean
  isPermitted: boolean
  isSensitive: boolean
  args: CommandArg[]
  flags: CommandFlag[]
  aliases: string[]
  topic?: string
}

export interface ListCommandsOptions {
  includeHidden?: boolean
  includeDisallowed?: boolean
  includeSensitive?: boolean
  topic?: string
}

export interface RunCommandOptions {
  allowSensitive?: boolean
  allowDisallowed?: boolean
}

export interface RunCommandResult {
  output: string
  error?: string
}

export type SdkckExecutionDenialCode = 'permission_denied' | 'sensitive_denied' | 'command_not_found'

export class SdkckExecutionError extends Error {
  code: SdkckExecutionDenialCode
  commandId: string

  constructor(code: SdkckExecutionDenialCode, commandId: string, message: string) {
    super(message)
    this.name = 'SdkckExecutionError'
    this.code = code
    this.commandId = commandId
  }
}

// ─── Sensitive classification ────────────────────────────────────────────────

export const SENSITIVE_SEGMENTS: ReadonlySet<string> = new Set([
  'auth',
  'credential',
  'credentials',
  'login',
  'logout',
  'secret',
  'secrets',
  'token',
  'tokens',
])

/**
 * Classifies a command as sensitive.
 *
 * Precedence:
 *   1. If the class has `static sensitive` defined (boolean), that wins.
 *   2. Otherwise, return true iff any colon-separated segment of the id
 *      matches SENSITIVE_SEGMENTS (case-insensitive).
 */
export function isSensitiveCommand(
  commandId: string,
  CmdClass: {sensitive?: boolean} | typeof Command,
): boolean {
  const explicit = (CmdClass as {sensitive?: boolean}).sensitive
  if (typeof explicit === 'boolean') return explicit

  for (const segment of commandId.split(':')) {
    if (SENSITIVE_SEGMENTS.has(segment.toLowerCase())) return true
  }

  return false
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx mocha --forbid-only "test/api.test.ts"`
Expected: All tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/api.ts test/api.test.ts
git commit -m "feat(api): add types and sensitive-command classification"
```

---

## Task 3: Implement `sdkck.commands.list()`

**Files:**
- Modify: `src/api.ts`
- Modify: `test/api.test.ts`

Add the enumeration function with all filtering (hidden, permission, sensitive, topic) and proper handling of dynamic commands and load failures.

- [ ] **Step 1: Add a test-fixture helper to `test/api.test.ts`**

At the top of `test/api.test.ts`, after the existing imports, add:

```ts
import type {Command} from '@oclif/core'
import type {Config} from '@oclif/core/interfaces'

import {writePermissionConfig} from '../src/permission-config.js'
import {mkdtemp, rm} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'

interface CmdOverrides {
  id: string
  hidden?: boolean
  pluginName?: string
  pluginType?: 'core' | 'user' | 'link' | 'jit'
  args?: Record<string, unknown>
  flags?: Record<string, unknown>
  summary?: string
  description?: string
  aliases?: string[]
  staticProps?: Record<string, unknown>
}

function cmd(o: CmdOverrides): Command.Loadable {
  const CmdClass = class extends (class {} as unknown as typeof Command) {}
  for (const [k, v] of Object.entries(o.staticProps ?? {})) {
    ;(CmdClass as unknown as Record<string, unknown>)[k] = v
  }

  return {
    aliases: o.aliases ?? [],
    args: o.args ?? {},
    description: o.description ?? '',
    flags: o.flags ?? {},
    hidden: o.hidden ?? false,
    id: o.id,
    async load() {
      return CmdClass as unknown as typeof Command
    },
    pluginName: o.pluginName ?? 'sdkck',
    pluginType: o.pluginType ?? 'core',
    strict: true,
    summary: o.summary ?? '',
  } as unknown as Command.Loadable
}

function makeConfig(commands: Command.Loadable[], configDir: string): Config {
  return {
    commands,
    configDir,
    topicSeparator: ' ',
  } as unknown as Config
}
```

- [ ] **Step 2: Write the failing tests**

Append to `test/api.test.ts`:

```ts
import {sdkck} from '../src/api.js'

describe('sdkck.commands.list', () => {
  let configDir: string

  beforeEach(async () => {
    configDir = await mkdtemp(join(tmpdir(), 'sdkck-api-test-'))
  })

  afterEach(async () => {
    await rm(configDir, {recursive: true, force: true})
  })

  it('returns one entry per command with expected shape', async () => {
    const cfg = makeConfig(
      [
        cmd({id: 'api:list', summary: 'List specs'}),
        cmd({id: 'permission:list', summary: 'List rules'}),
      ],
      configDir,
    )

    const result = await sdkck.commands.list(cfg)

    expect(result).to.have.length(2)
    const apiList = result.find((c) => c.id === 'api:list')
    expect(apiList).to.exist
    expect(apiList?.displayId).to.equal('api list')
    expect(apiList?.summary).to.equal('List specs')
    expect(apiList?.topic).to.equal('api')
    expect(apiList?.isSensitive).to.be.false
    expect(apiList?.isPermitted).to.be.true
    expect(apiList?.isDynamic).to.be.false
  })

  it('excludes hidden commands by default; includeHidden returns them', async () => {
    const cfg = makeConfig(
      [cmd({id: 'a', hidden: false}), cmd({id: 'b', hidden: true})],
      configDir,
    )

    expect((await sdkck.commands.list(cfg)).map((c) => c.id)).to.deep.equal(['a'])
    expect((await sdkck.commands.list(cfg, {includeHidden: true})).map((c) => c.id)).to.deep.equal(['a', 'b'])
  })

  it('excludes sensitive commands by default', async () => {
    const cfg = makeConfig([cmd({id: 'api:list'}), cmd({id: 'api:auth'})], configDir)

    expect((await sdkck.commands.list(cfg)).map((c) => c.id)).to.deep.equal(['api:list'])

    const all = await sdkck.commands.list(cfg, {includeSensitive: true})
    expect(all.map((c) => c.id)).to.deep.equal(['api:auth', 'api:list'])
    expect(all.find((c) => c.id === 'api:auth')?.isSensitive).to.be.true
  })

  it('respects static sensitive = false escape hatch on a pattern-matched id', async () => {
    const cfg = makeConfig(
      [cmd({id: 'foo:login', staticProps: {sensitive: false}})],
      configDir,
    )

    const all = await sdkck.commands.list(cfg)
    expect(all.map((c) => c.id)).to.deep.equal(['foo:login'])
    expect(all[0].isSensitive).to.be.false
  })

  it('applies permission allowlist; includeDisallowed surfaces blocked with isPermitted=false', async () => {
    await writePermissionConfig(configDir, {rules: [{action: 'disallow', pattern: 'api list'}]})
    const cfg = makeConfig([cmd({id: 'api:list'}), cmd({id: 'api:remove'})], configDir)

    expect((await sdkck.commands.list(cfg)).map((c) => c.id)).to.deep.equal(['api:remove'])

    const all = await sdkck.commands.list(cfg, {includeDisallowed: true})
    expect(all.map((c) => c.id)).to.deep.equal(['api:list', 'api:remove'])
    expect(all.find((c) => c.id === 'api:list')?.isPermitted).to.be.false
  })

  it('filters by topic', async () => {
    const cfg = makeConfig(
      [cmd({id: 'api:list'}), cmd({id: 'api:remove'}), cmd({id: 'permission:list'})],
      configDir,
    )

    const result = await sdkck.commands.list(cfg, {topic: 'api'})
    expect(result.map((c) => c.id)).to.deep.equal(['api:list', 'api:remove'])
  })

  it('marks dynamic commands with isDynamic=true', async () => {
    const cfg = makeConfig(
      [cmd({id: 'petstore:getPet', staticProps: {__sdkckDynamic: true}})],
      configDir,
    )

    const all = await sdkck.commands.list(cfg)
    expect(all[0].isDynamic).to.be.true
  })

  it('does not crash when a single command fails to load', async () => {
    const broken = {
      aliases: [],
      args: {},
      flags: {},
      hidden: false,
      id: 'broken',
      async load() {
        throw new Error('boom')
      },
      pluginName: 'sdkck',
      pluginType: 'core',
      strict: true,
      summary: '',
    } as unknown as Command.Loadable

    const cfg = makeConfig([broken, cmd({id: 'ok'})], configDir)

    const result = await sdkck.commands.list(cfg)
    expect(result.map((c) => c.id)).to.deep.equal(['ok'])
  })

  it('freezes returned entries', async () => {
    const cfg = makeConfig([cmd({id: 'ok'})], configDir)
    const [entry] = await sdkck.commands.list(cfg)
    expect(Object.isFrozen(entry)).to.be.true
    expect(Object.isFrozen(entry.args)).to.be.true
    expect(Object.isFrozen(entry.flags)).to.be.true
  })

  it('sorts results by displayId', async () => {
    const cfg = makeConfig(
      [cmd({id: 'z:cmd'}), cmd({id: 'a:cmd'}), cmd({id: 'm:cmd'})],
      configDir,
    )

    const result = await sdkck.commands.list(cfg)
    expect(result.map((c) => c.displayId)).to.deep.equal(['a cmd', 'm cmd', 'z cmd'])
  })
})
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `npx mocha --forbid-only "test/api.test.ts"`
Expected: FAIL — `sdkck` import does not exist.

- [ ] **Step 4: Implement `sdkck.commands.list`**

Append to `src/api.ts`:

```ts
import type {Config} from '@oclif/core/interfaces'

import {toConfiguredId} from '@oclif/core'

import {fileLog} from './file-logger.js'
import {isCommandAllowed, readPermissionConfig} from './permission-config.js'

// ─── Internal helpers ────────────────────────────────────────────────────────

function mapArgs(rawArgs: Record<string, unknown> | undefined): CommandArg[] {
  if (!rawArgs) return []
  return Object.entries(rawArgs).map(([name, def]) => {
    const d = def as {description?: string; required?: boolean}
    return Object.freeze({
      description: d.description,
      name,
      required: Boolean(d.required),
    })
  })
}

function mapFlags(rawFlags: Record<string, unknown> | undefined): CommandFlag[] {
  if (!rawFlags) return []
  return Object.entries(rawFlags).map(([name, def]) => {
    const d = def as {description?: string; multiple?: boolean; required?: boolean; type?: string}
    return Object.freeze({
      description: d.description,
      multiple: Boolean(d.multiple),
      name,
      required: Boolean(d.required),
      type: d.type === 'boolean' ? ('boolean' as const) : ('option' as const),
    })
  })
}

async function toCommandInfo(
  loadable: import('@oclif/core').Command.Loadable,
  config: Config,
  permittedSeparator: string,
  permissionConfig: Awaited<ReturnType<typeof readPermissionConfig>>,
): Promise<CommandInfo | undefined> {
  let CmdClass: {sensitive?: boolean; __sdkckDynamic?: boolean} | undefined
  try {
    CmdClass = (await loadable.load()) as unknown as {sensitive?: boolean; __sdkckDynamic?: boolean}
  } catch (error) {
    fileLog(
      'error',
      `sdkck.commands.list: failed to load ${loadable.id}: ${error instanceof Error ? error.message : String(error)}`,
    )
    return undefined
  }

  const id = loadable.id
  const displayId = toConfiguredId(id, config)
  const normalizedForPermission = id.replaceAll(':', permittedSeparator)
  const isPermitted = isCommandAllowed(normalizedForPermission, permissionConfig)
  const isSensitive = isSensitiveCommand(id, CmdClass)
  const isDynamic = (CmdClass as {__sdkckDynamic?: boolean}).__sdkckDynamic === true
  const topic = id.includes(':') ? id.split(':')[0] : undefined

  const info: CommandInfo = {
    aliases: Object.freeze([...(loadable.aliases ?? [])]) as unknown as string[],
    args: Object.freeze(mapArgs(loadable.args as Record<string, unknown> | undefined)) as unknown as CommandArg[],
    description: loadable.description,
    displayId,
    flags: Object.freeze(mapFlags(loadable.flags as Record<string, unknown> | undefined)) as unknown as CommandFlag[],
    hidden: Boolean(loadable.hidden),
    id,
    isDynamic,
    isPermitted,
    isSensitive,
    pluginName: loadable.pluginName,
    pluginType: loadable.pluginType as CommandInfo['pluginType'],
    summary: loadable.summary,
    topic,
  }

  return Object.freeze(info)
}

// ─── Public surface ──────────────────────────────────────────────────────────

export const sdkck = {
  commands: {
    async list(config: Config, opts: ListCommandsOptions = {}): Promise<readonly CommandInfo[]> {
      const permissionConfig = await readPermissionConfig(config.configDir)
      const separator = config.topicSeparator ?? ' '

      const results: CommandInfo[] = []
      for (const loadable of config.commands) {
        if (opts.topic && !loadable.id.startsWith(`${opts.topic}:`) && loadable.id !== opts.topic) continue

        const info = await toCommandInfo(loadable, config, separator, permissionConfig)
        if (!info) continue

        if (!opts.includeHidden && info.hidden) continue
        if (!opts.includeDisallowed && !info.isPermitted) continue
        if (!opts.includeSensitive && info.isSensitive) continue

        results.push(info)
      }

      results.sort((a, b) => a.displayId.localeCompare(b.displayId))
      return Object.freeze(results)
    },
  },
} as const
```

Note: `fileLog` (signature: `fileLog(level: 'error' | 'warn', message: string): void`) is the existing file-logger entry point in `src/file-logger.ts`. It is synchronous — no `await` needed.

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npx mocha --forbid-only "test/api.test.ts"`
Expected: All tests pass.

- [ ] **Step 6: Run the full test suite**

Run: `npm run test`
Expected: All tests pass.

- [ ] **Step 7: Commit**

```bash
git add src/api.ts test/api.test.ts
git commit -m "feat(api): add sdkck.commands.list for command enumeration"
```

---

## Task 4: Mark dynamic commands with `static __sdkckDynamic = true`

**Files:**
- Modify: `src/api-dynamic-commands.ts`
- Modify: `test/api-dynamic-commands.test.ts`

So `list()` can flag API-imported commands.

- [ ] **Step 1: Write the failing test**

Append to `test/api-dynamic-commands.test.ts` (locate the appropriate `describe` block for `createOperationCommand` or `registerApiCommands`):

```ts
it('marks generated command classes with static __sdkckDynamic = true', async () => {
  const config = {
    configDir: await mkdtemp(join(tmpdir(), 'sdkck-dyn-')),
  } as unknown as Config

  await writeStore(config.configDir, {
    specs: {
      petstore: {
        baseUrl: 'https://example.test',
        operations: [
          {
            bodyParams: {},
            method: 'get',
            operationId: 'getPet',
            parameters: [],
            path: '/pets',
          },
        ],
        title: 'Petstore',
      },
    },
  } as never)

  const internal = config as unknown as {
    _commands: Map<string, {load(): Promise<unknown>}>
    _topics: Map<string, unknown>
  }
  internal._commands = new Map()
  internal._topics = new Map()

  await registerApiCommands(config)

  const loadable = internal._commands.get('petstore:getPet')
  expect(loadable).to.exist
  const CmdClass = (await loadable!.load()) as unknown as {__sdkckDynamic?: boolean}
  expect(CmdClass.__sdkckDynamic).to.equal(true)
})
```

If the test file doesn't already import `mkdtemp`/`tmpdir`/`join` or `writeStore`/`registerApiCommands`, add the imports at the top.

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx mocha --forbid-only "test/api-dynamic-commands.test.ts"`
Expected: FAIL — `__sdkckDynamic` is undefined.

- [ ] **Step 3: Add the static property to the generated class**

In `src/api-dynamic-commands.ts`, inside `class DynamicOperationCommand extends Command`, add the marker alongside the existing `static` members:

```ts
class DynamicOperationCommand extends Command {
  static __sdkckDynamic = true
  // existing statics: args, description, flags, id
  // ...
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx mocha --forbid-only "test/api-dynamic-commands.test.ts"`
Expected: All tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/api-dynamic-commands.ts test/api-dynamic-commands.test.ts
git commit -m "feat(api): mark dynamic API commands with __sdkckDynamic flag"
```

---

## Task 5: Mark `api auth` as sensitive

**Files:**
- Modify: `src/commands/api/auth.ts`

Explicit beats pattern-matched. Single line change.

- [ ] **Step 1: Add `static sensitive = true` to the class**

In `src/commands/api/auth.ts`, modify the class header:

```ts
export default class ApiAuth extends Command {
  static sensitive = true
  static args = {
    // ... existing
  }
  // ...
}
```

- [ ] **Step 2: Run the existing test suite**

Run: `npm run test`
Expected: All tests pass (no regression).

- [ ] **Step 3: Commit**

```bash
git add src/commands/api/auth.ts
git commit -m "feat(api): mark api:auth as sensitive"
```

---

## Task 6: Implement `sdkck.commands.run()` with policy gates

**Files:**
- Modify: `src/api.ts`
- Create: `test/api-run.test.ts`

Move the execution helper from `mcp-server.ts` into `api.ts` and add the sensitive/permission gates. (The MCP server is refactored in the next task.)

- [ ] **Step 1: Write the failing tests**

Create `test/api-run.test.ts`. Note the fixture pattern matches `test/mcp-server.test.ts`: the class returned by `load()` is a plain class (not extending oclif's `Command`). `sdkck.commands.run` instantiates it with `(argv, config)` and overrides `log`/`logJson`/`warn` before calling `run()`. The fixture's `run()` reads `this.argv` directly to verify argv-building behavior.

```ts
import type {Command} from '@oclif/core'
import type {Config} from '@oclif/core/interfaces'

import {expect} from 'chai'
import {mkdtemp, rm} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'

import {SdkckExecutionError, sdkck} from '../src/api.js'
import {writePermissionConfig} from '../src/permission-config.js'

interface CmdSpec {
  id: string
  /**
   * Called as `run()` on the test command instance. `this.argv` is the captured argv
   * passed by sdkck.commands.run. `this.log(msg)` is overridden to capture output.
   * Return a value to test JSON serialization, throw to test runtime-error capture.
   */
  body: (instance: {argv: string[]; log(msg?: string): void}) => Promise<unknown> | unknown
  args?: Record<string, unknown>
  flags?: Record<string, unknown>
  staticProps?: Record<string, unknown>
}

function makeCmd(spec: CmdSpec): Command.Loadable {
  const Klass = class {
    argv: string[]
    config: Config
    log = (_msg?: string) => {}
    warn = (msg: Error | string) => String(msg)

    constructor(argv: string[], config: Config) {
      this.argv = argv
      this.config = config
    }

    async run() {
      return spec.body(this as {argv: string[]; log(msg?: string): void})
    }
  }

  for (const [k, v] of Object.entries(spec.staticProps ?? {})) {
    ;(Klass as unknown as Record<string, unknown>)[k] = v
  }

  return {
    aliases: [],
    args: spec.args ?? {},
    description: '',
    flags: spec.flags ?? {},
    hidden: false,
    id: spec.id,
    async load() {
      return Klass as unknown as typeof Command
    },
    pluginName: 'sdkck',
    pluginType: 'core',
    strict: true,
    summary: '',
  } as unknown as Command.Loadable
}

function makeConfig(commands: Command.Loadable[], configDir: string): Config {
  return {commands, configDir, topicSeparator: ' '} as unknown as Config
}

describe('sdkck.commands.run', () => {
  let configDir: string

  beforeEach(async () => {
    configDir = await mkdtemp(join(tmpdir(), 'sdkck-run-'))
  })

  afterEach(async () => {
    await rm(configDir, {recursive: true, force: true})
  })

  it('runs a command and captures log output', async () => {
    const cfg = makeConfig(
      [makeCmd({id: 'hello', body(i) { i.log('hi') }})],
      configDir,
    )

    const result = await sdkck.commands.run(cfg, 'hello')
    expect(result.output).to.equal('hi')
    expect(result.error).to.be.undefined
  })

  it('accepts both colon and space id forms', async () => {
    const cfg = makeConfig(
      [makeCmd({id: 'api:list', body(i) { i.log('ok') }})],
      configDir,
    )

    expect((await sdkck.commands.run(cfg, 'api:list')).output).to.equal('ok')
    expect((await sdkck.commands.run(cfg, 'api list')).output).to.equal('ok')
  })

  it('throws SdkckExecutionError with code command_not_found for unknown id', async () => {
    const cfg = makeConfig([], configDir)
    try {
      await sdkck.commands.run(cfg, 'nope')
      expect.fail('expected throw')
    } catch (error) {
      expect(error).to.be.instanceOf(SdkckExecutionError)
      expect((error as SdkckExecutionError).code).to.equal('command_not_found')
    }
  })

  it('blocks sensitive commands by default', async () => {
    const cfg = makeConfig(
      [makeCmd({id: 'api:auth', body(i) { i.log('ran') }, staticProps: {sensitive: true}})],
      configDir,
    )

    try {
      await sdkck.commands.run(cfg, 'api:auth')
      expect.fail('expected throw')
    } catch (error) {
      expect((error as SdkckExecutionError).code).to.equal('sensitive_denied')
    }
  })

  it('allows sensitive commands with allowSensitive: true', async () => {
    const cfg = makeConfig(
      [makeCmd({id: 'api:auth', body(i) { i.log('ran') }, staticProps: {sensitive: true}})],
      configDir,
    )

    const result = await sdkck.commands.run(cfg, 'api:auth', {}, {allowSensitive: true})
    expect(result.output).to.equal('ran')
  })

  it('blocks disallowed commands by default', async () => {
    await writePermissionConfig(configDir, {rules: [{action: 'disallow', pattern: 'api list'}]})
    const cfg = makeConfig(
      [makeCmd({id: 'api:list', body(i) { i.log('ran') }})],
      configDir,
    )

    try {
      await sdkck.commands.run(cfg, 'api:list')
      expect.fail('expected throw')
    } catch (error) {
      expect((error as SdkckExecutionError).code).to.equal('permission_denied')
    }
  })

  it('allows disallowed commands with allowDisallowed: true', async () => {
    await writePermissionConfig(configDir, {rules: [{action: 'disallow', pattern: 'api list'}]})
    const cfg = makeConfig(
      [makeCmd({id: 'api:list', body(i) { i.log('ran') }})],
      configDir,
    )

    const result = await sdkck.commands.run(cfg, 'api:list', {}, {allowDisallowed: true})
    expect(result.output).to.equal('ran')
  })

  it('returns {error} on runtime failure (does not throw)', async () => {
    const cfg = makeConfig(
      [makeCmd({id: 'boom', body() { throw new Error('kaboom') }})],
      configDir,
    )

    const result = await sdkck.commands.run(cfg, 'boom')
    expect(result.error).to.equal('kaboom')
  })

  it('passes args record through buildArgv', async () => {
    const cfg = makeConfig(
      [
        makeCmd({
          id: 'echo',
          args: {name: {required: true}},
          flags: {loud: {type: 'boolean'}},
          body(i) {
            // sdkck.commands.run builds argv via buildArgv: positional first, then flags.
            // For args={name: 'allen', loud: true} we expect argv = ['allen', '--loud'].
            i.log(i.argv.join(' '))
          },
        }),
      ],
      configDir,
    )

    const result = await sdkck.commands.run(cfg, 'echo', {name: 'allen', loud: true})
    expect(result.output).to.equal('allen --loud')
  })

  it('serializes JSON return value into output', async () => {
    const cfg = makeConfig(
      [makeCmd({id: 'data', body() { return {ok: true, n: 1} }})],
      configDir,
    )

    const result = await sdkck.commands.run(cfg, 'data')
    expect(JSON.parse(result.output)).to.deep.equal({ok: true, n: 1})
  })

  it('does not interleave output across concurrent runs', async () => {
    const cfg = makeConfig(
      [
        makeCmd({id: 'a', async body(i) { await new Promise((r) => setTimeout(r, 5)); i.log('AAA') }}),
        makeCmd({id: 'b', body(i) { i.log('BBB') }}),
      ],
      configDir,
    )

    const [a, b] = await Promise.all([sdkck.commands.run(cfg, 'a'), sdkck.commands.run(cfg, 'b')])
    expect(a.output).to.equal('AAA')
    expect(b.output).to.equal('BBB')
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx mocha --forbid-only "test/api-run.test.ts"`
Expected: FAIL — `sdkck.commands.run` does not exist.

- [ ] **Step 3: Add `buildArgv`, `resolveCommand`, `executeCommand` helpers to `src/api.ts`**

Append to `src/api.ts` (before the `sdkck` object):

```ts
// ─── Argv builder ────────────────────────────────────────────────────────────

function buildArgv(loadable: import('@oclif/core').Command.Loadable, args: Record<string, unknown>): string[] {
  const argv: string[] = []

  for (const name of Object.keys(loadable.args ?? {})) {
    const value = args[name]
    if (value !== undefined && value !== null) argv.push(String(value))
  }

  for (const [name, flag] of Object.entries(loadable.flags ?? {})) {
    if (name === 'json') continue
    const value = args[name]
    if (value === undefined || value === null) continue

    const f = flag as {type: string}
    if (f.type === 'boolean') {
      if (value === true) argv.push(`--${name}`)
    } else if (Array.isArray(value)) {
      for (const v of value) argv.push(`--${name}`, String(v))
    } else {
      argv.push(`--${name}`, String(value))
    }
  }

  return argv
}

// ─── Command resolution ─────────────────────────────────────────────────────

function resolveCommand(
  config: Config,
  id: string,
): import('@oclif/core').Command.Loadable | undefined {
  const colonId = id.replaceAll(' ', ':')
  return config.commands.find((c) => c.id === colonId)
}

// ─── Execution ───────────────────────────────────────────────────────────────

async function executeCommand(
  loadable: import('@oclif/core').Command.Loadable,
  argv: string[],
  config: Config,
): Promise<RunCommandResult> {
  try {
    const CmdClass = await loadable.load()
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const instance = new (CmdClass as any)(argv, config) as import('@oclif/core').Command

    const lines: string[] = []
    instance.log = (msg = '') => {
      lines.push(String(msg))
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ;(instance as any).logJson = (json: unknown) => {
      lines.push(JSON.stringify(json, null, 2))
    }

    instance.warn = (msg: Error | string) => {
      lines.push(`Warning: ${String(msg)}`)
      return String(msg)
    }

    const result = await instance.run()
    const output =
      result === null || result === undefined ? lines.join('\n') : JSON.stringify(result, null, 2)
    return {output: output || '(no output)'}
  } catch (error) {
    return {error: error instanceof Error ? error.message : String(error), output: ''}
  }
}
```

- [ ] **Step 4: Add `run` to the `sdkck.commands` object**

Replace the `sdkck` export at the bottom of `src/api.ts` with:

```ts
export const sdkck = {
  commands: {
    async list(config: Config, opts: ListCommandsOptions = {}): Promise<readonly CommandInfo[]> {
      // … existing implementation (unchanged)
    },

    async run(
      config: Config,
      id: string,
      args: Record<string, unknown> = {},
      options: RunCommandOptions = {},
    ): Promise<RunCommandResult> {
      const loadable = resolveCommand(config, id)
      if (!loadable) {
        throw new SdkckExecutionError('command_not_found', id, `Command "${id}" not found.`)
      }

      const CmdClass = (await loadable.load()) as unknown as {sensitive?: boolean}

      if (!options.allowSensitive && isSensitiveCommand(loadable.id, CmdClass)) {
        throw new SdkckExecutionError(
          'sensitive_denied',
          loadable.id,
          `Command "${loadable.id}" is classified as sensitive. Pass {allowSensitive: true} to run it.`,
        )
      }

      const permissionConfig = await readPermissionConfig(config.configDir)
      const separator = config.topicSeparator ?? ' '
      const normalizedForPermission = loadable.id.replaceAll(':', separator)
      if (!options.allowDisallowed && !isCommandAllowed(normalizedForPermission, permissionConfig)) {
        throw new SdkckExecutionError(
          'permission_denied',
          loadable.id,
          `Command "${loadable.id}" is blocked by the permission allowlist. Pass {allowDisallowed: true} to run it.`,
        )
      }

      const argv = buildArgv(loadable, args)
      return executeCommand(loadable, argv, config)
    },
  },
} as const
```

(Keep the existing `list` implementation intact — only add the `run` sibling.)

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npx mocha --forbid-only "test/api-run.test.ts"`
Expected: All tests pass.

- [ ] **Step 6: Run the full test suite**

Run: `npm run test`
Expected: All tests pass.

- [ ] **Step 7: Commit**

```bash
git add src/api.ts test/api-run.test.ts
git commit -m "feat(api): add sdkck.commands.run with sensitive/permission gates"
```

---

## Task 7: Refactor `mcp-server.ts` to delegate to `sdkck.commands.run`

**Files:**
- Modify: `src/mcp-server.ts`
- Modify: `test/mcp-server.test.ts`

Remove the duplicated `buildArgv` + `runCommand` helpers. MCP keeps current behavior (no policy gates) by passing both opt-outs.

- [ ] **Step 1: Identify the call site to replace**

Open `src/mcp-server.ts`. Locate the `run_command` tool handler (the `CallToolRequestSchema` branch that handles `name === 'run_command'`). It currently calls the local `runCommand(cmd, argv, config)` helper.

- [ ] **Step 2: Replace the call site**

Replace the body of the `run_command` handler so it calls `sdkck.commands.run` directly. The handler should:

```ts
if (name === 'run_command') {
  const {command: commandId, args: toolArgs = {}} = (request.params.arguments ?? {}) as {
    args?: Record<string, unknown>
    command: string
  }

  const result = await sdkck.commands.run(config, commandId, toolArgs, {
    allowDisallowed: true,
    allowSensitive: true,
  })

  return {
    content: [
      {
        text: result.error ? `Error: ${result.error}\n${result.output}` : result.output,
        type: 'text',
      },
    ],
  }
}
```

(Preserve whatever wrapping the existing handler used; the only change is calling `sdkck.commands.run` instead of the local `runCommand`.)

- [ ] **Step 3: Remove the now-unused local helpers**

Delete the `buildArgv` and `runCommand` function definitions from `src/mcp-server.ts`. Add this import at the top:

```ts
import {sdkck} from './api.js'
```

If `buildArgv` is still exported (it has `// ts-prune-ignore-next` above it today), also remove the export. Any consumers outside `mcp-server.ts` are removed in the next step.

- [ ] **Step 4: Update `test/mcp-server.test.ts`**

The existing test file imports `buildArgv` from `mcp-server.ts`. Switch it to import the equivalent (the buildArgv helper now lives inside `api.ts` and is not exported). Two options:

- **Option A (preferred):** Remove the `buildArgv` direct-unit tests from `test/mcp-server.test.ts` — `buildArgv` is now an internal implementation detail of `sdkck.commands.run`, and `test/api-run.test.ts` already covers it end-to-end via the "passes args record through buildArgv" test.

- **Option B:** Export `buildArgv` from `src/api.ts` and update the import path in the test. Only do this if the existing `buildArgv` tests cover edge cases that `test/api-run.test.ts` does not.

Pick A unless you find unique edge cases in the existing `buildArgv` tests that aren't covered by `test/api-run.test.ts`. Remove only those tests; leave any `createMcpServer` / end-to-end MCP tests intact.

- [ ] **Step 5: Run the MCP test suite**

Run: `npx mocha --forbid-only "test/mcp-server.test.ts"`
Expected: All tests pass.

- [ ] **Step 6: Run the full test suite**

Run: `npm run test`
Expected: All tests pass.

- [ ] **Step 7: Commit**

```bash
git add src/mcp-server.ts test/mcp-server.test.ts
git commit -m "refactor(mcp): delegate run_command to sdkck.commands.run"
```

---

## Task 8: Export `sdkck` and types from package root

**Files:**
- Modify: `src/index.ts`

Make the API consumable as `import {sdkck} from 'sdkck'`.

- [ ] **Step 1: Update `src/index.ts`**

Replace the file's content:

```ts
export {run} from '@oclif/core'

export {sdkck, SdkckExecutionError} from './api.js'
export type {
  CommandArg,
  CommandFlag,
  CommandInfo,
  ListCommandsOptions,
  RunCommandOptions,
  RunCommandResult,
  SdkckExecutionDenialCode,
} from './api.js'
```

- [ ] **Step 2: Build to verify types resolve**

Run: `npm run build`
Expected: TypeScript compiles. (Ignore the pre-existing lint false-positive on `bin/run.js` noted in `CLAUDE.md`.)

- [ ] **Step 3: Smoke-test the export from a Node REPL**

Run:

```bash
node --input-type=module -e "import('./dist/index.js').then((m) => console.log(typeof m.sdkck.commands.list, typeof m.sdkck.commands.run))"
```

Expected output: `function function`

- [ ] **Step 4: Commit**

```bash
git add src/index.ts
git commit -m "feat(api): export sdkck and types from package root"
```

---

## Task 9: README "Programmatic API" section

**Files:**
- Modify: `README.md`

Document the new surface briefly. Place under the existing "Built-in Features" section.

- [ ] **Step 1: Locate the "Built-in Features" section**

Open `README.md`. Find the "Built-in Features" header (or whichever header introduces `api import`, `permission`, `mcp` features). The new section goes after the existing built-in features and before any other top-level section.

- [ ] **Step 2: Add the "Programmatic API" subsection**

Insert this content after the last existing built-in feature subsection:

````markdown
### Programmatic API

`sdkck` exposes a typed programmatic API for oclif plugins that ship alongside it. Other plugins can enumerate and invoke commands without re-implementing permission and sensitive-command filtering.

```ts
import {sdkck} from 'sdkck'

// Inside a Command class in another oclif plugin:
const cmds = await sdkck.commands.list(this.config)
// → Array<CommandInfo> — hidden, disallowed, and sensitive commands excluded by default

const {output, error} = await sdkck.commands.run(this.config, 'api:list', {json: true})
```

**Policy gates.** `run()` refuses to execute sensitive commands (like `api:auth`) and commands blocked by the permission allowlist. Pass `{allowSensitive: true}` or `{allowDisallowed: true}` to override. Policy denial throws `SdkckExecutionError` with a typed `.code`; runtime errors from the command itself are returned in `result.error`.

**Sensitive classification.** A command is sensitive if its class declares `static sensitive = true`, or if any colon-separated segment of its id is in the built-in denylist (`auth`, `login`, `logout`, `credentials`, `secret`, `token`, …). Set `static sensitive = false` to override the pattern fallback.

See `docs/superpowers/specs/2026-05-15-internal-commands-api-design.md` for the full spec.
````

- [ ] **Step 3: Commit**

```bash
git add README.md
git commit -m "docs: document programmatic API in README"
```

---

## Self-Review Checklist

After completing all tasks, verify against the spec:

- [ ] `sdkck.commands.list` covers: list shape, filtering options, dynamic flag, sort by displayId, frozen results, load-failure swallow — Task 3.
- [ ] `sdkck.commands.run` covers: id resolution (both forms), policy gates, output capture, runtime-error capture, concurrent isolation — Task 6.
- [ ] Sensitive classification has explicit-wins precedence — Task 2.
- [ ] `api:auth` explicitly marked sensitive — Task 5.
- [ ] Dynamic commands flagged — Task 4.
- [ ] `isCommandAllowed` reused by hook and API — Task 1.
- [ ] MCP server delegates to `sdkck.commands.run` — Task 7.
- [ ] Public exports from `src/index.ts` — Task 8.
- [ ] README documents the API — Task 9.

Run `npm run test` one final time — all tests pass.
