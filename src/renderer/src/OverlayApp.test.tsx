import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'

// The overlay is the product: it is opened from a hotkey, so it must render
// without a window around it and must always offer the same controls.
vi.stubGlobal('window', {
  location: { hash: '#overlay' },
  addEventListener: () => undefined,
  removeEventListener: () => undefined,
  matchMedia: () => ({ matches: false, addEventListener: () => undefined, removeEventListener: () => undefined }),
  navigator: { platform: 'Linux x86_64' },
  klyro: new Proxy(
    {},
    {
      get: () => async () => {
        throw new Error('the overlay must not call IPC during the initial render')
      }
    }
  )
})

const { default: OverlayApp } = await import('./OverlayApp')

describe('the quick-ask overlay', () => {
  it('offers the question box, the ask action and the assist tools', () => {
    const html = renderToStaticMarkup(<OverlayApp />)
    expect(html).toContain('Ask anything')
    expect(html).toContain('Ask')
    expect(html).toContain('Capture screen')
    expect(html).toContain('Talk to Klyro')
    expect(html).toContain('Record a question')
    expect(html).toContain('Listen to the meeting')
    expect(html).toContain('Esc to close')
  })

  it('keeps the answer area out of the way until there is something to show', () => {
    const html = renderToStaticMarkup(<OverlayApp />)
    // No answer, no question, no response block: the idle overlay stays small.
    expect(html).not.toContain('overlay__response')
    expect(html).not.toContain('overlay__question')
  })
})
