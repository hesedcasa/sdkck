#!/usr/bin/env node
// A minimal, dependency-free MCP server over stdio (newline-delimited JSON-RPC)
// for the mcp-client e2e leg. It answers just enough of the protocol for
// `sdkck mcp client add` to connect and cache its tools, and echoes tool calls
// back so a dynamic command can be invoked end to end.

import {createInterface} from 'node:readline'

const TOOLS = [
  {
    description: 'Echo the given message back',
    inputSchema: {properties: {message: {description: 'Text to echo', type: 'string'}}, required: ['message'], type: 'object'},
    name: 'echo',
  },
  {
    description: 'Reply with pong',
    inputSchema: {properties: {}, type: 'object'},
    name: 'ping',
  },
]

function reply(id, result) {
  process.stdout.write(JSON.stringify({id, jsonrpc: '2.0', result}) + '\n')
}

function fail(id, code, message) {
  process.stdout.write(JSON.stringify({error: {code, message}, id, jsonrpc: '2.0'}) + '\n')
}

createInterface({input: process.stdin}).on('line', (line) => {
  if (!line.trim()) return
  let msg
  try {
    msg = JSON.parse(line)
  } catch {
    return
  }

  // Notifications (no id) need no answer.
  if (msg.id === undefined) return

  switch (msg.method) {
    case 'initialize': {
      reply(msg.id, {
        capabilities: {tools: {}},
        protocolVersion: msg.params?.protocolVersion ?? '2025-06-18',
        serverInfo: {name: 'sdkck-e2e-fixture', version: '1.0.0'},
      })
      break
    }

    case 'ping': {
      reply(msg.id, {})
      break
    }

    case 'tools/call': {
      const {arguments: args = {}, name} = msg.params ?? {}
      if (name === 'echo') reply(msg.id, {content: [{text: String(args.message), type: 'text'}]})
      else if (name === 'ping') reply(msg.id, {content: [{text: 'pong', type: 'text'}]})
      else fail(msg.id, -32_602, `Unknown tool: ${name}`)
      break
    }

    case 'tools/list': {
      reply(msg.id, {tools: TOOLS})
      break
    }

    default: {
      fail(msg.id, -32_601, `Method not found: ${msg.method}`)
    }
  }
})
