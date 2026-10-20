import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const userData = mkdtempSync(join(tmpdir(), 'klyro-mcp-'))

vi.mock('electron', () => ({
  app: { getPath: () => userData, on: () => undefined, getVersion: () => '0-test' }
}))

const { mcp } = await import('./mcp')
const fixture = fileURLToPath(new URL('./__fixtures__/mcp-fake-server.mjs', import.meta.url))

let serverId = ''

beforeEach(() => {
  const config = mcp.add('fake', 'node', [fixture])
  serverId = config.id
})

describe('MCP stdio client', () => {
  it('adds and removes plain commands, refusing URLs', () => {
    expect(mcp.list()).toHaveLength(1)
    expect(() => mcp.add('bad', 'https://evil.example/nope', [])).toThrow(/plain executable/i)
  })

  it('handshakes over stdio and lists tools', async () => {
    const tools = await mcp.tools(serverId)
    expect(tools).toHaveLength(1)
    expect(tools[0]).toMatchObject({ name: 'echo', description: expect.stringContaining('Echoes') })
  }, 30000)

  it('lists the resources and prompts a server publishes', async () => {
    const described = await mcp.describe(serverId)
    expect(described.resources[0]).toMatchObject({ uri: 'file:///notes/today.md', name: 'today.md' })
    expect(described.prompts[0]).toMatchObject({ name: 'summarise' })
  }, 30000)

  it('reads a resource through the protocol', async () => {
    const text = await mcp.readResource(serverId, 'file:///notes/today.md')
    expect(text).toContain('the note body')
  }, 30000)

  it('serialises a second request on the same connection and calls a tool', async () => {
    const [tools, called] = await Promise.all([mcp.tools(serverId), mcp.call(serverId, 'echo', { message: 'hi' })])
    expect(tools).toBeTruthy()
    expect(called).toMatchObject({ ok: true, text: 'echo:{"message":"hi"}' })
  }, 30000)

  it('reports connection failures honestly for a dead command', async () => {
    const dead = mcp.add('dead', '/nonexistent-klyro-command-nope', [])
    await expect(mcp.tools(dead.id)).rejects.toThrow(/launch|did not answer/i)
  }, 30000)

  it('removes servers and kills their processes', async () => {
    mcp.remove(serverId)
    expect(mcp.list()).toHaveLength(1) // only the "dead" server from the previous test
    await expect(mcp.tools(serverId)).rejects.toThrow(/unknown MCP server/i)
  })
})
