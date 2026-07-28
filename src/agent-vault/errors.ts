/**
 * Base error for every Agent Vault failure raised locally: missing
 * configuration, network problems and request timeouts.
 */
export class AgentVaultError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'AgentVaultError'
  }
}

/**
 * Error returned by the Agent Vault control-plane API. Wraps a non-2xx HTTP
 * response with its status, machine-readable code and response headers.
 */
export class ApiError extends AgentVaultError {
  readonly code: string
  readonly headers: Headers
  readonly status: number

  constructor({
    code,
    headers,
    message,
    status,
  }: {
    code: string
    headers: Headers
    message: string
    status: number
  }) {
    super(message)
    this.name = 'ApiError'
    this.status = status
    this.code = code
    this.headers = headers
  }

  static async fromResponse(response: Response): Promise<ApiError> {
    let code = 'unknown'
    let message = response.statusText

    try {
      const body: unknown = await response.json()
      if (typeof body === 'object' && body !== null) {
        const record = body as Record<string, unknown>
        if (typeof record.error === 'string') {
          code = record.error
          message = typeof record.message === 'string' ? record.message : record.error
        }
      }
    } catch {
      // Body was not JSON — keep the status text as the message.
    }

    return new ApiError({code, headers: response.headers, message, status: response.status})
  }
}
