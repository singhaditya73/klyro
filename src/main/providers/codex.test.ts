import { chmodSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { codexProvider, findCodexBinary } from './codex'

/** A fake `codex` that behaves like the real one: the final message on stdout. */
function writeFakeBinary(): string {
  const dir = mkdtempSync(join(tmpdir(), 'klyro-fakecodex-'))
  const file = join(dir, 'codex')
  writeFileSync(file, `#!/bin/sh\nsleep 0.2\necho "Codex says: $2"\n`)
  chmodSync(file, 0o755)
  return file
}

describe('Codex CLI provider', () => {
  it('finds the binary and answers with the agent output', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'klyro-fakecodex-path-'))
    const binary = writeFakeBinary()
    // The fake lives in its own directory; put that on PATH.
    process.env.PATH = `${binary.slice(0, binary.lastIndexOf('/'))}:${process.env.PATH ?? ''}`

    expect(findCodexBinary()).toBe(binary)

    const chunks: string[] = []
    for await (const chunk of codexProvider.chat({
      model: '',
      baseUrl: '',
      apiKey: null,
      turns: [{ role: 'user', text: 'hello' }]
    })) {
      chunks.push(chunk)
    }
    expect(chunks.join('').trim()).toBe('Codex says: hello')
  }, 30000)

  it('says so plainly when Codex is not installed', async () => {
    const savedPath = process.env.PATH
    process.env.PATH = '/nonexistent'
    try {
      const result = await codexProvider.test({ baseUrl: '', apiKey: null, model: '' })
      expect(result.ok).toBe(false)
      expect(result.detail).toMatch(/not installed/i)
    } finally {
      process.env.PATH = savedPath
    }
  }, 20000)
})
