import { describe, expect, it } from 'vitest'
import {
  detectLanguage,
  isIndexableFile,
  isSecretFile,
  parseMeetingSummary,
  renderTemplate,
  shouldSkipDirectory
} from './code-files'

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

  it('excludes obvious secret and credential files from indexing', () => {
    expect(isIndexableFile('.env', 100)).toBe(false)
    expect(isIndexableFile('.env.local', 100)).toBe(false)
    expect(isIndexableFile('certs/server.pem', 100)).toBe(false)
    expect(isIndexableFile('deploy/id_rsa', 100)).toBe(false)
    expect(isIndexableFile('secrets.yaml', 100)).toBe(false)
    expect(isIndexableFile('credentials.json', 100)).toBe(false)
    expect(isIndexableFile('.npmrc', 100)).toBe(false)
    // Non-secret lookalikes stay indexable.
    expect(isIndexableFile('src/environment.ts', 100)).toBe(true)
    expect(isIndexableFile('docs/secrets-policy.md', 100)).toBe(true)
  })
})

describe('isSecretFile', () => {
  it('flags private key material but not public certificates', () => {
    expect(isSecretFile('.env.production')).toBe(true)
    expect(isSecretFile('id_ed25519')).toBe(true)
    expect(isSecretFile('client.p12')).toBe(true)
    expect(isSecretFile('server.crt')).toBe(false)
    expect(isSecretFile('index.ts')).toBe(false)
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

  it('accepts alternative action-item keys and string payloads', () => {
    const alt = parseMeetingSummary('{"summary":"Reviewed the plan.","actionItems":["Send notes"]}')
    expect(alt.actions).toEqual(['Send notes'])

    const asString = parseMeetingSummary('{"summary":"Reviewed.","action_items":"- Send notes\\n- Book the room"}')
    expect(asString.actions).toEqual(['Send notes', 'Book the room'])
  })

  it('cleans and de-duplicates action items', () => {
    const parsed = parseMeetingSummary(
      '{"summary":"Reviewed.","actions":[" 1. Send notes ","Send notes","- Send notes!","x","","Book the room"]}'
    )
    expect(parsed.actions).toEqual(['Send notes', 'Book the room'])
  })

  it('caps the number of action items', () => {
    const many = `{"summary":"Reviewed.","actions":${JSON.stringify(
      Array.from({ length: 40 }, (_, index) => `Action number ${index}`)
    )}}`
    expect(parseMeetingSummary(many).actions).toHaveLength(20)
  })
})
