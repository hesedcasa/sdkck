import type {Config} from '@oclif/core/interfaces'

import {Args, Command, Flags} from '@oclif/core'

import {buildAuthHeaders, buildUrl, parseKV, readStore, type StoredOperation} from './openapi-store.js'

// ─── Fetch abstraction (mirrors call.ts, exposed for testing) ─────────────────

interface FetchLike {
  (
    url: string,
    init?: {body?: null | string; headers?: Record<string, string>; method?: string},
  ): Promise<{ok: boolean; status: number; statusText: string; text: () => Promise<string>}>
}

// ─── Dynamic command factory ──────────────────────────────────────────────────

/**
 * Creates a fully-functional oclif Command class for a single OpenAPI operation.
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
    // Exposed for testing — replace with a mock to avoid real HTTP calls
    _fetch: FetchLike = fetchFn

    async run(): Promise<void> {
      // We must cast because TypeScript cannot statically know the dynamic arg/flag types
      const {args: a, flags: f} = await this.parse(DynamicOperationCommand as unknown as typeof Command)

      const store = await readStore(this.config.configDir)
      const spec = store.specs[capturedSpecName]
      if (!spec) {
        this.error(`Spec "${capturedSpecName}" was removed. Run \`openapi list\` to see available specs.`)
      }

      const {baseUrl} = spec
      if (!baseUrl) {
        this.error('No base URL set. Use --base-url or re-import with `openapi import --base-url <url>`.')
      }

      // ── Route URL params ────────────────────────────────────────────────────
      const pathParams: Record<string, string> = {}
      const queryParams: Record<string, string> = {}
      const headerParams: Record<string, string> = {}

      for (const param of capturedOp.parameters) {
        // Required params are positional args; optional params are flags
        const value = param.required ? (a[param.name] as string) : (f[param.name] as string | undefined)
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

      // ── Build body ──────────────────────────────────────────────────────────
      const body: Record<string, string> = {}

      // Required body params come from positional args
      for (const [name, argName] of Object.entries(capturedBodyParamArgNames)) {
        const value = a[argName] as string
        body[name] = value
      }

      // Optional body params come from flags
      for (const [name, flagName] of Object.entries(capturedBodyParamFlagNames)) {
        const value = f[flagName] as string | undefined
        if (value !== undefined) body[name] = value
      }

      // ── Parse extra headers ─────────────────────────────────────────────────
      const extraHeaders = parseKV((f.header as string[] | undefined) ?? [])

      // ── Build URL ───────────────────────────────────────────────────────────
      const url = new URL(buildUrl(baseUrl, capturedOp.path, pathParams))
      for (const [k, v] of Object.entries(queryParams)) {
        url.searchParams.set(k, v)
      }

      // ── Build headers ───────────────────────────────────────────────────────
      const headers: Record<string, string> = {
        ...buildAuthHeaders(spec.auth),
        ...headerParams,
        ...extraHeaders,
      }

      const hasBody = Object.keys(body).length > 0
      if (hasBody) headers['Content-Type'] = 'application/json'

      // ── Execute ─────────────────────────────────────────────────────────────
      const method = capturedOp.method.toUpperCase()
      this.log(`${method} ${url.toString()}`)

      const res = await this._fetch(url.toString(), {
        body: hasBody ? JSON.stringify(body) : undefined,
        headers,
        method,
      }).catch((error: Error) => {
        this.error(`Request failed: ${error.message}`)
      })

      const responseText = await res.text()
      if (!res.ok) this.warn(`HTTP ${res.status} ${res.statusText}`)

      try {
        this.log(JSON.stringify(JSON.parse(responseText), null, 2))
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
 * Reads the openapi store and injects one oclif command per operation into the
 * Config's internal `_commands` map, making them visible in `help`, `commands`,
 * and invocable directly as `<specName> <operationId> [args] [flags]`.
 */
export async function registerOpenApiCommands(config: Config): Promise<void> {
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
