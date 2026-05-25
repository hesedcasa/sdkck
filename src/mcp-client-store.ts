import {existsSync} from 'node:fs'
import {mkdir, readdir, readFile, unlink, writeFile} from 'node:fs/promises'
import {join} from 'node:path'

// ─── Types ────────────────────────────────────────────────────────────────────

export interface McpServerConfig {
  args?: string[]
  // stdio transport
  command?: string
  env?: Record<string, string>
  headers?: Record<string, string>
  name: string
  transport: 'http' | 'stdio'
  // http transport
  url?: string
}

export interface McpSchemaProperty {
  [key: string]: unknown
  description?: string
  enum?: string[]
  items?: McpSchemaProperty
  properties?: Record<string, McpSchemaProperty>
  type?: string
}

export interface McpToolSchema {
  description?: string
  inputSchema: {
    [key: string]: unknown
    properties?: Record<string, McpSchemaProperty>
    required?: string[]
    type: 'object'
  }
  name: string
}

interface McpClientServerFile {
  cachedTools?: McpToolSchema[]
  cacheTimestamp?: number
  config: McpServerConfig
}

interface McpToolResult {
  content: Array<{data?: string; mimeType?: string; text?: string; type: string}>
  isError?: boolean
}

// ─── File paths ───────────────────────────────────────────────────────────────

const TOOL_CACHE_TTL_MS = 60 * 60 * 1000 // 1 hour

function serverFilePath(configDir: string, name: string): string {
  return join(configDir, `mcp-client-${name}.json`)
}

// ─── Read / write / delete ────────────────────────────────────────────────────

export async function readServerFile(configDir: string, name: string): Promise<McpClientServerFile | null> {
  const fp = serverFilePath(configDir, name)
  if (!existsSync(fp)) return null
  try {
    const raw = await readFile(fp, 'utf8')
    return JSON.parse(raw) as McpClientServerFile
  } catch {
    return null
  }
}

export async function writeServerFile(configDir: string, data: McpClientServerFile): Promise<void> {
  if (!existsSync(configDir)) {
    await mkdir(configDir, {recursive: true})
  }

  await writeFile(serverFilePath(configDir, data.config.name), JSON.stringify(data, null, 2), 'utf8')
}

export async function deleteServerFile(configDir: string, name: string): Promise<boolean> {
  const fp = serverFilePath(configDir, name)
  try {
    await unlink(fp)
    return true
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false
    throw error
  }
}

export async function listServerFiles(configDir: string): Promise<McpClientServerFile[]> {
  if (!existsSync(configDir)) return []

  let files: string[]
  try {
    files = await readdir(configDir)
  } catch {
    return []
  }

  const serverFiles = files.filter((f) => /^mcp-client-.+\.json$/.test(f))
  const results = await Promise.all(
    serverFiles.map(async (file) => {
      try {
        const raw = await readFile(join(configDir, file), 'utf8')
        return JSON.parse(raw) as McpClientServerFile
      } catch {
        return null
      }
    }),
  )

  return results.filter(Boolean) as McpClientServerFile[]
}

export function isToolCacheStale(data: McpClientServerFile): boolean {
  if (!data.cachedTools || data.cachedTools.length === 0) return true
  if (data.cacheTimestamp === undefined) return true
  return Date.now() - data.cacheTimestamp > TOOL_CACHE_TTL_MS
}

// ─── MCP transport helpers ────────────────────────────────────────────────────

async function createTransport(config: McpServerConfig) {
  if (config.transport === 'stdio') {
    // eslint-disable-next-line import/no-unresolved
    const {StdioClientTransport} = await import('@modelcontextprotocol/sdk/client/stdio.js')
    return new StdioClientTransport({
      args: config.args ?? [],
      command: config.command!,
      env: config.env ? ({...process.env, ...config.env} as Record<string, string>) : undefined,
      stderr: 'pipe',
    })
  }

  // eslint-disable-next-line import/no-unresolved
  const {StreamableHTTPClientTransport} = await import('@modelcontextprotocol/sdk/client/streamableHttp.js')
  return new StreamableHTTPClientTransport(new URL(config.url!), {
    requestInit: {headers: config.headers},
  })
}

// ─── Tool discovery ───────────────────────────────────────────────────────────

export async function discoverTools(config: McpServerConfig): Promise<McpToolSchema[]> {
  // eslint-disable-next-line import/no-unresolved
  const {Client} = await import('@modelcontextprotocol/sdk/client/index.js')
  const transport = await createTransport(config)
  const client = new Client({name: 'sdkck', version: '1.0.0'})

  try {
    await client.connect(transport)
    const result = await client.listTools()
    return result.tools as unknown as McpToolSchema[]
  } finally {
    await client.close().catch(() => {})
  }
}

// ─── Tool invocation ──────────────────────────────────────────────────────────

export async function callMcpTool(
  config: McpServerConfig,
  toolName: string,
  args: Record<string, unknown>,
): Promise<McpToolResult> {
  // eslint-disable-next-line import/no-unresolved
  const {Client} = await import('@modelcontextprotocol/sdk/client/index.js')
  const transport = await createTransport(config)
  const client = new Client({name: 'sdkck', version: '1.0.0'})

  try {
    await client.connect(transport)
    const result = await client.callTool({arguments: args, name: toolName})
    return result as unknown as McpToolResult
  } finally {
    await client.close().catch(() => {})
  }
}
