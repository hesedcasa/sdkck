import {Args, Command, Flags} from '@oclif/core'

import {
  buildAuthHeaders,
  buildGraphQLBody,
  buildInsecureFetch,
  buildUrl,
  coerceBodyValue,
  parseKV,
  readStore,
  type StoredOperation,
} from '../../api-store.js'

/**
 * Minimal interface for the fetch-like function used to make HTTP requests.
 * Using a structural type here makes the property easy to mock in tests without
 * depending on the global `fetch` type, which ESLint flags as experimental for Node < 21.
 */
// ts-prune-ignore-next
export interface FetchLike {
  (
    url: string,
    init?: {body?: null | string; headers?: Record<string, string>; method?: string},
  ): Promise<{ok: boolean; status: number; statusText: string; text: () => Promise<string>}>
}

export default class ApiCall extends Command {
  static args = {
    name: Args.string({
      description: 'API name (as shown in `api list`)',
      required: true,
    }),
    operationId: Args.string({
      description: 'Operation ID to call (as shown in `api list <name>`)',
      required: true,
    }),
  }
  static description = 'Call an imported API operation'
  static examples = [
    '<%= config.bin %> api call petstore listPets',
    '<%= config.bin %> api call petstore getPetById --param petId=42',
    '<%= config.bin %> api call petstore createPet --body name=Fido --body tag=dog',
    '<%= config.bin %> api call petstore listPets --query limit=10 --header X-Trace=abc',
  ]
  static flags = {
    'base-url': Flags.string({
      description: 'Override the base URL for this request',
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
      description: 'Print the raw response body without JSON formatting',
      required: false,
    }),
  }
  // Exposed for testing — inject a mock implementation to avoid real HTTP calls
  // eslint-disable-next-line n/no-unsupported-features/node-builtins
  _fetch: FetchLike = fetch

  async run(): Promise<void> {
    const {args, flags} = await this.parse(ApiCall)

    const store = await readStore(this.config.configDir)
    const spec = store.specs[args.name]
    if (!spec) {
      this.error(`No spec found with name "${args.name}". Run 'api list' to see available specs.`)
    }

    const operation: StoredOperation | undefined = spec.operations.find((o) => o.operationId === args.operationId)
    if (!operation) {
      this.error(
        `Operation "${args.operationId}" not found in "${args.name}". Run 'api list ${args.name}' to see operations.`,
      )
    }

    const baseUrl = flags['base-url'] ?? spec.baseUrl
    if (!baseUrl) {
      this.error('No base URL set. Supply one with --base-url or re-import with `api import --base-url <url>`.')
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

    // ── Build body ─────────────────────────────────────────────────────────────
    const coercedBody: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(parsedBody)) {
      coercedBody[k] = coerceBodyValue(operation.bodyParams, k, v)
    }

    const isGraphQL = operation.graphql !== undefined
    const hasBody = isGraphQL || Object.keys(coercedBody).length > 0
    const requestBody = isGraphQL
      ? buildGraphQLBody(operation.graphql!.query, coercedBody)
      : hasBody
        ? JSON.stringify(coercedBody)
        : undefined

    // ── Build headers ──────────────────────────────────────────────────────────
    // parsedHeaders (from --header) take priority — they can override the inferred Content-Type.
    const headers: Record<string, string> = {
      ...buildAuthHeaders(spec.auth),
      ...headerParams,
    }
    if (hasBody && !parsedHeaders['Content-Type']) {
      headers['Content-Type'] = 'application/json'
    }

    Object.assign(headers, parsedHeaders)

    // ── Execute ────────────────────────────────────────────────────────────────
    const method = operation.method.toUpperCase()
    const reqInit = {body: requestBody, headers, method}

    this.log(`${method} ${url.toString()}`)

    const fetchFn = spec.insecure ? buildInsecureFetch() : this._fetch
    const res = await fetchFn(url.toString(), reqInit).catch((error: Error) => {
      this.error(`Request failed: ${error.message}`)
    })

    const responseText = await res.text()

    if (!res.ok) {
      this.warn(`HTTP ${res.status} ${res.statusText}`)
    }

    if (flags.raw) {
      this.log(responseText)
    } else {
      try {
        const parsed = JSON.parse(responseText)
        this.log(JSON.stringify(parsed, null, 2))
      } catch {
        this.log(responseText)
      }
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

  private _validateBodyParams(bodyParams: StoredOperation['bodyParams'], parsedBody: Record<string, string>): void {
    for (const [name, def] of Object.entries(bodyParams)) {
      if (def.required && parsedBody[name] === undefined) {
        this.error(`Missing required body field: ${name}`)
      }
    }
  }
}
