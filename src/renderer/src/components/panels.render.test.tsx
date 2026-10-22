import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
// The views are code-split, so a broken import or a render-time crash would
// only surface when the user opens one. Rendering them here keeps that from
// shipping. The hooks only touch `window.klyro` inside effects, which server
// rendering skips.
vi.stubGlobal('window', {
  location: { hash: '' },
  addEventListener: () => undefined,
  removeEventListener: () => undefined,
  matchMedia: () => ({ matches: false, addEventListener: () => undefined, removeEventListener: () => undefined }),
  klyro: new Proxy(
    {},
    {
      get: () => async () => {
        throw new Error('view hooks must not call IPC during the initial render')
      }
    }
  )
})

const { KnowledgeView } = await import('./KnowledgeView')
const { SettingsView } = await import('./SettingsView')
const { InterviewsView } = await import('./InterviewsView')
const { ModelsView } = await import('./ModelsView')
const { HomeView } = await import('./HomeView')
const { PrivacyView } = await import('./PrivacyView')

const noop = (): void => undefined

describe('lazy-loaded views', () => {
  it('renders the knowledge view', () => {
    const html = renderToStaticMarkup(<KnowledgeView />)
    expect(html).toContain('Knowledge')
    expect(html).toContain('Memory (0)')
  })

  it('renders the settings view with a loading state while settings load', () => {
    const html = renderToStaticMarkup(<SettingsView onNavigate={noop} />)
    expect(html).toContain('Settings')
    expect(html).toContain('Loading settings')
  })

  it('renders the interviews view', () => {
    const html = renderToStaticMarkup(<InterviewsView />)
    expect(html).toContain('Interviews')
  })

  it('renders the models view', () => {
    const html = renderToStaticMarkup(<ModelsView onNavigate={noop} />)
    expect(html).toContain('Models &amp; Agents')
  })

  it('renders the home view', () => {
    const html = renderToStaticMarkup(<HomeView onNavigate={noop} />)
    expect(html).toContain('Klyro')
  })

  it('renders the privacy view', () => {
    const html = renderToStaticMarkup(<PrivacyView />)
    expect(html).toContain('Privacy &amp; Data')
  })
})
