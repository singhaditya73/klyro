import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

interface Harness {
  userData: string
  files: Map<string, string>
  logs: string[]
}

function makeHarness(): Harness {
  return {
    userData: mkdtempSync(join(tmpdir(), 'klyro-store-')),
    files: new Map(),
    logs: []
  }
}

function mockFs(harness: Harness) {
  vi.doMock('node:fs', () => ({
    existsSync: (p: string) => harness.files.has(p),
    readFileSync: (p: string) => {
      const v = harness.files.get(p)
      if (v === undefined) throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' })
      return v
    },
    writeFileSync: (p: string, v: string) => {
      harness.files.set(p, v)
    },
    rmSync: (p: string) => {
      harness.files.delete(p)
    },
    renameSync: (from: string, to: string) => {
      const v = harness.files.get(from)
      if (v === undefined) throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' })
      harness.files.delete(from)
      harness.files.set(to, v)
    },
    mkdirSync: () => undefined,
    readdirSync: (dir: string) => {
      const prefix = dir + '/'
      return [...harness.files.keys()]
        .filter((k) => k.startsWith(prefix))
        .map((k) => k.slice(prefix.length))
    },
    statSync: (p: string) => {
      const v = harness.files.get(p)
      if (v === undefined) throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' })
      return { size: Buffer.byteLength(v, 'utf8'), isFile: () => true, isDirectory: () => false, mtimeMs: Date.now() }
    }
  }))
}

function mockElectron(harness: Harness) {
  vi.doMock('electron', () => ({
    app: { getPath: () => harness.userData }
  }))
}

function mockLogger(harness: Harness) {
  vi.doMock('../logger', () => ({
    logger: {
      info: (msg: string) => harness.logs.push(`info: ${msg}`),
      warn: (msg: string) => harness.logs.push(`warn: ${msg}`),
      error: (msg: string, ...args: any[]) => harness.logs.push(`error: ${msg} ${args.join(' ')}`)
    }
  }))
}

describe('JsonStore', () => {
  let harness: Harness

  beforeEach(async () => {
    harness = makeHarness()
    mockFs(harness)
    mockElectron(harness)
    mockLogger(harness)
    vi.resetModules()
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('creates a new file from defaults on first run', async () => {
    const { JsonStore } = await import('../store/json-store')
    const store = new JsonStore('test.json', { a: 1, b: 'x' })
    expect(store.get()).toEqual({ a: 1, b: 'x' })
  })

  it('merges stored values over defaults', async () => {
    const { JsonStore } = await import('../store/json-store')
    const file = join(harness.userData, 'test.json')
    harness.files.set(file, '{"b":"stored"}')
    const store = new JsonStore('test.json', { a: 1, b: 'x' })
    expect(store.get()).toEqual({ a: 1, b: 'stored' })
  })

  it('writes atomically via a temp file', async () => {
    const { JsonStore } = await import('../store/json-store')
    const file = join(harness.userData, 'test.json')
    const store = new JsonStore('test.json', { a: 1 })
    store.set({ a: 2 })
    expect(harness.files.get(file)).toContain('2')
    expect(harness.files.has(file + '.tmp')).toBe(false)
  })

  it('discards a stray .tmp file on construction', async () => {
    const { JsonStore } = await import('../store/json-store')
    const file = join(harness.userData, 'test.json')
    const tmp = file + '.tmp'
    harness.files.set(tmp, 'unfinished')
    new JsonStore('test.json', { a: 1 })
    expect(harness.files.has(tmp)).toBe(false)
    expect(harness.logs.some((l) => l.includes('unfinished store write'))).toBe(true)
  })

  it('quarantines an unreadable file instead of overwriting it', async () => {
    const { JsonStore } = await import('../store/json-store')
    const file = join(harness.userData, 'test.json')
    harness.files.set(file, 'not json')
    const store = new JsonStore('test.json', { a: 1 })
    expect(store.get()).toEqual({ a: 1 })
    const quarantined = [...harness.files.keys()].find((k) => k.includes('.corrupt-'))
    expect(quarantined).toBeTruthy()
    expect(harness.logs.some((l) => l.includes('could not be parsed'))).toBe(true)
  })
})

describe('storage sweep', () => {
  let harness: Harness

  beforeEach(async () => {
    harness = makeHarness()
    mockFs(harness)
    mockElectron(harness)
    mockLogger(harness)
    vi.resetModules()
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('removes .tmp files in the root', async () => {
    const { sweepStorage } = await import('../store/storage')
    const file = join(harness.userData, 'something.tmp')
    harness.files.set(file, 'unfinished')
    const result = sweepStorage(harness.userData, new Set())
    expect(result.removedTempFiles).toBe(1)
    expect(result.freedBytes).toBeGreaterThan(0)
  })

  it('keeps patch backups that are still referenced', async () => {
    const { sweepStorage } = await import('../store/storage')
    const backup = join(harness.userData, 'patch-backups', 'abc123-file.ts')
    harness.files.set(backup, 'backup content')
    const result = sweepStorage(harness.userData, new Set([backup]))
    expect(result.removedBackups).toBe(0)
    expect(harness.files.has(backup)).toBe(true)
  })

  it('removes orphaned patch backups', async () => {
    const { sweepStorage } = await import('../store/storage')
    const backup = join(harness.userData, 'patch-backups', 'abc123-file.ts')
    harness.files.set(backup, 'backup content')
    const result = sweepStorage(harness.userData, new Set())
    expect(result.removedBackups).toBe(1)
    expect(harness.files.has(backup)).toBe(false)
  })
})