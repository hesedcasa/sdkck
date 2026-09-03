/**
 * Configuration for the Agent Proxy client.
 *
 * Every field resolves in the same order: explicit config > environment
 * variable > `<configDir>/agent-proxy.json` > default. The config file is only
 * read when explicit config and the environment do not already cover what is
 * needed, so a fully-specified client is never broken by an unrelated
 * malformed file.
 */
export type AgentProxyConfig = {
  /**
   * Where the Agent Proxy listens: `host`, `host:port`, or a full URL. Falls
   * back to `INFISICAL_AGENT_PROXY_ADDRESS`, then `address` in the config
   * file. Required — there is no sensible default host for a proxy that is
   * meant to sit on your own network.
   */
  address?: string
  /**
   * Path to the MITM root CA PEM. Falls back to `INFISICAL_AGENT_PROXY_CA`,
   * then `caPath` in the config file, then the path `agent-proxy connect`
   * writes (`~/.infisical/agent-proxy/mitm-ca.pem`).
   */
  caPath?: string
  /** Root CA PEM supplied inline. Wins over `caPath`; nothing is read from disk. */
  caPem?: string
  /** Machine identity client ID. Falls back to `INFISICAL_UNIVERSAL_AUTH_CLIENT_ID`. */
  clientId?: string
  /** Machine identity client secret. Falls back to `INFISICAL_UNIVERSAL_AUTH_CLIENT_SECRET`. */
  clientSecret?: string
  /** Infisical instance to authenticate against. Falls back to `INFISICAL_DOMAIN`. */
  domain?: string
  /** Environment to resolve configuration from. Defaults to `process.env`. */
  envSource?: NodeJS.ProcessEnv
  /** Custom fetch implementation, for tests or non-Node runtimes. */
  fetch?: typeof globalThis.fetch
  /** Login request timeout in milliseconds. Default: 30000. */
  timeout?: number
  /**
   * A pre-issued machine identity token, used as-is instead of logging in.
   * Falls back to `INFISICAL_TOKEN`, then `token` in the config file.
   */
  token?: string
}
