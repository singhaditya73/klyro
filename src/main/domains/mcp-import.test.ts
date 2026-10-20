import { mkdtempSync, writeFileSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'

const userData = mkdtempSync(join(tmpdir(), 'klyro-mcpimport-'))

vi.mock('electron', () => ({
  app: { getPath: () => userData, on: () => undefined, getVersion: () => '0-test' }
}))

const { mcpImport, parseJsonc } = await import('./mcp-import')

describe('MCP import', () => {
  it('parses JSONC with comments and trailing commas', () => {
    const parsed = parseJsonc(`{
      // a comment
      "mcp": {
        "rea": {
          "type": "local",
          "command": ["/usr/bin/rea", "mcp"],
          "environment": { "JAVA_HOME": "/opt/jdk" }
        }
      },
    }`) as Record<string, unknown>
    expect(parsed).toBeTruthy()
    expect(JSON.stringify(parsed)).toContain('rea')
  })

  it('finds local servers in an OpenCode-style config', () => {
    const dir = mkdtempSync(join(tmpdir(), 'klyro-config-'))
    const configHome = join(dir, 'opencode')
    mkdirSync(configHome, { recursive: true })
    writeFileSync(
      join(configHome, 'opencode.jsonc'),
      `{
        // my servers
        "mcp": {
          "rea": {
            "type": "local",
            "command": ["/home/user/.nvm/bin/rea", "mcp"],
            "environment": { "JAVA_HOME": "/opt/jdk-21" },
            "enabled": true
          },
          "disabled-one": { "type": "local", "command": ["/bin/other"], "enabled": false }
        }
      }`
    )
    process.env.XDG_CONFIG_HOME = dir
    const found = mcpImport.discover([])
    expect(found).toHaveLength(1)
    expect(found[0]).toMatchObject({
      source: 'opencode',
      name: 'rea',
      command: '/home/user/.nvm/bin/rea',
      args: ['mcp'],
      env: { JAVA_HOME: '/opt/jdk-21' }
    })
  })
})
