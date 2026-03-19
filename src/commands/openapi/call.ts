import {Args, Command, Flags} from '@oclif/core'

import {buildAuthHeaders, buildUrl, readStore, type StoredOperation} from '../../openapi-store.js'

/**
 * Minimal interface for the fetch-like function used to make HTTP requests.
 * Using a structural type here makes the property easy to mock in tests without
 * depending on the global `fetch` type, which ESLint flags as experimental for Node < 21.
 */
export interface FetchLike {
  (
    url: string,
    init?: {body?: null | string; headers?: Record<string, string>; method?: string},
  ): Promise<{ok: boolean; status: number; statusText: string; text: () => Promise<string>}>
}

export default class OpenApiCall extends Command {
  static args = {
    name: Args.string({
      description: 'API name (as shown in `openapi list`)',
      required: true,
    }),
    operationId: Args.string({
      description: 'Operation ID to call (as shown in `openapi list <name>`)',
      required: true,
    }),
  }
  static description = 'Call an imported OpenAPI operation'
  static examples = [
    '<%= config.bin %> openapi call petstore listPets',
    '<%= config.bin %> openapi call petstore getPetById --param petId=42',
    '<%= config.bin %> openapi call petstore createPet --body name=Fido --body tag=dog',
    '<%= config.bin %> openapi call petstore listPets --query limit=10 --header X-Trace=abc',
    '<%= config.bin %> openapi call petstore listPets --base-url https://staging.example.com',
    '<%= config.bin %> openapi call petstore listPets --raw',
  ]
  static flags = {
    'base-url': Flags.string({
      description: 'Override the base URL for this call',
      required: false,
    }),
    body: Flags.string({
      description: 'Request body field as key=value (repeatable)',
      multiple: true,
      required: false,
    }),
    header: Flags.string({
      description: 'Extra request header as Key=Value (repeatable)',
      multiple: true,
      required: false,
    }),
    param: Flags.string({
      description: 'Path or query parameter as key=value (repeatable)',
      multiple: true,
      required: false,
    }),
    raw: Flags.boolean({
      description: 'Print raw response body instead of formatted JSON',
      required: false,
    }),
  }
  // Exposed for testing — inject a mock implementation to avoid real HTTP calls
  // eslint-disable-next-line n/no-unsupported-features/node-builtins
  _fetch: FetchLike = fetch

  async run(): Promise<void> {
    const {args, flags} = await this.parse(OpenApiCall)

    const store = await readStore(this.config.configDir)
    const spec = store.specs[args.name]
    if (!spec) {
      this.error(`No spec found with name "${args.name}". Run \`openapi list\` to see available specs.`)
    }

    const operation: StoredOperation | undefined = spec.operations.find(
      (o) => o.operationId === args.operationId,
    )
    if (!operation) {
      this.error(
        `Operation "${args.operationId}" not found in "${args.name}". Run \`openapi list ${args.name}\` to see operations.`,
      )
    }

    const baseUrl = flags['base-url'] ?? spec.baseUrl
    if (!baseUrl) {
      this.error(
        'No base URL set. Supply one with --base-url or re-import with `openapi import --base-url <url>`.',
      )
    }

    // ── Parse key=value pairs ──────────────────────────────────────────────────
    const parsedParams = parseKV(flags.param ?? [])
    const parsedBody = parseKV(flags.body ?? [])
    const parsedHeaders = parseKV(flags.header ?? [])

    // ── Split params into path / query / header ────────────────────────────────
    const {headerParams, pathParams, queryParams} = this._splitParams(operation.parameters, parsedParams)

    // Validate required body params
    this._validateBodyParams(operation.bodyParams, parsedBody)

    // ── Build URL ──────────────────────────────────────────────────────────────
    const url = new URL(buildUrl(baseUrl, operation.path, pathParams))
    for (const [k, v] of Object.entries(queryParams)) {
      url.searchParams.set(k, v)
    }

    // ── Build headers ──────────────────────────────────────────────────────────
    const headers: Record<string, string> = {
      ...buildAuthHeaders(spec.auth),
      ...headerParams,
      ...parsedHeaders,
    }

    const hasBody = Object.keys(parsedBody).length > 0
    if (hasBody) {
      headers['Content-Type'] = 'application/json'
    }

    // ── Execute ────────────────────────────────────────────────────────────────
    const method = operation.method.toUpperCase()
    const reqInit = {body: hasBody ? JSON.stringify(parsedBody) : undefined, headers, method}

    this.log(`${method} ${url.toString()}`)

    const res = await this._fetch(url.toString(), reqInit).catch((error: Error) => {
      this.error(`Request failed: ${error.message}`)
    })

    const responseText = await res.text()

    if (!res.ok) {
      this.warn(`HTTP ${res.status} ${res.statusText}`)
    }

    if (flags.raw) {
      this.log(responseText)
      return
    }

    try {
      const parsed = JSON.parse(responseText)
      this.log(JSON.stringify(parsed, null, 2))
    } catch {
      this.log(responseText)
    }
  }

  private _splitParams(
    parameters: StoredOperation['parameters'],
    parsedParams: Record<string, string>,
  ): {headerParams: Record<string, string>; pathParams: Record<string, string>; queryParams: Record<string, string>} {
    const pathParams: Record<string, string> = {}
    const queryParams: Record<string, string> = {}
    const headerParams: Record<string, string> = {}
    for (const p of parameters) {
      const value = parsedParams[p.name]
      if (value === undefined) {
        if (p.required) {
          this.error(`Missing required parameter: ${p.name} (${p.in})`)
        }

        continue
      }

      switch (p.in) {
        case 'header': {
          headerParams[p.name] = value
          break
        }

        case 'path': {
          pathParams[p.name] = value
          break
        }

        case 'query': {
          queryParams[p.name] = value
          break
        }
        // No default — cookie params are ignored
      }
    }

    return {headerParams, pathParams, queryParams}
  }

  private _validateBodyParams(
    bodyParams: StoredOperation['bodyParams'],
    parsedBody: Record<string, string>,
  ): void {
    for (const [name, def] of Object.entries(bodyParams)) {
      if (def.required && parsedBody[name] === undefined) {
        this.error(`Missing required body field: ${name}`)
      }
    }
  }
}

function parseKV(pairs: string[]): Record<string, string> {
  const result: Record<string, string> = {}
  for (const pair of pairs) {
    const idx = pair.indexOf('=')
    if (idx === -1) {
      result[pair] = ''
    } else {
      result[pair.slice(0, idx)] = pair.slice(idx + 1)
    }
  }

  return result
}
