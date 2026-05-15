# MCP Server Authentication Design

**Date:** 2026-05-15
**Status:** Approved

## Overview

Add Bearer token authentication to the MCP server's HTTP transport. Auth is opt-in — if no token is configured the server runs as today (backward compatible). stdio transport is excluded (trusted local process).

## Storage & Auth Module

**New file:** `src/mcp-auth.ts`

Storage: `<configDir>/mcp-auth.json` — `{"token": "<64-char hex string>"}`

Exports:
- `readMcpAuth(configDir: string): Promise<string | null>` — returns token or null if file absent
- `writeMcpAuth(configDir: string, token: string): Promise<void>` — writes token to file
- `deleteMcpAuth(configDir: string): Promise<void>` — removes file

Token format: 32 random bytes as hex (`crypto.randomBytes(32).toString('hex')`).

Auth guard:
- `checkBearerToken(req: IncomingMessage, res: ServerResponse, token: string): boolean`
- Returns `true` if `Authorization: Bearer <token>` header matches
- Returns `false` and writes `401 Unauthorized` with `WWW-Authenticate: Bearer` header if missing or wrong

## Commands

Three new files under `src/commands/mcp/token/`:

| Command | File | Behaviour |
|---|---|---|
| `mcp token generate` | `generate.ts` | Generates 32-byte hex token, writes to `mcp-auth.json`, prints token once. Overwrites any existing token. |
| `mcp token show` | `show.ts` | Prints current token. Errors with non-zero exit if none configured. |
| `mcp token delete` | `delete.ts` | Removes `mcp-auth.json`. Prints confirmation. |

Pattern mirrors `src/commands/permission/` — one file per subcommand, no flags.

## HTTP Transport Change

In `startMcpServer` (`src/mcp-server.ts`):

1. Load token once: `const token = config.configDir ? await readMcpAuth(config.configDir) : null`
2. At the very top of the HTTP request handler (before path/method branching), if `token` is set, call `checkBearerToken(req, res, token)` — return early if it returns `false`
3. On startup, if token is configured, print `MCP server requires Bearer token authentication` to stderr alongside the existing listen message

No changes to stdio transport path.

## Backward Compatibility

- If `mcp-auth.json` does not exist, HTTP server runs without auth (existing behaviour)
- No breaking changes to `startMcpServer` or `createMcpServer` signatures

## Testing

- Unit tests for `readMcpAuth` / `writeMcpAuth` / `deleteMcpAuth` using a temp dir
- Unit tests for `checkBearerToken` covering: valid token, missing header, wrong token, malformed header
- Tests for each command (`generate`, `show`, `delete`) following existing command test patterns
- Integration: `startMcpServer` HTTP tests pass a valid/invalid/missing token and assert 200/401

## Files Changed

| Action | Path |
|---|---|
| Create | `src/mcp-auth.ts` |
| Create | `src/commands/mcp/token/generate.ts` |
| Create | `src/commands/mcp/token/show.ts` |
| Create | `src/commands/mcp/token/delete.ts` |
| Modify | `src/mcp-server.ts` |
| Modify | `test/mcp-server.test.ts` (if exists) |
| Create | `test/mcp-auth.test.ts` |
| Create | `test/commands/mcp/token/*.test.ts` |
