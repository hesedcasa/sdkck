import type {ClientConfig} from './types.js'

import {readAgentVaultFileConfig} from './config-file.js'
import {AgentVaultError, ApiError} from './errors.js'

type HttpMethod = 'DELETE' | 'GET' | 'HEAD' | 'PATCH' | 'POST' | 'PUT'

type RequestOptions = {
  body?: unknown
  headers?: Record<string, string>
  query?: Record<string, boolean | number | string>
  signal?: AbortSignal
}

type RawRequestOptions = {
  headers?: Record<string, string>
  query?: Record<string, boolean | number | string>
  signal?: AbortSignal
  timeout?: number
}

type HttpClientConfig = {
  baseUrl: string
  fetchFn?: typeof globalThis.fetch
  headers?: Record<string, string>
  timeout?: number
  token: string
}

const SDK_VERSION = '0.1.0'
const USER_AGENT = `sdkck-agent-vault-sdk/${SDK_VERSION}`
const DEFAULT_TIMEOUT = 30_000

/** Default Agent Vault management API address. */
const DEFAULT_ADDRESS = 'http://localhost:14321'
/** Environment variable holding the Agent Vault token. */
const ENV_TOKEN = 'AGENT_VAULT_TOKEN'
/** Environment variable holding the Agent Vault management API address. */
const ENV_ADDR = 'AGENT_VAULT_ADDR'

/**
 * Internal HTTP client wrapping `fetch` with Agent Vault conventions:
 *
 * - injects `Authorization: Bearer` and `Content-Type: application/json`
 * - enforces a request timeout through an `AbortController`
 * - turns non-2xx responses into {@link ApiError}
 * - derives immutable copies via {@link HttpClient.withHeaders} for `X-Vault` scoping
 */
export class HttpClient {
  private readonly baseUrl: string
  private readonly defaultHeaders: Record<string, string>
  private readonly fetchFn: typeof globalThis.fetch
  private readonly timeout: number
  private readonly token: string

  constructor(config: HttpClientConfig) {
    this.baseUrl = config.baseUrl.replace(/\/+$/, '')
    this.token = config.token
    this.defaultHeaders = config.headers ?? {}
    this.fetchFn = config.fetchFn ?? globalThis.fetch
    this.timeout = config.timeout ?? DEFAULT_TIMEOUT
  }

  /**
   * Resolve a {@link ClientConfig} — from explicit values, environment
   * variables, and finally `<configDir>/agent-vault.json` — into an
   * `HttpClient`.
   *
   * @throws {AgentVaultError} when no token can be resolved, or when the
   *   config file exists but is malformed.
   */
  static fromConfig(config?: ClientConfig): HttpClient {
    const cfg = config ?? {}
    const envToken = process.env[ENV_TOKEN]
    const envAddr = process.env[ENV_ADDR]

    // Only touch the fallback file when explicit config + env don't already
    // cover both values — a fully-specified client must not be broken by an
    // unrelated, malformed agent-vault.json it never needed to read.
    const isFileConfigNeeded = (cfg.token ?? envToken) === undefined || (cfg.address ?? envAddr) === undefined
    const fileConfig = isFileConfigNeeded ? readAgentVaultFileConfig() : {}

    const token = cfg.token ?? envToken ?? fileConfig.token
    if (!token) {
      throw new AgentVaultError(
        `Token is required. Provide it in the config, set the ${ENV_TOKEN} environment variable, or add "token" to <configDir>/agent-vault.json.`,
      )
    }

    return new HttpClient({
      baseUrl: cfg.address ?? envAddr ?? fileConfig.address ?? DEFAULT_ADDRESS,
      fetchFn: cfg.fetch,
      headers: cfg.headers,
      timeout: cfg.timeout,
      token,
    })
  }

  async get<T>(path: string, options?: Omit<RequestOptions, 'body'>): Promise<T> {
    return this.request<T>('GET', path, options)
  }

  /** The base URL this client talks to. */
  getBaseUrl(): string {
    return this.baseUrl
  }

  /**
   * The bearer token this client authenticates with.
   *
   * Needed by the agent-mode credential path, where the token itself is the
   * proxy credential rather than something used to mint one.
   */
  getToken(): string {
    return this.token
  }

  async post<T>(path: string, body?: unknown, options?: Omit<RequestOptions, 'body'>): Promise<T> {
    return this.request<T>('POST', path, {...options, body})
  }

  /**
   * Perform a request and return the raw `Response` without parsing the body
   * or throwing on non-2xx. Used where the payload is not the standard Agent
   * Vault JSON envelope, e.g. the PEM-encoded MITM CA certificate.
   */
  async raw(method: string, path: string, options?: RawRequestOptions): Promise<Response> {
    return this.doFetch({
      headers: this.buildHeaders(options?.headers),
      label: `${method} ${path}`,
      method,
      signal: options?.signal,
      timeoutMs: options?.timeout ?? this.timeout,
      url: this.buildUrl(path, options?.query),
    })
  }

  async request<T>(method: HttpMethod, path: string, options?: RequestOptions): Promise<T> {
    const hasBody = options?.body !== undefined
    const callerHeaders = hasBody ? {...options?.headers, 'Content-Type': 'application/json'} : options?.headers

    const response = await this.doFetch({
      body: hasBody ? JSON.stringify(options.body) : undefined,
      headers: this.buildHeaders(callerHeaders),
      label: `${method} ${path}`,
      method,
      signal: options?.signal,
      timeoutMs: this.timeout,
      url: this.buildUrl(path, options?.query),
    })

    if (!response.ok) {
      throw await ApiError.fromResponse(response)
    }

    return (await response.json()) as T
  }

  /** A copy of this client with extra default headers merged in. */
  withHeaders(extra: Record<string, string>): HttpClient {
    return new HttpClient({
      baseUrl: this.baseUrl,
      fetchFn: this.fetchFn,
      headers: {...this.defaultHeaders, ...extra},
      timeout: this.timeout,
      token: this.token,
    })
  }

  private buildHeaders(callerHeaders?: Record<string, string>): Record<string, string> {
    // Authorization and User-Agent are protected — callers cannot override them.
    return {
      ...this.defaultHeaders,
      ...callerHeaders,
      Authorization: `Bearer ${this.token}`,
      'User-Agent': USER_AGENT,
    }
  }

  private buildUrl(path: string, query?: Record<string, boolean | number | string>): string {
    let url = `${this.baseUrl}${path}`
    if (query) {
      const params = new URLSearchParams()
      for (const [key, value] of Object.entries(query)) {
        if (value !== undefined) params.set(key, String(value))
      }

      const qs = params.toString()
      if (qs) url += `?${qs}`
    }

    return url
  }

  private async doFetch(opts: {
    body?: string
    headers: Record<string, string>
    label: string
    method: string
    signal?: AbortSignal
    timeoutMs: number
    url: string
  }): Promise<Response> {
    const controller = new AbortController()
    const hasTimeout = opts.timeoutMs > 0 && Number.isFinite(opts.timeoutMs)
    let isTimedOut = false
    const timeoutId = hasTimeout
      ? setTimeout(() => {
          isTimedOut = true
          controller.abort()
        }, opts.timeoutMs)
      : undefined

    const callerSignal = opts.signal
    const onCallerAbort = () => {
      controller.abort()
    }

    if (callerSignal) {
      if (callerSignal.aborted) {
        controller.abort()
      } else {
        callerSignal.addEventListener('abort', onCallerAbort, {once: true})
      }
    }

    try {
      return await this.fetchFn(opts.url, {
        body: opts.body,
        headers: opts.headers,
        method: opts.method,
        signal: controller.signal,
      })
    } catch (error) {
      if (isTimedOut) {
        throw new AgentVaultError(`Request timed out after ${opts.timeoutMs}ms: ${opts.label}`)
      }

      if (callerSignal?.aborted) {
        throw new AgentVaultError(`Request aborted: ${opts.label}`)
      }

      throw new AgentVaultError(`Network error: ${error instanceof Error ? error.message : String(error)}`)
    } finally {
      if (timeoutId !== undefined) clearTimeout(timeoutId)
      callerSignal?.removeEventListener('abort', onCallerAbort)
    }
  }
}
