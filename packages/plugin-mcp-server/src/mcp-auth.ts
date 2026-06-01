import type {IncomingMessage, ServerResponse} from 'node:http'

import {existsSync} from 'node:fs'
import {mkdir, readFile, unlink, writeFile} from 'node:fs/promises'
import {join} from 'node:path'

function authFilePath(configDir: string): string {
  return join(configDir, 'mcp-auth.json')
}

export async function readMcpAuth(configDir: string): Promise<null | string> {
  try {
    const content = await readFile(authFilePath(configDir), 'utf8')
    return (JSON.parse(content) as {token: string}).token
  } catch {
    return null
  }
}

export async function writeMcpAuth(configDir: string, token: string): Promise<void> {
  if (!existsSync(configDir)) {
    await mkdir(configDir, {recursive: true})
  }

  await writeFile(authFilePath(configDir), JSON.stringify({token}, null, 2), 'utf8')
}

export async function deleteMcpAuth(configDir: string): Promise<void> {
  try {
    await unlink(authFilePath(configDir))
  } catch {
    // file absent — nothing to do
  }
}

export function checkBearerToken(req: IncomingMessage, res: ServerResponse, token: string): boolean {
  if (req.headers.authorization === `Bearer ${token}`) return true
  res.writeHead(401, {'WWW-Authenticate': 'Bearer'})
  res.end('Unauthorized')
  return false
}
