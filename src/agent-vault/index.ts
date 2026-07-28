// Clients
export {AgentVault} from './client.js'
// Errors
export {AgentVaultError, ApiError} from './errors.js'

// Request interception — routes traffic through the proxy that injects credentials
export {applyProxyEnv, defaultCertPath, interceptRequests, writeCaCertificate} from './proxy.js'

export type {InterceptOptions, InterceptResult} from './proxy.js'

// Sessions — the vault-scoped tokens the proxy authenticates with
export {buildProxyEnv, SessionsResource} from './resources/sessions.js'
export type {ContainerConfig, CreateSessionOptions, Session} from './resources/sessions.js'

// Config types
export type {AgentVaultConfig, ClientConfig, VaultClientConfig} from './types.js'
export {VaultClient} from './vault.js'
