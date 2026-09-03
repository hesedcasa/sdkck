// Universal Auth — exchanging a machine identity for the token the proxy checks
export {DEFAULT_INFISICAL_DOMAIN, loginUniversalAuth} from './auth.js'
export type {IdentityToken, UniversalAuthOptions} from './auth.js'

// Root CA — the certificate `agent-proxy connect` leaves on disk
export {defaultCaPath, resolveCaCertificate} from './ca.js'
export type {CaSource} from './ca.js'

// Client
export {ENV as AGENT_PROXY_ENV, AgentProxy} from './client.js'
export type {AgentProxyInterceptOptions, AgentProxyInterceptResult} from './client.js'

// Config file — fallback for the INFISICAL_* environment variables
export {readAgentProxyFileConfig} from './config-file.js'
export type {AgentProxyFileConfig} from './config-file.js'

// Errors
export {AgentProxyApiError, AgentProxyError} from './errors.js'

// Route — the proxy URL an agent's traffic takes
export {buildAgentProxyRoute, DEFAULT_AGENT_PROXY_PORT, parseProxyAddress} from './route.js'
export type {AgentProxyRouteOptions} from './route.js'

// Config types
export type {AgentProxyConfig} from './types.js'
