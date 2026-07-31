// Clients
export {AgentVault} from './client.js'
// Errors
export {AgentVaultError, AgentVaultSetupError, ApiError} from './errors.js'

// Request interception — routes traffic through the proxy that injects credentials
export {applyProxyEnv, defaultCertPath, interceptRequests, writeCaCertificate} from './proxy.js'

export type {InterceptMode, InterceptOptions, InterceptResult} from './proxy.js'

// Discover — what a token can reach, and the validation agent mode relies on
export {DiscoverResource} from './resources/discover.js'
export type {DiscoveredService, Discovery} from './resources/discover.js'

// MITM — the root CA and the proxy route both credential paths share
export {buildContainerConfig, MitmResource} from './resources/mitm.js'
export type {MitmInfo} from './resources/mitm.js'

// Sessions — the vault-scoped tokens the proxy authenticates with
export {buildProxyEnv, SessionsResource} from './resources/sessions.js'
export type {ContainerConfig, CreateSessionOptions, Session} from './resources/sessions.js'

// Config types
export type {AgentVaultConfig, ClientConfig, VaultClientConfig} from './types.js'
export {VaultClient} from './vault.js'
