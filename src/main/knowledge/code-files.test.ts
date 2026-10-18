import { describe, expect, it } from 'vitest'
import { detectLanguage, isIndexableFile, parseMeetingSummary, renderTemplate, shouldSkipDirectory } from './code-files'

describe('isIndexableFile', () => {
  it('accepts source files', () => {
    expect(isIndexableFile('src/main/index.ts', 1000)).toBe(true)
    expect(isIndexableFile('README.md', 500)).toBe(true)
    expect(isIndexableFile('Dockerfile', 200)).toBe(true)
  })

  it('rejects lockfiles, minified bundles, maps, and generated code', () => {
    expect(isIndexableFile('package-lock.json', 100)).toBe(true) // .json is allowed…
    expect(isIndexableFile('app.min.js', 100)).toBe(false)
    expect(isIndexableFile('styles.min.css', 100)).toBe(false)
    expect(isIndexableFile('bundle.js.map', 100)).toBe(false)
    expect(isIndexableFile('yarn.lock', 100)).toBe(false)
  })

  it('rejects unknown extensions, empty files, and oversized files', () => {
    expect(isIndexableFile('image.png', 100)).toBe(false)
    expect(isIndexableFile('src/empty.ts', 0)).toBe(false)
    expect(isIndexableFile('src/huge.ts', 900 * 1024)).toBe(false)
    expect(isIndexableFile('src/ok.ts', 900 * 1024, 2 * 1024 * 1024)).toBe(true)
  })

  it('rejects extensionless files that are not tooling entry points', () => {
    expect(isIndexableFile('LICENSE', 100)).toBe(false)
  })
})

describe('shouldSkipDirectory', () => {
  it('skips build and dependency directories but keeps .github', () => {
    expect(shouldSkipDirectory('node_modules')).toBe(true)
    expect(shouldSkipDirectory('dist')).toBe(true)
    expect(shouldSkipDirectory('.git')).toBe(true)
    expect(shouldSkipDirectory('src')).toBe(false)
    expect(shouldSkipDirectory('.github')).toBe(false)
  })
})

describe('detectLanguage', () => {
  it('maps extensions to language names', () => {
    expect(detectLanguage('src/a.tsx')).toBe('tsx')
    expect(detectLanguage('main.py')).toBe('python')
    expect(detectLanguage('Dockerfile')).toBe('dockerfile')
    expect(detectLanguage('weird.qqq')).toBe('text')
  })
})

describe('renderTemplate', () => {
  it('substitutes placeholders and tolerates whitespace', () => {
    expect(renderTemplate('Hi {{name}}, {{  role }}!', { name: 'Ada', role: 'engineer' })).toBe('Hi Ada, engineer!')
  })

  it('renders unknown placeholders as empty strings', () => {
    expect(renderTemplate('a {{missing}} b', {})).toBe('a  b')
  })

  it('supports dotted keys', () => {
    expect(renderTemplate('{{ a.b }}', { 'a.b': 'x' })).toBe('x')
  })
})

describe('parseMeetingSummary', () => {
  it('prefers a JSON payload', () => {
    const raw = 'Here you go:\n{"summary":"We shipped Stage C.","actions":["Write the changelog","Update the README"]}'
    expect(parseMeetingSummary(raw)).toEqual({
      summary: 'We shipped Stage C.',
      actions: ['Write the changelog', 'Update the README']
    })
  })

  it('falls back to bullets in prose', () => {
    const raw = 'The team reviewed progress.\n- Alice will write tests\n* Bob to update docs\n2. Ship on Friday'
    const parsed = parseMeetingSummary(raw)
    expect(parsed.actions).toEqual(['Alice will write tests', 'Bob to update docs', 'Ship on Friday'])
    expect(parsed.summary).toBe('The team reviewed progress.')
  })

  it('handles empty input', () => {
    expect(parseMeetingSummary('   ')).toEqual({ summary: '', actions: [] })
  })
})
