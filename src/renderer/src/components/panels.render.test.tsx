import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
// The panels are code-split, so a broken import or a render-time crash would only
// surface when the user opens one. Rendering them here keeps that from shipping.
// The hooks only touch `window.klyro` inside effects, which server rendering skips.
vi.stubGlobal('window', {
  klyro: new Proxy(
    {},
    {
      get: () => async () => {
        throw new Error('panel hooks must not call IPC during the initial render')
      }
    }
  )
})

const { KnowledgePanel } = await import('./KnowledgePanel')
const { SettingsPanel } = await import('./SettingsPanel')

const noop = (): void => undefined

describe('lazy-loaded panels', () => {
  it('renders the knowledge panel', () => {
    const html = renderToStaticMarkup(<KnowledgePanel onClose={noop} />)
    expect(html).toContain('Knowledge')
    expect(html).toContain('Memory (0)')
    expect(html).toContain('role="dialog"')
  })

  it('renders the settings panel with a loading state while settings load', () => {
    const html = renderToStaticMarkup(<SettingsPanel onClose={noop} />)
    expect(html).toContain('Settings')
    expect(html).toContain('Loading settings')
  })
})
