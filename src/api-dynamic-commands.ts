import type {Config} from '@oclif/core/interfaces'

import {Args, Command, Flags} from '@oclif/core'
import {encode} from '@toon-format/toon'

import {
  buildAuthHeaders,
  buildGraphQLBody,
  buildInsecureFetch,
  buildUrl,
  coerceBodyValue,
  parseKV,
  readStore,
  type StoredOperation,
} from './api-store.js'

async function readStdin(): Promise<string> {
  const parts: string[] = []
  process.stdin.setEncoding('utf8')
  for await (const chunk of process.stdin) {
    parts.push(chunk as string)
  }

  return parts.join('')
}

// ─── Fetch abstraction (mirrors call.ts, exposed for testing) ─────────────────

interface FetchLike {
  (
    url: string,
    init?: {body?: null | string; headers?: Record<string, string>; method?: string},
  ): Promise<{ok: boolean; status: number; statusText: string; text: () => Promise<string>}>
}

// ─── run() helpers ───────────────────────────────────────────────────────────

function routeUrlParams(
  parameters: StoredOperation['parameters'],
  args: Record<string, string>,
  flags: Record<string, string | undefined>,
): {headerParams: Record<string, string>; pathParams: Record<string, string>; queryParams: Record<string, string>} {
  const pathParams: Record<string, string> = {}
  const queryParams: Record<string, string> = {}
  const headerParams: Record<string, string> = {}

  for (const param of parameters) {
    const value = param.required ? args[param.name] : flags[param.name]
    if (value === undefined) continue

    switch (param.in) {
      case 'header': {
        headerParams[param.name] = value
        break
      }

      case 'path': {
        pathParams[param.name] = value
        break
      }

      case 'query': {
        queryParams[param.name] = value
        break
      }
      // No default — cookie params are ignored
    }
  }

  return {headerParams, pathParams, queryParams}
}

async function buildRequestBody(
  op: StoredOperation,
  bodyParamNames: {argNames: Record<string, string>; flagNames: Record<string, string>},
  args: Record<string, string>,
  flags: Record<string, string | undefined>,
): Promise<{inferredContentType: string | undefined; requestBody: string | undefined}> {
  if (op.rawBodyContentType) {
    let requestBody: string | undefined
    if (flags.body !== undefined) {
      requestBody = flags.body
    } else if (!process.stdin.isTTY) {
      requestBody = await readStdin()
    }

    const inferredContentType =
      requestBody !== undefined && op.rawBodyContentType !== '*/*' ? op.rawBodyContentType : undefined
    return {inferredContentType, requestBody}
  }

  // Structured JSON body assembled from named body params
  const body: Record<string, unknown> = {}

  for (const [name, argName] of Object.entries(bodyParamNames.argNames)) {
    body[name] = coerceBodyValue(op.bodyParams, name, args[argName])
  }

  for (const [name, flagName] of Object.entries(bodyParamNames.flagNames)) {
    const value = flags[flagName]
    if (value !== undefined) body[name] = coerceBodyValue(op.bodyParams, name, value)
  }

  // GraphQL: always POST {query, variables} — even with zero variables the server
  // needs the query document.
  if (op.graphql) {
    return {inferredContentType: 'application/json', requestBody: buildGraphQLBody(op.graphql.query, body)}
  }

  if (Object.keys(body).length === 0) return {inferredContentType: undefined, requestBody: undefined}

  return {inferredContentType: 'application/json', requestBody: JSON.stringify(body)}
}

// ─── Dynamic command factory ──────────────────────────────────────────────────

/**
 * Creates a fully-functional oclif Command class for a single imported API operation.
 * Required URL/query/header/body parameters become positional `Args`.
 * Optional parameters become `--<name>` flags.
 * Body param names that collide with URL param names are prefixed with `body-`.
 */
function createOperationCommand(
  specName: string,
  op: StoredOperation,
  // eslint-disable-next-line n/no-unsupported-features/node-builtins
  fetchFn: FetchLike = fetch,
): typeof Command {
  const urlParamNames = new Set(op.parameters.map((p) => p.name))

  // Maps body-param name → arg name (for required body params that become args)
  const bodyParamArgNames: Record<string, string> = {}
  // Maps body-param name → flag name (for optional body params that stay as flags)
  const bodyParamFlagNames: Record<string, string> = {}

  // Build args for required parameters
  const dynamicArgs: Record<string, unknown> = {}

  // Build flags object
  const dynamicFlags: Record<string, unknown> = {
    header: Flags.string({
      description: 'Extra request header as Key=Value (repeatable)',
      multiple: true,
      required: false,
    }),
    toon: Flags.boolean({
      description: 'Encode JSON output with TOON for token-efficient LLM consumption',
      required: false,
    }),
  }

  // For operations with a raw (non-JSON) request body, expose a --body flag.
  // stdin is the fallback when --body is omitted and stdin is not a TTY.
  if (op.rawBodyContentType) {
    dynamicFlags.body = Flags.string({
      description: `Raw request body (${op.rawBodyContentType}). Reads from stdin if omitted.`,
      required: false,
    })
  }

  // URL parameters: required → arg, optional → flag
  for (const param of op.parameters) {
    if (param.required) {
      dynamicArgs[param.name] = Args.string({
        description: param.description ?? param.name,
        name: param.name,
        required: true,
      })
    } else {
      dynamicFlags[param.name] = Flags.string({
        description: `[${param.in}] ${param.description ?? param.name}`,
        required: false,
      })
    }
  }

  // Body params: required → arg, optional → flag
  // Prefix with `body-` only when the name would collide with a URL parameter name
  for (const [name, bodyParam] of Object.entries(op.bodyParams)) {
    const resolvedName = urlParamNames.has(name) ? `body-${name}` : name
    if (bodyParam.required) {
      bodyParamArgNames[name] = resolvedName
      dynamicArgs[resolvedName] = Args.string({
        description: `${bodyParam.description ?? name} (${bodyParam.type})`,
        name: resolvedName,
        required: true,
      })
    } else {
      bodyParamFlagNames[name] = resolvedName
      dynamicFlags[resolvedName] = Flags.string({
        description: `${bodyParam.description ?? name} (${bodyParam.type})`,
        required: false,
      })
    }
  }

  const commandId = `${specName}:${op.operationId}`
  const opDescription = op.description || `${op.method.toUpperCase()} ${op.path}`

  // Capture loop vars in closure before class definition
  const capturedOp = op
  const capturedSpecName = specName
  const capturedBodyParamArgNames = bodyParamArgNames
  const capturedBodyParamFlagNames = bodyParamFlagNames

  class DynamicOperationCommand extends Command {
    // Cast required: dynamicArgs is built at runtime so TypeScript cannot verify the exact shape
    static args = dynamicArgs as typeof Command.args
    static description = opDescription
    // Cast required: dynamicFlags is built at runtime so TypeScript cannot verify the exact shape
    static flags = dynamicFlags as typeof Command.flags
    static id = commandId
    // Exposed for testing — inject a mock to avoid encoding in unit tests
    _applyToon: (value: unknown) => string = encode
    // Exposed for testing — replace with a mock to avoid real HTTP calls
    _fetch: FetchLike = fetchFn

    async run(): Promise<void> {
      // We must cast because TypeScript cannot statically know the dynamic arg/flag types
      const {args: a, flags: f} = await this.parse(DynamicOperationCommand as unknown as typeof Command)

      const store = await readStore(this.config.configDir)
      const spec = store.specs[capturedSpecName]
      if (!spec) {
        this.error(`Spec "${capturedSpecName}" was removed. Run 'api list' to see available specs.`)
      }

      const {baseUrl} = spec
      if (!baseUrl) {
        this.error('No base URL set. Use --base-url or re-import with `api import --base-url <url>`.')
      }

      // ── Route URL params ────────────────────────────────────────────────────
      const {headerParams, pathParams, queryParams} = routeUrlParams(
        capturedOp.parameters,
        a as Record<string, string>,
        f as Record<string, string | undefined>,
      )

      // ── Build body ──────────────────────────────────────────────────────────
      const {inferredContentType, requestBody} = await buildRequestBody(
        capturedOp,
        {argNames: capturedBodyParamArgNames, flagNames: capturedBodyParamFlagNames},
        a as Record<string, string>,
        f as Record<string, string | undefined>,
      )

      // ── Parse extra headers ─────────────────────────────────────────────────
      const extraHeaders = parseKV((f.header as string[] | undefined) ?? [])

      // ── Build URL ───────────────────────────────────────────────────────────
      const url = new URL(buildUrl(baseUrl, capturedOp.path, pathParams))
      for (const [k, v] of Object.entries(queryParams)) {
        url.searchParams.set(k, v)
      }

      // ── Build headers ───────────────────────────────────────────────────────
      // extraHeaders (from --header) take priority — they can override the inferred Content-Type.
      const headers: Record<string, string> = {
        ...buildAuthHeaders(spec.auth),
        ...headerParams,
      }
      if (inferredContentType && !extraHeaders['Content-Type']) {
        headers['Content-Type'] = inferredContentType
      }

      Object.assign(headers, extraHeaders)

      // ── Execute ─────────────────────────────────────────────────────────────
      const method = capturedOp.method.toUpperCase()
      this.log(`${method} ${url.toString()}`)

      const fetchFn = spec.insecure ? buildInsecureFetch() : this._fetch
      const res = await fetchFn(url.toString(), {
        body: requestBody,
        headers,
        method,
      }).catch((error: Error) => {
        this.error(`Request failed: ${error.message}`)
      })

      const responseText = await res.text()
      if (!res.ok) this.warn(`HTTP ${res.status} ${res.statusText}`)

      const useToon = Boolean((f as Record<string, unknown>).toon)
      try {
        const parsed = JSON.parse(responseText)
        this.log(useToon ? this._applyToon(parsed) : JSON.stringify(parsed, null, 2))
      } catch {
        this.log(responseText)
      }
    }
  }

  return DynamicOperationCommand
}

// ─── Registration ─────────────────────────────────────────────────────────────

interface LoadableCommand {
  aliases: string[]
  args: Record<string, unknown>
  description?: string
  flags: Record<string, unknown>
  hidden: boolean
  id: string
  load(): Promise<typeof Command>
  pluginName?: string
  pluginType?: string
  strict: boolean
}

interface InternalConfig {
  _commands: Map<string, LoadableCommand>
  _topics: Map<string, {description?: string; hidden: boolean; name: string}>
}

/**
 * Reads the api store and injects one oclif command per operation into the
 * Config's internal `_commands` map, making them visible in `help`, `commands`,
 * and invocable directly as `<specName> <operationId> [args] [flags]`.
 */
export async function registerApiCommands(config: Config): Promise<void> {
  const store = await readStore(config.configDir)
  const internal = config as unknown as InternalConfig

  for (const [specName, spec] of Object.entries(store.specs)) {
    // Register the topic (spec name) so it appears in `help` with its description
    if (!internal._topics.has(specName)) {
      internal._topics.set(specName, {
        description: spec.description || spec.title,
        hidden: false,
        name: specName,
      })
    }

    for (const op of spec.operations) {
      const commandId = `${specName}:${op.operationId}`
      if (internal._commands.has(commandId)) continue

      const CmdClass = createOperationCommand(specName, op)

      internal._commands.set(commandId, {
        aliases: [],
        args: CmdClass.args as Record<string, unknown>,
        description: op.description || `${op.method.toUpperCase()} ${op.path}`,
        flags: CmdClass.flags as Record<string, unknown>,
        hidden: false,
        id: commandId,
        async load() {
          return CmdClass
        },
        pluginName: config.name,
        pluginType: 'core',
        strict: true,
      })
    }
  }
}
