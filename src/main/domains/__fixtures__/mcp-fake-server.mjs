// Test fixture: a minimal MCP server speaking newline-delimited JSON-RPC 2.0
// over stdio. Used by mcp.test.ts to exercise Klyro's real client end to end.
import { createInterface } from 'node:readline'

const rl = createInterface({ input: process.stdin })

rl.on('line', (line) => {
  const trimmed = line.trim()
  if (!trimmed) return
  let message
  try {
    message = JSON.parse(trimmed)
  } catch {
    return
  }
  if (!message.id && message.method) return // notifications need no reply

  let result = null
  switch (message.method) {
    case 'initialize':
      result = {
        protocolVersion: '2025-06-18',
        capabilities: { tools: {} },
        serverInfo: { name: 'fake-mcp', version: '0.0.1' }
      }
      break
    case 'tools/list':
      result = {
        tools: [
          {
            name: 'echo',
            description: 'Echoes back the arguments as text.',
            inputSchema: { type: 'object', properties: {} }
          }
        ]
      }
      break
    case 'tools/call':
      result = {
        content: [{ type: 'text', text: `echo:${JSON.stringify(message.params.arguments ?? {})}` }]
      }
      break
    default:
      process.stdout.write(
        JSON.stringify({ jsonrpc: '2.0', id: message.id, error: { code: -32601, message: `Method not found: ${message.method}` } }) + '\n'
      )
      return
  }
  process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: message.id, result }) + '\n')
})
