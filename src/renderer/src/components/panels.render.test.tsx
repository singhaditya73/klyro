import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import type { AgentController } from '../hooks/useAgent'

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

const { AgentPanel } = await import('./AgentPanel')
const { KnowledgePanel } = await import('./KnowledgePanel')
const { SettingsPanel } = await import('./SettingsPanel')
const { StudioPanel } = await import('./StudioPanel')

const fakeAgent = {
  caps: null,
  running: false,
  paused: false,
  goal: '',
  setGoal: () => undefined,
  steps: [],
  pending: null,
  outcome: null,
  tasks: [],
  start: async () => undefined,
  stop: () => undefined,
  pause: () => undefined,
  resume: () => undefined,
  decide: () => undefined,
  refreshCaps: async () => undefined
} satisfies AgentController

const noop = (): void => undefined

describe('lazy-loaded panels', () => {
  it('renders the agent panel', () => {
    const html = renderToStaticMarkup(<AgentPanel agent={fakeAgent} onClose={noop} />)
    expect(html).toContain('Desktop agent')
    expect(html).toContain('aria-label="Close the agent panel"')
  })

  it('renders the knowledge panel', () => {
    const html = renderToStaticMarkup(<KnowledgePanel onClose={noop} />)
    expect(html).toContain('Knowledge')
    expect(html).toContain('Memory (0)')
    expect(html).toContain('role="dialog"')
  })

  it('renders the studio panel as a single meetings surface', () => {
    const html = renderToStaticMarkup(<StudioPanel onClose={noop} />)
    expect(html).toContain('Meetings')
    expect(html).toContain('No meetings saved yet')
    expect(html).not.toContain('Coding')
    expect(html).not.toContain('Workflows (')
  })

  it('renders the settings panel with a loading state while settings load', () => {
    const html = renderToStaticMarkup(<SettingsPanel onClose={noop} />)
    expect(html).toContain('Settings')
    expect(html).toContain('Loading settings')
  })
})
